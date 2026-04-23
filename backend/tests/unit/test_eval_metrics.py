from __future__ import annotations

from tests.eval.metrics import (
    score_contradiction_detection,
    score_entity_extraction,
)


def test_perfect_entity_score() -> None:
    predicted = [
        {"id": "ent_1", "type": "Person", "canonical_name": "Robert K. Smith"},
        {"id": "ent_2", "type": "Organization", "canonical_name": "Raptor II"},
    ]
    truth = [
        {"canonical_name": "Robert K. Smith", "type": "Person", "surface_forms": ["Bob Smith"]},
        {"canonical_name": "Raptor II", "type": "Organization", "surface_forms": []},
    ]
    prf = score_entity_extraction(predicted, truth)
    assert prf.precision == 1.0
    assert prf.recall == 1.0
    assert prf.f1 == 1.0


def test_entity_matches_surface_form() -> None:
    predicted = [{"id": "ent_1", "type": "Person", "canonical_name": "Bob Smith"}]
    truth = [
        {
            "canonical_name": "Robert K. Smith",
            "type": "Person",
            "surface_forms": ["Bob Smith", "Mr. Smith"],
        }
    ]
    prf = score_entity_extraction(predicted, truth)
    assert prf.true_positives == 1
    assert prf.false_positives == 0
    assert prf.false_negatives == 0


def test_wrong_type_is_not_a_match() -> None:
    predicted = [{"id": "ent_1", "type": "Organization", "canonical_name": "Alice"}]
    truth = [{"canonical_name": "Alice", "type": "Person", "surface_forms": []}]
    prf = score_entity_extraction(predicted, truth)
    assert prf.true_positives == 0
    assert prf.false_positives == 1
    assert prf.false_negatives == 1


def test_contradiction_matches_by_subject_name_and_predicate() -> None:
    predicted = [
        {
            "id": "contra_1",
            "subject_entity_id": "ent_A",
            "predicate": "attended_meeting_on",
        }
    ]
    truth = [
        {
            "subject_canonical": "Robert K. Smith",
            "predicate": "attended_meeting_on",
            "conflicting_values": ["2001-03-12", "2001-03-15"],
        }
    ]
    prf = score_contradiction_detection(
        predicted, truth, predicted_entity_name_by_id={"ent_A": "Robert K. Smith"}
    )
    assert prf.true_positives == 1
    assert prf.recall == 1.0


def test_contradiction_wrong_predicate_does_not_match() -> None:
    predicted = [
        {"id": "contra_1", "subject_entity_id": "ent_A", "predicate": "signed_document"}
    ]
    truth = [
        {
            "subject_canonical": "Robert K. Smith",
            "predicate": "attended_meeting_on",
            "conflicting_values": [],
        }
    ]
    prf = score_contradiction_detection(
        predicted, truth, predicted_entity_name_by_id={"ent_A": "Robert K. Smith"}
    )
    assert prf.true_positives == 0
    assert prf.false_positives == 1
    assert prf.false_negatives == 1
