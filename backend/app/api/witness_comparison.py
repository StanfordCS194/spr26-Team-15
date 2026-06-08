"""Witness comparison API.

Pass in 2-5 witness entity ids, get back a grid of what each one said,
grouped by topic. Each row also gets an "agreement" label so the frontend
can color it green/orange/gray.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.db import get_conn

router = APIRouter()


class WitnessRef(BaseModel):
    id: str
    name: str | None


class ClaimCell(BaseModel):
    value: str
    source_doc_id: str
    chunk_id: str
    char_start: int
    char_end: int


class ComparisonRow(BaseModel):
    predicate: str
    subject_entity_id: str
    subject_label: str | None
    # witness id -> claims that witness made on this row. Empty = didn't speak.
    cells: dict[str, list[ClaimCell]]
    agreement: str  # 'agreement' | 'conflict' | 'single_source'


class WitnessComparisonResponse(BaseModel):
    witnesses: list[WitnessRef]
    rows: list[ComparisonRow]


@router.get("/{case_id}/witness-comparison", response_model=WitnessComparisonResponse)
def witness_comparison(
    case_id: str,
    entity_ids: Annotated[str, Query(description="Comma-separated witness entity IDs")],
) -> WitnessComparisonResponse:
    ids = [s.strip() for s in entity_ids.split(",") if s.strip()]
    if len(ids) < 2:
        raise HTTPException(
            status_code=400,
            detail="witness comparison requires at least 2 entity_ids",
        )
    if len(ids) > 5:
        raise HTTPException(
            status_code=400,
            detail="witness comparison supports at most 5 entity_ids",
        )

    entity_names = _load_entity_names(case_id, ids)

    # Grab every claim where one of the picked witnesses is the speaker.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT predicate, subject_entity_id, speaker_entity_id, value, "
            "       source_doc_id, chunk_id, char_start, char_end "
            "FROM claims "
            "WHERE case_id = %s AND speaker_entity_id = ANY(%s::text[]) "
            "ORDER BY predicate, subject_entity_id",
            (case_id, ids),
        )
        rows = cur.fetchall()

    # Group by (predicate, subject) -> witness id -> their claims.
    grouped: dict[tuple[str, str], dict[str, list[ClaimCell]]] = defaultdict(
        lambda: {wid: [] for wid in ids}
    )
    for r in rows:
        key = (r["predicate"], r["subject_entity_id"])
        cell = ClaimCell(
            value=r["value"],
            source_doc_id=r["source_doc_id"],
            chunk_id=r["chunk_id"],
            char_start=r["char_start"],
            char_end=r["char_end"],
        )
        grouped[key][r["speaker_entity_id"]].append(cell)

    # Look up subject names so the frontend can show "Wire transfer" instead of an id.
    subject_ids = {subject_id for _, subject_id in grouped}
    subject_labels = _load_entity_names(case_id, list(subject_ids))

    out_rows: list[ComparisonRow] = []
    for (predicate, subject_id), cells in grouped.items():
        out_rows.append(
            ComparisonRow(
                predicate=predicate,
                subject_entity_id=subject_id,
                subject_label=subject_labels.get(subject_id),
                cells=cells,
                agreement=_classify_agreement(cells),
            )
        )
    out_rows.sort(key=lambda r: (r.subject_label or r.subject_entity_id, r.predicate))

    witnesses = [WitnessRef(id=wid, name=entity_names.get(wid)) for wid in ids]
    return WitnessComparisonResponse(witnesses=witnesses, rows=out_rows)


def _classify_agreement(cells: dict[str, list[ClaimCell]]) -> str:
    """Decide if a row is agreement / conflict / single_source."""
    speaking = {wid: cs for wid, cs in cells.items() if cs}
    if len(speaking) <= 1:
        return "single_source"
    # All values match (case-insensitive, whitespace-trimmed) = agreement.
    distinct_values: set[str] = set()
    for cs in speaking.values():
        for c in cs:
            distinct_values.add(_normalize_value(c.value))
    return "agreement" if len(distinct_values) == 1 else "conflict"


def _normalize_value(v: str) -> str:
    return " ".join(v.strip().lower().split())


def _load_entity_names(case_id: str, ids: list[str]) -> dict[str, str]:
    """Look up entity names from Neo4j. Empty dict if Neo4j is down."""
    if not ids:
        return {}
    try:
        from app.graph.client import get_driver

        with get_driver().session() as session:
            result = session.run(
                "MATCH (e:Entity {case_id: $cid}) "
                "WHERE e.canonical_id IN $ids "
                "RETURN e.canonical_id AS id, e.canonical_name AS name",
                cid=case_id,
                ids=ids,
            )
            return {row["id"]: row["name"] for row in result if row["id"] and row["name"]}
    except Exception:
        return {}
