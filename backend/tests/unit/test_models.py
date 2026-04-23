"""Schema validation + reference-integrity tests."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import (
    Claim,
    Entity,
    EntityType,
    Event,
    ExtractionResult,
    Provenance,
    Relation,
    RelationType,
)


def make_prov(start: int = 0, end: int = 10) -> Provenance:
    return Provenance(source_doc_id="doc1", chunk_id="c1", char_start=start, char_end=end)


def test_provenance_rejects_end_before_start() -> None:
    with pytest.raises(ValidationError):
        Provenance(source_doc_id="d", chunk_id="c", char_start=10, char_end=5)


def test_confidence_bounds() -> None:
    with pytest.raises(ValidationError):
        Entity(
            id="e1",
            type=EntityType.PERSON,
            mention_text="x",
            provenance=make_prov(),
            confidence=1.5,
        )


def test_extraction_result_round_trip() -> None:
    e1 = Entity(id="e1", type=EntityType.PERSON, mention_text="Alice", provenance=make_prov())
    e2 = Entity(id="e2", type=EntityType.ORGANIZATION, mention_text="Acme", provenance=make_prov())
    r = Relation(
        id="r1",
        type=RelationType.EMPLOYS,
        subject_id="e2",
        object_id="e1",
        provenance=make_prov(),
    )
    c = Claim(
        id="cl1",
        subject_entity_id="e1",
        predicate="employed_by",
        value="Acme",
        provenance=make_prov(),
    )
    ev = Event(
        id="ev1",
        description="kickoff",
        occurred_at="2024-03-01",
        participant_ids=["e1"],
        provenance=make_prov(),
    )
    result = ExtractionResult(entities=[e1, e2], relations=[r], claims=[c], events=[ev])

    # Round-trip via JSON
    blob = result.model_dump_json()
    restored = ExtractionResult.model_validate_json(blob)
    assert restored == result
    assert restored.validate_references() == []


def test_validate_references_flags_dangling() -> None:
    e1 = Entity(id="e1", type=EntityType.PERSON, mention_text="Alice", provenance=make_prov())
    r_bad = Relation(
        id="r1",
        type=RelationType.EMPLOYS,
        subject_id="missing",
        object_id="e1",
        provenance=make_prov(),
    )
    c_bad = Claim(
        id="cl1",
        subject_entity_id="e1",
        predicate="p",
        value="v",
        speaker_entity_id="ghost",
        provenance=make_prov(),
    )
    result = ExtractionResult(entities=[e1], relations=[r_bad], claims=[c_bad])
    errs = result.validate_references()
    assert len(errs) == 2
    assert any("missing" in e for e in errs)
    assert any("ghost" in e for e in errs)


def test_extraction_ignores_extra_fields() -> None:
    # extra="ignore" so LLM output with unexpected fields (common with json_object mode) doesn't crash
    e = Entity(
        id="e1",
        type=EntityType.PERSON,
        mention_text="x",
        provenance=make_prov(),
        not_a_field="oops",  # type: ignore[call-arg]
    )
    assert not hasattr(e, "not_a_field")
