"""Semantic contradiction pass — fully offline (a FakeAdjudicator stands in for the LLM)."""

from __future__ import annotations

from app.contradictions.detector import ContradictionRecord
from app.contradictions.semantic import (
    AdjudicationResult,
    ClaimPair,
    detect_semantic_contradictions,
    generate_candidate_pairs,
    merge_contradictions,
)
from app.models.extraction import Claim, Provenance


def _c(id_, subject, predicate, value, chunk_id, value_type="text") -> Claim:
    return Claim(
        id=id_,
        subject_entity_id=subject,
        predicate=predicate,
        value=value,
        value_type=value_type,
        provenance=Provenance(source_doc_id="d", chunk_id=chunk_id, char_start=0, char_end=3),
        confidence=0.9,
    )


class FakeAdjudicator:
    """Returns a canned verdict per pair index; defaults to conflict=False (no hallucination)."""

    def __init__(self, conflicts: dict[int, str] | None = None) -> None:
        self._conflicts = conflicts or {}

    def adjudicate(self, pairs: list[ClaimPair]) -> list[AdjudicationResult]:
        return [
            AdjudicationResult(
                index=p.index,
                conflict=p.index in self._conflicts,
                explanation=self._conflicts.get(p.index, ""),
            )
            for p in pairs
        ]


# --- candidate generation ---------------------------------------------------------------

def test_same_bucket_pairs_are_excluded() -> None:
    # Same predicate AND value_type — the deterministic detector owns these, so 0 candidates.
    claims = [
        _c("c1", "ent_a", "attended_meeting", "present", "d1:0"),
        _c("c2", "ent_a", "attended_meeting", "absent", "d2:0"),
    ]
    assert generate_candidate_pairs(claims) == []


def test_cross_predicate_value_overlap_with_negation_is_a_candidate() -> None:
    claims = [
        _c("c1", "ent_a", "signed_document", "Raptor II side letter", "d1:0"),
        _c("c2", "ent_a", "denied_signing", "Raptor II side letter", "d2:0"),
    ]
    pairs = generate_candidate_pairs(claims)
    assert len(pairs) == 1
    assert {pairs[0].a.id, pairs[0].b.id} == {"c1", "c2"}


def test_shape_mismatch_same_topic_is_a_candidate() -> None:
    claims = [
        _c("c1", "ent_a", "attended_meeting_on", "2001-03-12", "d1:0", value_type="date"),
        _c("c2", "ent_a", "attended_meeting", "absent", "d2:0", value_type="text"),
    ]
    pairs = generate_candidate_pairs(claims)
    assert len(pairs) == 1


def test_unrelated_claims_are_filtered_out() -> None:
    claims = [
        _c("c1", "ent_a", "employed_by", "Enron", "d1:0"),
        _c("c2", "ent_a", "lives_in", "Houston", "d2:0"),
    ]
    assert generate_candidate_pairs(claims) == []


def test_same_chunk_pairs_excluded() -> None:
    claims = [
        _c("c1", "ent_a", "signed_document", "contract X", "d1:0"),
        _c("c2", "ent_a", "denied_signing", "contract X", "d1:0"),
    ]
    assert generate_candidate_pairs(claims) == []


def test_canonical_mapping_groups_pairs() -> None:
    claims = [
        _c("c1", "local_1", "signed_document", "contract X", "d1:0"),
        _c("c2", "local_2", "denied_signing", "contract X", "d2:0"),
    ]
    mapping = {"local_1": "ent_smith", "local_2": "ent_smith"}
    assert len(generate_candidate_pairs(claims, mapping)) == 1
    # Without the mapping the subjects differ, so no pair.
    assert generate_candidate_pairs(claims) == []


def test_max_pairs_caps_candidates() -> None:
    claims = [_c("base", "ent_a", "signed_document", "contract X", "d0:0")]
    for i in range(10):
        claims.append(_c(f"n{i}", "ent_a", "denied_signing", "contract X", f"d{i + 1}:0"))
    pairs = generate_candidate_pairs(claims, max_pairs=3)
    assert len(pairs) == 3


# --- detection + merge ------------------------------------------------------------------

def test_adjudicator_none_disables_pass() -> None:
    claims = [
        _c("c1", "ent_a", "signed_document", "contract X", "d1:0"),
        _c("c2", "ent_a", "denied_signing", "contract X", "d2:0"),
    ]
    assert detect_semantic_contradictions(claims, None) == []


def test_confirmed_conflict_becomes_a_record() -> None:
    claims = [
        _c("c1", "ent_a", "signed_document", "contract X", "d1:0"),
        _c("c2", "ent_a", "denied_signing", "contract X", "d2:0"),
    ]
    found = detect_semantic_contradictions(
        claims, FakeAdjudicator({0: "One says signed, the other denies signing."})
    )
    assert len(found) == 1
    assert found[0].subject_entity_id == "ent_a"
    assert set(found[0].conflicting_claim_ids) == {"c1", "c2"}
    assert "denies" in found[0].explanation


def test_rejected_conflict_produces_nothing() -> None:
    claims = [
        _c("c1", "ent_a", "signed_document", "contract X", "d1:0"),
        _c("c2", "ent_a", "denied_signing", "contract X", "d2:0"),
    ]
    assert detect_semantic_contradictions(claims, FakeAdjudicator({})) == []


def test_merge_drops_semantic_subset_of_deterministic() -> None:
    det = [
        ContradictionRecord(
            id="contra_det",
            subject_entity_id="ent_a",
            predicate="attended_meeting",
            conflicting_claim_ids=["c1", "c2"],
            rank_score=5.0,
        )
    ]
    sem = [
        ContradictionRecord(
            id="contra_sem",
            subject_entity_id="ent_a",
            predicate="attended_meeting|present_at",
            conflicting_claim_ids=["c1", "c2"],
            rank_score=1.0,
        )
    ]
    merged = merge_contradictions(det, sem)
    assert [r.id for r in merged] == ["contra_det"]


def test_merge_keeps_distinct_semantic_and_sorts() -> None:
    det = [
        ContradictionRecord("contra_det", "ent_a", "p", ["c1", "c2"], rank_score=2.0),
    ]
    sem = [
        ContradictionRecord("contra_sem", "ent_b", "x|y", ["c3", "c4"], rank_score=9.0),
    ]
    merged = merge_contradictions(det, sem)
    assert [r.id for r in merged] == ["contra_sem", "contra_det"]  # sorted by rank desc
