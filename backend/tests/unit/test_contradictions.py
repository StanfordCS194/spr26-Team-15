from __future__ import annotations

from app.contradictions.detector import detect_contradictions
from app.models.extraction import Claim, Provenance


def _prov(chunk_id: str = "doc1:0", start: int = 0, end: int = 1, doc_id: str = "doc1") -> Provenance:
    return Provenance(source_doc_id=doc_id, chunk_id=chunk_id, char_start=start, char_end=end)


def _c(
    id_: str,
    subject: str,
    predicate: str,
    value: str,
    chunk_id: str = "doc1:0",
    value_type: str = "text",
    speaker: str | None = None,
    confidence: float = 0.9,
) -> Claim:
    return Claim(
        id=id_,
        subject_entity_id=subject,
        predicate=predicate,
        value=value,
        value_type=value_type,
        speaker_entity_id=speaker,
        provenance=_prov(chunk_id=chunk_id),
        confidence=confidence,
    )


def test_flags_date_conflict_across_chunks() -> None:
    claims = [
        _c("cl1", "ent_A", "attended_meeting_on", "2001-03-12", chunk_id="doc1:0",
           value_type="date", speaker="ent_X"),
        _c("cl2", "ent_A", "attended_meeting_on", "2001-03-15", chunk_id="doc2:0",
           value_type="date", speaker="ent_Y"),
    ]
    found = detect_contradictions(claims)
    assert len(found) == 1
    c = found[0]
    assert c.subject_entity_id == "ent_A"
    assert c.predicate == "attended_meeting_on"
    assert set(c.conflicting_claim_ids) == {"cl1", "cl2"}


def test_same_claim_same_chunk_is_not_contradiction() -> None:
    # Same claim repeated in the same chunk isn't informative.
    claims = [
        _c("cl1", "ent_A", "employed_by", "Acme", chunk_id="doc1:0"),
        _c("cl2", "ent_A", "employed_by", "Acme", chunk_id="doc1:0"),
    ]
    assert detect_contradictions(claims) == []


def test_identical_values_across_chunks_are_not_contradiction() -> None:
    claims = [
        _c("cl1", "ent_A", "employed_by", "Acme", chunk_id="doc1:0"),
        _c("cl2", "ent_A", "employed_by", "Acme", chunk_id="doc2:0"),
    ]
    assert detect_contradictions(claims) == []


def test_different_subjects_are_not_contradiction() -> None:
    claims = [
        _c("cl1", "ent_A", "employed_by", "Acme", chunk_id="doc1:0"),
        _c("cl2", "ent_B", "employed_by", "OtherCo", chunk_id="doc2:0"),
    ]
    assert detect_contradictions(claims) == []


def test_different_predicates_are_not_contradiction() -> None:
    claims = [
        _c("cl1", "ent_A", "employed_by", "Acme", chunk_id="doc1:0"),
        _c("cl2", "ent_A", "attended_meeting_on", "Acme", chunk_id="doc2:0"),
    ]
    assert detect_contradictions(claims) == []


def test_money_conflict_across_chunks() -> None:
    claims = [
        _c("cl1", "ent_A", "received_payment_of", "2500000", chunk_id="doc1:0",
           value_type="money"),
        _c("cl2", "ent_A", "received_payment_of", "5000000", chunk_id="doc2:0",
           value_type="money"),
    ]
    found = detect_contradictions(claims)
    assert len(found) == 1


def test_text_near_duplicates_do_not_conflict() -> None:
    # "Enron Corporation" ~ "Enron Corp." — should NOT flag.
    claims = [
        _c("cl1", "ent_A", "party_to_agreement_with", "Enron Corporation", chunk_id="doc1:0",
           value_type="text"),
        _c("cl2", "ent_A", "party_to_agreement_with", "Enron Corp.", chunk_id="doc2:0",
           value_type="text"),
    ]
    assert detect_contradictions(claims) == []


