"""Event-level contradiction modeling: resolve events (ignoring date), turn them into
occurred_on claims, detect a disputed date once at the event level, and suppress the
redundant per-attendee duplicates."""

from __future__ import annotations

from app.contradictions.detector import (
    ContradictionRecord,
    detect_contradictions,
    event_date_claims,
    suppress_event_subsumed_contradictions,
    template_explanation,
)
from app.models.extraction import Claim, Event, Provenance
from app.resolution.resolver import resolve_events


def _prov(chunk_id: str, doc_id: str = "doc1") -> Provenance:
    return Provenance(source_doc_id=doc_id, chunk_id=chunk_id, char_start=0, char_end=5)


def _event(id_: str, description: str, occurred_at: str, chunk_id: str) -> Event:
    return Event(
        id=id_,
        description=description,
        occurred_at=occurred_at,
        provenance=_prov(chunk_id),
        confidence=0.9,
    )


def _c(id_, subject, predicate, value, chunk_id, value_type="date") -> Claim:
    return Claim(
        id=id_,
        subject_entity_id=subject,
        predicate=predicate,
        value=value,
        value_type=value_type,
        provenance=_prov(chunk_id),
        confidence=0.9,
    )


# --- resolve_events ---------------------------------------------------------------------

def test_resolve_events_clusters_same_meeting_ignoring_date() -> None:
    events = [
        ("e1", "Finance committee meeting regarding Raptor II vehicle attended by Smith, Skilling, Fastow"),
        ("e2", "Raptor II finance meeting attended by Jeffrey Skilling, Robert Smith, and Andrew Fastow"),
        ("e3", "Raptor II finance committee meeting attended by Andrew Fastow and Jeff Skilling; Bob Smith was not present"),
    ]
    clusters = resolve_events(events)
    assert len(clusters) == 1
    assert set(clusters[0].member_ids) == {"e1", "e2", "e3"}


def test_resolve_events_keeps_distinct_depositions_apart() -> None:
    # Boilerplate-heavy but genuinely different events must NOT merge.
    events = [
        ("d1", "Deposition of Andrew S. Fastow taken in case CV-2002-0043"),
        ("d2", "Deposition of Jeffrey K. Skilling taken in case CV-2002-0043"),
    ]
    clusters = resolve_events(events)
    assert len(clusters) == 2


def test_resolve_events_separates_meetings_from_wires() -> None:
    events = [
        ("m1", "Finance committee meeting regarding Raptor II vehicle attended by Smith and Skilling"),
        ("m2", "Raptor II finance committee meeting attended by Fastow and Skilling"),
        ("w1", "$2.5M wire transfer sent to Raptor II"),
        ("w2", "Jeffrey Skilling approved $2.5M wire transfer to Raptor II Holdings"),
    ]
    clusters = {frozenset(c.member_ids) for c in resolve_events(events)}
    assert frozenset({"m1", "m2"}) in clusters
    # wires cluster among themselves, never with meetings
    assert all("m1" not in c or c == frozenset({"m1", "m2"}) for c in clusters)


# --- event_date_claims + detection ------------------------------------------------------

def test_event_date_conflict_surfaces_once_at_event_level() -> None:
    events = [
        _event("e1", "Raptor II finance committee meeting with Skilling and Smith", "2001-03-12", "doc1:0"),
        _event("e2", "Raptor II finance committee meeting attended by Fastow and Skilling", "2001-03-12", "doc2:0"),
        _event("e3", "Raptor II finance committee meeting; Smith not present", "2001-03-15", "doc3:0"),
    ]
    clusters = resolve_events([(e.id, e.description) for e in events])
    mapping = {m: c.canonical_id for c in clusters for m in c.member_ids}
    claims = event_date_claims(events, mapping)
    found = detect_contradictions(claims)
    assert len(found) == 1
    assert found[0].predicate == "occurred_on"
    # all three event-claims share one canonical event subject
    assert found[0].subject_entity_id.startswith("evt_")
    assert len(found[0].conflicting_claim_ids) == 3


def test_event_date_claims_skip_events_without_a_date() -> None:
    events = [_event("e1", "Some meeting", "", "doc1:0")]
    assert event_date_claims(events, {}) == []


# --- suppression ------------------------------------------------------------------------

def test_suppresses_per_attendee_date_conflict_when_event_conflict_exists() -> None:
    # An event occurred_on conflict over {03-12, 03-15} subsumes per-person attended_meeting_on.
    claims = [
        _c("ev1", "evt_meeting", "occurred_on", "2001-03-12", "doc1:0"),
        _c("ev2", "evt_meeting", "occurred_on", "2001-03-15", "doc2:0"),
        _c("p1", "ent_skilling", "attended_meeting_on", "2001-03-12", "doc1:0"),
        _c("p2", "ent_skilling", "attended_meeting_on", "2001-03-15", "doc2:0"),
    ]
    by_id = {c.id: c for c in claims}
    records = detect_contradictions(claims)
    # both the event-level and the per-attendee conflicts get detected first
    assert {r.predicate for r in records} == {"occurred_on", "attended_meeting_on"}
    kept = suppress_event_subsumed_contradictions(records, by_id)
    assert [r.predicate for r in kept] == ["occurred_on"]


def test_suppression_keeps_unrelated_conflicts() -> None:
    # A non-date attendance conflict (present vs absent) must survive.
    claims = [
        _c("ev1", "evt_meeting", "occurred_on", "2001-03-12", "doc1:0"),
        _c("ev2", "evt_meeting", "occurred_on", "2001-03-15", "doc2:0"),
        _c("a1", "ent_smith", "attended_meeting", "present", "doc1:0", value_type="text"),
        _c("a2", "ent_smith", "attended_meeting", "absent", "doc2:0", value_type="text"),
    ]
    by_id = {c.id: c for c in claims}
    kept = suppress_event_subsumed_contradictions(detect_contradictions(claims), by_id)
    preds = {r.predicate for r in kept}
    assert "occurred_on" in preds
    assert "attended_meeting" in preds


def test_suppression_noop_without_event_conflict() -> None:
    claims = [
        _c("p1", "ent_skilling", "attended_meeting_on", "2001-03-12", "doc1:0"),
        _c("p2", "ent_skilling", "attended_meeting_on", "2001-03-15", "doc2:0"),
    ]
    by_id = {c.id: c for c in claims}
    records = detect_contradictions(claims)
    assert suppress_event_subsumed_contradictions(records, by_id) == records


# --- template explanation ---------------------------------------------------------------

def test_template_explanation_names_values_and_subject() -> None:
    claims = [
        _c("c1", "evt_x", "occurred_on", "2001-03-12", "doc1:0"),
        _c("c2", "evt_x", "occurred_on", "2001-03-15", "doc2:0"),
    ]
    by_id = {c.id: c for c in claims}
    rec = ContradictionRecord(
        id="contra_1",
        subject_entity_id="evt_x",
        predicate="occurred_on",
        conflicting_claim_ids=["c1", "c2"],
        rank_score=1.0,
        subject_label="Raptor II finance committee meeting",
    )
    text = template_explanation(rec, by_id)
    assert "occurred_on" in text
    assert "2001-03-12" in text and "2001-03-15" in text
    assert "Raptor II finance committee meeting" in text
