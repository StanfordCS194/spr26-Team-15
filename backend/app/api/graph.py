from __future__ import annotations

from fastapi import APIRouter

from app.graph.reader import read_case_events, read_case_graph

router = APIRouter()


@router.get("/{case_id}/graph")
def get_graph(case_id: str) -> dict:
    """Returns entities + relations for the case, in the shape the frontend GraphView expects."""
    return read_case_graph(case_id)


@router.get("/{case_id}/events")
def get_events(case_id: str) -> list[dict]:
    """Ordered list of events for the timeline view."""
    return read_case_events(case_id)