def test_three_way_contradiction_ranks_higher() -> None:
    # Three-way conflict with distinct speakers should rank above a two-way conflict.
    high_rank = [
        _c("a", "ent_A", "attended_meeting_on", "2001-03-12", chunk_id="doc1:0",
           value_type="date", speaker="ent_X"),
        _c("b", "ent_A", "attended_meeting_on", "2001-03-15", chunk_id="doc2:0",
           value_type="date", speaker="ent_Y"),
        _c("c", "ent_A", "attended_meeting_on", "2001-03-20", chunk_id="doc3:0",
           value_type="date", speaker="ent_Z"),
    ]
    low_rank = [
        _c("d", "ent_B", "employed_by", "Acme", chunk_id="doc1:0",
           value_type="entity_ref"),
        _c("e", "ent_B", "employed_by", "Widgetco", chunk_id="doc2:0",
           value_type="entity_ref"),
    ]
    found = detect_contradictions(high_rank + low_rank)
    assert len(found) == 2
    assert found[0].subject_entity_id == "ent_A"
    assert found[1].subject_entity_id == "ent_B"
    assert found[0].rank_score > found[1].rank_score


def test_canonical_id_mapping_applied() -> None:
    # Two local IDs that map to the same canonical should be grouped.
    claims = [
        _c("cl1", "local_a", "attended_meeting_on", "2001-03-12", chunk_id="doc1:0",
           value_type="date"),
        _c("cl2", "local_b", "attended_meeting_on", "2001-03-15", chunk_id="doc2:0",
           value_type="date"),
    ]
    mapping = {"local_a": "ent_A", "local_b": "ent_A"}
    found = detect_contradictions(claims, local_to_canonical=mapping)
    assert len(found) == 1
    assert found[0].subject_entity_id == "ent_A"


def test_mixed_value_types_do_not_conflict() -> None:
    # A date claim and a text claim with the same subject+predicate are not comparable.
    claims = [
        _c("cl1", "ent_A", "started_on", "2001-03-12", chunk_id="doc1:0",
           value_type="date"),
        _c("cl2", "ent_A", "started_on", "spring", chunk_id="doc2:0",
           value_type="text"),
    ]
    assert detect_contradictions(claims) == []


def test_predicate_alias_groups_meeting_date_synonyms() -> None:
    # Two claims about the same meeting using different predicate phrasings should still
    # be compared and flagged when their dates differ.
    claims = [
        _c("cl1", "ent_meeting", "attended_meeting_on", "2001-03-12", chunk_id="doc1:0",
           value_type="date", speaker="ent_smith"),
        _c("cl2", "ent_meeting", "meeting_date", "2001-03-15", chunk_id="doc2:0",
           value_type="date", speaker="ent_fastow"),
    ]
    found = detect_contradictions(claims)
    assert len(found) == 1
    assert found[0].subject_entity_id == "ent_meeting"
    # The canonical predicate is what's stored on the record.
    assert found[0].predicate == "attended_meeting_on"
    assert set(found[0].conflicting_claim_ids) == {"cl1", "cl2"}


def test_predicate_alias_groups_payment_amount_synonyms() -> None:
    # "wire_amount" and "transferred_amount" should both normalize to "received_payment_of"
    # so a $2.5M vs $5M conflict is caught.
    claims = [
        _c("cl1", "ent_wire", "wire_amount", "2500000", chunk_id="doc1:0",
           value_type="money"),
        _c("cl2", "ent_wire", "transferred_amount", "5000000", chunk_id="doc2:0",
           value_type="money"),
    ]
    found = detect_contradictions(claims)
    assert len(found) == 1
    assert found[0].predicate == "received_payment_of"


def test_unrelated_predicates_still_do_not_group() -> None:
    # The alias map must not over-merge: predicates outside the map keep their literal form.
    claims = [
        _c("cl1", "ent_A", "employed_by", "Acme", chunk_id="doc1:0",
           value_type="text"),
        _c("cl2", "ent_A", "lived_at", "Houston", chunk_id="doc2:0",
           value_type="text"),
    ]
    assert detect_contradictions(claims) == []
