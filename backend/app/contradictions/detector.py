"""Contradiction detection v1.

Scope: same-subject same-predicate value conflict. Two claims conflict when:
  - They share the same canonical subject_entity_id
  - They share the same predicate (or predicates that normalize to the same key)
  - Their values differ (by exact match for entity_ref / date / money, fuzzy for text)
  - They come from different source excerpts (i.e. different chunks)

We deliberately do NOT attempt semantic/inferential contradiction detection here — that's a
separate, much harder problem. This v1 catches the cases that matter most for legal discovery:
two witnesses giving different dates for the same event, two documents naming different
counterparties for the same transaction, etc.

The rank_score is a simple heuristic: more sources + higher confidences + more distinct
speakers = higher rank.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from rapidfuzz import fuzz

from app.models.extraction import Claim

_PUNCT = re.compile(r"[^\w\s]")


# Predicate variants that mean the same fact, mapped to a canonical form. Llama (and to a
# lesser extent Claude) tends to drift across chunks — emitting "meeting_date" in one chunk
# and "attended_meeting_on" in another for the same underlying claim. Without normalization,
# these land in different (subject, predicate) buckets and never get compared, so real
# contradictions stay hidden.
#
# Keep this conservative: only true synonyms. `value_type` already guards against cross-shape
# comparisons (e.g. a date claim won't conflict with a text claim even if predicates match),
# so we don't have to be paranoid about merging semantically-similar predicates.
_PREDICATE_ALIASES: dict[str, str] = {
    # Meeting / event date — subject is a person or event, value is a date.
    "meeting_date": "attended_meeting_on",
    "date_of_meeting": "attended_meeting_on",
    "meeting_attended_on": "attended_meeting_on",
    "was_at_meeting_on": "attended_meeting_on",
    "present_at_meeting_on": "attended_meeting_on",
    # Payment / wire transfer amount — value is a money amount.
    "wire_amount": "received_payment_of",
    "wire_transfer_amount": "received_payment_of",
    "transfer_amount": "received_payment_of",
    "transferred_amount": "received_payment_of",
    "received_amount": "received_payment_of",
    "amount_received": "received_payment_of",
    "amount_paid": "received_payment_of",
    "paid_amount": "received_payment_of",
    "payment_amount": "received_payment_of",
}


def _normalize_predicate(predicate: str) -> str:
    """Lowercase, strip, then apply the alias map so synonymous predicates group together."""
    key = predicate.strip().lower()
    return _PREDICATE_ALIASES.get(key, key)


@dataclass(frozen=True)
class ContradictionRecord:
    id: str
    subject_entity_id: str
    predicate: str
    conflicting_claim_ids: list[str]
    rank_score: float


# Values closer than this are treated as "same" for free-text claims.
TEXT_EQUIV_THRESHOLD = 90.0


def _values_conflict(a: Claim, b: Claim) -> bool:
    """Return True if two claims' values are incompatible.

    Rules:
      - Different value_types → treat as non-comparable, not conflicting.
      - For date/money/number/entity_ref: strict equality (whitespace-trimmed, lowered).
      - For text: fuzzy similarity — only flag if clearly different.
    """
    if a.value_type != b.value_type:
        return False

    va = a.value.strip().lower()
    vb = b.value.strip().lower()
    if not va or not vb:
        return False

    if a.value_type in ("date", "money", "number", "entity_ref"):
        return va != vb

    # Free text: only flag clear conflicts. Strip punctuation first so "Enron Corp." and
    # "Enron Corporation" compare closely instead of getting blown apart by the trailing period.
    va_n = _PUNCT.sub(" ", va)
    vb_n = _PUNCT.sub(" ", vb)
    similarity = max(
        fuzz.token_set_ratio(va_n, vb_n),
        fuzz.partial_ratio(va_n, vb_n),
    )
    return similarity < TEXT_EQUIV_THRESHOLD


def _find(parent: list[int], x: int) -> int:
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _union(parent: list[int], a: int, b: int) -> None:
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[ra] = rb


def _contra_id(subject_id: str, predicate: str, claim_ids: list[str]) -> str:
    key = f"{subject_id}|{predicate}|{'|'.join(sorted(claim_ids))}"
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
    return f"contra_{h}"


def detect_contradictions(
    claims: list[Claim],
    local_to_canonical: dict[str, str] | None = None,
) -> list[ContradictionRecord]:
    """Find same-subject same-predicate value conflicts across a set of claims.

    Args:
        claims: all claims for the case.
        local_to_canonical: optional mapping from local Entity.id → canonical_id. If provided,
            subject IDs are canonicalized before grouping. Required for real use; optional for
            focused unit tests that use stable pre-canonicalized subject IDs.

    Returns one record per distinct contradiction group. A group may involve more than two
    conflicting claims (e.g. three witnesses giving three different dates).
    """
    if not claims:
        return []

    mapping = local_to_canonical or {}

    # Group by (canonical_subject, normalized_predicate).
    groups: dict[tuple[str, str], list[Claim]] = {}
    for c in claims:
        subject = mapping.get(c.subject_entity_id, c.subject_entity_id)
        pred = _normalize_predicate(c.predicate)
        groups.setdefault((subject, pred), []).append(c)

    out: list[ContradictionRecord] = []
    for (subject, pred), group in groups.items():
        if len(group) < 2:
            continue

        # Single-linkage clustering by value-compatibility: claims that can mutually coexist
        # (not conflicting) cluster together; a group with ≥2 distinct clusters is a contradiction.
        n = len(group)
        parent = list(range(n))

        for i in range(n):
            for j in range(i + 1, n):
                if not _values_conflict(group[i], group[j]):
                    _union(parent, i, j)

        cluster_count = len({_find(parent, i) for i in range(n)})
        if cluster_count < 2:
            continue  # every claim compatible → no contradiction

        # Ensure we flag claims from at least two distinct source chunks.
        chunk_ids = {c.provenance.chunk_id for c in group}
        if len(chunk_ids) < 2:
            continue

        claim_ids = [c.id for c in group]
        speakers = {c.speaker_entity_id for c in group if c.speaker_entity_id}
        avg_conf = sum(c.confidence for c in group) / n
        # Rank: prioritize more sources, more speakers, and higher confidence.
        rank = len(group) * (1 + len(speakers) * 0.5) * avg_conf

        out.append(
            ContradictionRecord(
                id=_contra_id(subject, pred, claim_ids),
                subject_entity_id=subject,
                predicate=pred,
                conflicting_claim_ids=sorted(claim_ids),
                rank_score=round(rank, 4),
            )
        )

    # Sort by rank (descending) so the UI gets the most important first.
    out.sort(key=lambda r: r.rank_score, reverse=True)
    return out
