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

from app.models.extraction import Claim, Event

_PUNCT = re.compile(r"[^\w\s]")


@dataclass(frozen=True)
class ContradictionRecord:
    id: str
    subject_entity_id: str
    predicate: str
    conflicting_claim_ids: list[str]
    rank_score: float
    # Human-readable subject when it isn't a graph entity (e.g. a resolved event/meeting).
    # Empty for entity subjects, which the UI names from the graph instead.
    subject_label: str = ""
    # Short, deterministic description of the conflict, shown in the UI. Filled by the pipeline.
    explanation: str = ""


# Values closer than this are treated as "same" for free-text claims.
TEXT_EQUIV_THRESHOLD = 90.0

# Predicates that assert "person attended a meeting on <date>". A disagreement among these is
# really a disagreement about the meeting's date, which we surface once at the event level
# (predicate "occurred_on"); the per-attendee versions are redundant and get suppressed.
_MEETING_DATE_PREDICATES = frozenset({"attended_meeting_on"})
_EVENT_DATE_PREDICATE = "occurred_on"


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


def event_date_claims(
    events: list[Event], event_local_to_canonical: dict[str, str]
) -> list[Claim]:
    """Turn each event into an `occurred_on` claim whose subject is its resolved event cluster.

    Feeding these through the normal detector means an event that's dated inconsistently across
    documents surfaces as a single contradiction on the event — with full provenance, since each
    claim keeps the originating event's source span.
    """
    out: list[Claim] = []
    for ev in events:
        if not ev.occurred_at:
            continue
        canonical = event_local_to_canonical.get(ev.id, ev.id)
        out.append(
            Claim(
                id=f"{ev.id}::occurred_on",
                subject_entity_id=canonical,
                predicate=_EVENT_DATE_PREDICATE,
                value=ev.occurred_at,
                value_type="date",
                speaker_entity_id=None,
                provenance=ev.provenance,
                confidence=ev.confidence,
            )
        )
    return out


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
    # Predicate normalization (alias map + lowercasing) happens at extraction time via
    # Claim._normalize_predicate, so c.predicate is already canonical here.
    groups: dict[tuple[str, str], list[Claim]] = {}
    for c in claims:
        subject = mapping.get(c.subject_entity_id, c.subject_entity_id)
        groups.setdefault((subject, c.predicate), []).append(c)

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


def _value_set(record: ContradictionRecord, claims_by_id: dict[str, Claim]) -> set[str]:
    return {
        claims_by_id[cid].value.strip().lower()
        for cid in record.conflicting_claim_ids
        if cid in claims_by_id
    }


def suppress_event_subsumed_contradictions(
    records: list[ContradictionRecord], claims_by_id: dict[str, Claim]
) -> list[ContradictionRecord]:
    """Drop per-attendee meeting-date conflicts that an event-level date conflict already covers.

    When the same meeting is dated inconsistently we emit ONE contradiction on the event
    (predicate "occurred_on"). Each attendee placed at that meeting also produces a redundant
    "attended_meeting_on" date conflict over the same dates — those are noise once the
    event-level conflict exists, so we remove the ones whose date set is covered.
    """
    event_date_sets = [
        _value_set(r, claims_by_id)
        for r in records
        if r.predicate == _EVENT_DATE_PREDICATE
    ]
    if not event_date_sets:
        return records

    kept: list[ContradictionRecord] = []
    for r in records:
        if r.predicate in _MEETING_DATE_PREDICATES:
            vals = _value_set(r, claims_by_id)
            if vals and any(vals <= ds for ds in event_date_sets):
                continue  # subsumed by an event-level date contradiction
        kept.append(r)
    return kept


def template_explanation(
    record: ContradictionRecord, claims_by_id: dict[str, Claim]
) -> str:
    """A short, deterministic, offline explanation of a contradiction for display.

    Example: "3 sources disagree on 'attended_meeting_on': '2001-03-12' vs '2001-03-15'."
    """
    claims = [claims_by_id[cid] for cid in record.conflicting_claim_ids if cid in claims_by_id]
    distinct_values = sorted({c.value.strip() for c in claims if c.value.strip()})
    n_sources = len({c.provenance.chunk_id for c in claims}) or len(claims)
    subject = record.subject_label or "this subject"
    if len(distinct_values) >= 2:
        rendered = " vs ".join(f"{v!r}" for v in distinct_values)
        return (
            f"{n_sources} sources disagree on '{record.predicate}' for {subject}: {rendered}."
        )
    return f"Conflicting '{record.predicate}' claims for {subject} across {n_sources} sources."
