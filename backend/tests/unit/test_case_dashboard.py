from __future__ import annotations

from app.api.cases import _select_timeline_highlights


def test_select_timeline_highlights_keeps_leading_and_trailing_events() -> None:
    events = [
        {"id": "ev1", "occurred_at": "2001-01-01"},
        {"id": "ev2", "occurred_at": "2001-01-02"},
        {"id": "ev3", "occurred_at": "2001-01-03"},
        {"id": "ev4", "occurred_at": "2001-01-04"},
        {"id": "ev5", "occurred_at": "2001-01-05"},
        {"id": "ev6", "occurred_at": "2001-01-06"},
    ]

    selected = _select_timeline_highlights(events)

    assert [event["id"] for event in selected] == ["ev1", "ev2", "ev4", "ev5", "ev6"]


def test_select_timeline_highlights_returns_all_events_when_under_limit() -> None:
    events = [{"id": "ev1"}, {"id": "ev2"}]
    assert _select_timeline_highlights(events, limit=5) == events
