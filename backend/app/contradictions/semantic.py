"""Semantic contradiction detection — an ADDITIVE second pass over the deterministic detector.

The deterministic detector (detector.py) only compares claims that share a subject *and* a
predicate. It cannot see conflicts whose disagreement is in the *shape* of the claim — e.g.
"signed_document = X" (a person signed) versus "denied_signing = X" (the same person denies
signing), which never land in the same bucket because the predicates differ.

This pass targets exactly those cross-predicate / cross-value-type pairs. It is deliberately
conservative and gated OFF by default (see Settings.semantic_contradictions_enabled):

  1. Generate candidate pairs that share a canonical subject but that the deterministic detector
     would NEVER compare (different predicate OR different value_type), from different chunks.
  2. Cheap lexical filter to keep only pairs that look topically related but divergent — so the
     model only ever judges plausible conflicts (keeps cost and false-positive risk down).
  3. An injectable adjudicator (an LLM in production, a fake in tests) returns conflict yes/no
     plus a one-line explanation. Only confirmed conflicts become contradictions.

The deterministic baseline is never replaced: results are merged, with deterministic records
winning on any overlap (see merge_contradictions).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel

from app.contradictions.detector import ContradictionRecord, _contra_id
from app.models.extraction import Claim

logger = logging.getLogger(__name__)

# Tokens that signal negation/absence — a strong hint that two same-topic claims disagree.
_NEGATION_TOKENS = frozenset(
    {"absent", "not", "no", "never", "without", "denied", "denies", "deny",
     "none", "false", "failed", "refused", "didnt", "wasnt", "cannot"}
)
_WORD = re.compile(r"[a-z0-9]+")
# Predicate tokens too generic to count as a shared topic.
_STOPWORD_PREDICATE_TOKENS = frozenset(
    {"of", "on", "to", "the", "a", "an", "was", "is", "by", "for", "at", "with", "in", "and"}
)


@dataclass(frozen=True)
class ClaimPair:
    index: int
    a: Claim
    b: Claim


@dataclass(frozen=True)
class AdjudicationResult:
    index: int
    conflict: bool
    explanation: str = ""


class SemanticAdjudicator(Protocol):
    """Decides whether candidate claim pairs are genuine contradictions.

    Implemented by LLMAdjudicator in production and by fakes in tests (no API key needed)."""

    def adjudicate(self, pairs: list[ClaimPair]) -> list[AdjudicationResult]: ...


def _tokens(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


def _topic_tokens(predicate: str) -> set[str]:
    return {t for t in _tokens(predicate) if t not in _STOPWORD_PREDICATE_TOKENS and len(t) > 2}


_STRUCTURED_VALUE_TYPES = frozenset({"date", "money", "number", "entity_ref"})


def _content_tokens(text: str) -> set[str]:
    return {t for t in _tokens(text) if len(t) > 2 and t not in _NEGATION_TOKENS}


def _looks_divergent(a: Claim, b: Claim) -> bool:
    """Cheap filter: keep only pairs that are about the same thing yet shaped to disagree.

    "Related" = the predicates share a topic token OR the values share a content token. "Divergent"
    = one side negates and the other doesn't, OR the value shapes differ (structured vs free text).
    Both must hold, so unrelated claims never reach the (more expensive, fallible) adjudicator.
    """
    a_neg = bool(_tokens(a.value) & _NEGATION_TOKENS) or bool(_tokens(a.predicate) & _NEGATION_TOKENS)
    b_neg = bool(_tokens(b.value) & _NEGATION_TOKENS) or bool(_tokens(b.predicate) & _NEGATION_TOKENS)

    shared_topic = bool(_topic_tokens(a.predicate) & _topic_tokens(b.predicate))
    value_overlap = bool(_content_tokens(a.value) & _content_tokens(b.value))
    related = shared_topic or value_overlap

    neg_mismatch = a_neg != b_neg
    shape_mismatch = a.value_type != b.value_type and bool(
        {a.value_type, b.value_type} & _STRUCTURED_VALUE_TYPES
    )
    return related and (neg_mismatch or shape_mismatch)


def generate_candidate_pairs(
    claims: list[Claim],
    local_to_canonical: dict[str, str] | None = None,
    max_pairs: int = 50,
) -> list[ClaimPair]:
    """Pairs sharing a canonical subject that the deterministic detector would never compare.

    Complement of detector grouping: included pairs differ in predicate OR value_type, come from
    different chunks, and survive the lexical divergence filter.
    """
    mapping = local_to_canonical or {}
    by_subject: dict[str, list[Claim]] = {}
    for c in claims:
        subj = mapping.get(c.subject_entity_id, c.subject_entity_id)
        by_subject.setdefault(subj, []).append(c)

    pairs: list[ClaimPair] = []
    idx = 0
    for group in by_subject.values():
        n = len(group)
        for i in range(n):
            for j in range(i + 1, n):
                a, b = group[i], group[j]
                same_bucket = a.predicate == b.predicate and a.value_type == b.value_type
                if same_bucket:
                    continue  # deterministic detector already owns this pair
                if a.provenance.chunk_id == b.provenance.chunk_id:
                    continue  # need cross-document evidence
                if not _looks_divergent(a, b):
                    continue
                pairs.append(ClaimPair(index=idx, a=a, b=b))
                idx += 1
                if len(pairs) >= max_pairs:
                    logger.info("semantic candidate pairs capped at %d", max_pairs)
                    return pairs
    return pairs


def detect_semantic_contradictions(
    claims: list[Claim],
    adjudicator: SemanticAdjudicator | None,
    local_to_canonical: dict[str, str] | None = None,
    max_pairs: int = 50,
) -> list[ContradictionRecord]:
    """Run the semantic pass. Returns [] when disabled (adjudicator is None) or no candidates."""
    if adjudicator is None:
        return []
    pairs = generate_candidate_pairs(claims, local_to_canonical, max_pairs=max_pairs)
    if not pairs:
        return []

    mapping = local_to_canonical or {}
    by_index = {p.index: p for p in pairs}
    out: list[ContradictionRecord] = []
    for verdict in adjudicator.adjudicate(pairs):
        if not verdict.conflict or verdict.index not in by_index:
            continue
        pair = by_index[verdict.index]
        subject = mapping.get(pair.a.subject_entity_id, pair.a.subject_entity_id)
        predicate = "|".join(sorted({pair.a.predicate, pair.b.predicate}))
        claim_ids = sorted({pair.a.id, pair.b.id})
        # Slight discount so deterministic conflicts outrank semantic ones in the UI by default.
        rank = round(
            (pair.a.confidence + pair.b.confidence) / 2 * 0.9 * 2, 4
        )
        out.append(
            ContradictionRecord(
                id=_contra_id(subject, predicate, claim_ids),
                subject_entity_id=subject,
                predicate=predicate,
                conflicting_claim_ids=claim_ids,
                rank_score=rank,
                explanation=verdict.explanation,
            )
        )
    return out


def merge_contradictions(
    deterministic: list[ContradictionRecord], semantic: list[ContradictionRecord]
) -> list[ContradictionRecord]:
    """Merge the two passes, dropping any semantic record already covered by a deterministic one.

    Coverage = same record id, or the semantic pair's claim set is a subset of a deterministic
    record's claim set. Deterministic wins; the merged list is sorted by rank descending.
    """
    seen_ids = {r.id for r in deterministic}
    det_claim_sets = [frozenset(r.conflicting_claim_ids) for r in deterministic]
    merged = list(deterministic)
    for s in semantic:
        if s.id in seen_ids:
            continue
        s_claims = frozenset(s.conflicting_claim_ids)
        if any(s_claims <= ds for ds in det_claim_sets):
            continue
        merged.append(s)
    merged.sort(key=lambda r: r.rank_score, reverse=True)
    return merged


# --- LLM adjudicator --------------------------------------------------------------------

class _Verdict(BaseModel):
    index: int
    conflict: bool
    explanation: str = ""


class _VerdictBatch(BaseModel):
    verdicts: list[_Verdict]


_ADJUDICATOR_SYSTEM = (
    "You are a careful legal analyst judging whether two statements about the same subject "
    "CONTRADICT each other — i.e. they cannot both be true. Be conservative: if the statements "
    "could both hold (different aspects, compatible facts, or merely related), answer conflict=false. "
    "Return one verdict per input pair, preserving its index, with a one-sentence explanation."
)


class LLMAdjudicator:
    """Production adjudicator: one batched, structured LLM call over all candidate pairs."""

    def __init__(self, provider, model: str | None = None, max_tokens: int = 1500) -> None:
        self._provider = provider
        if model:
            self._provider.model = model
        self._max_tokens = max_tokens

    def adjudicate(self, pairs: list[ClaimPair]) -> list[AdjudicationResult]:
        if not pairs:
            return []
        lines = [
            f"Pair {p.index}: subject={p.a.subject_entity_id!r}; "
            f"statement A = [{p.a.predicate}] {p.a.value!r}; "
            f"statement B = [{p.b.predicate}] {p.b.value!r}"
            for p in pairs
        ]
        user = "Judge each pair:\n" + "\n".join(lines)
        batch, _usage = self._provider.parse(
            [{"role": "user", "content": user}],
            _ADJUDICATOR_SYSTEM,
            _VerdictBatch,
            self._max_tokens,
        )
        return [
            AdjudicationResult(index=v.index, conflict=v.conflict, explanation=v.explanation)
            for v in batch.verdicts
        ]
