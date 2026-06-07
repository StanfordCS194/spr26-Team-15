from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import get_conn
from app.graph.reader import read_case_events

router = APIRouter()


class CreateCaseRequest(BaseModel):
    id: str
    name: str


class CaseSummary(BaseModel):
    id: str
    name: str
    document_count: int
    entity_count: int
    contradiction_count: int


class EntityTypeCount(BaseModel):
    type: str
    count: int


class DashboardDocument(BaseModel):
    id: str
    filename: str
    mime_type: str
    char_length: int
    created_at: str


class DashboardEvent(BaseModel):
    id: str
    description: str
    occurred_at: str
    participant_count: int
    participants: list[str]


class DashboardContradiction(BaseModel):
    id: str
    subject_entity_id: str
    subject_entity_name: str | None
    predicate: str
    explanation: str
    rank_score: float
    claim_count: int


class DashboardDateRange(BaseModel):
    start: str | None
    end: str | None


class CaseDashboard(BaseModel):
    summary: CaseSummary
    event_count: int
    date_range: DashboardDateRange
    entity_breakdown: list[EntityTypeCount]
    recent_documents: list[DashboardDocument]
    timeline_highlights: list[DashboardEvent]
    top_contradictions: list[DashboardContradiction]


@router.get("", response_model=list[CaseSummary])
def list_cases() -> list[CaseSummary]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT c.id, c.name, "
            "COUNT(DISTINCT d.id) AS doc_count, "
            "COUNT(DISTINCT co.id) AS contra_count "
            "FROM cases c "
            "LEFT JOIN documents d ON d.case_id = c.id "
            "LEFT JOIN contradictions co ON co.case_id = c.id "
            "GROUP BY c.id, c.name "
            "ORDER BY c.created_at DESC",
        )
        rows = cur.fetchall()

    entity_counts: dict[str, int] = {}
    try:
        from app.graph.client import get_driver

        with get_driver().session() as session:
            result = session.run(
                "MATCH (e:Entity) RETURN e.case_id AS case_id, count(e) AS c"
            )
            for row in result:
                if row["case_id"]:
                    entity_counts[row["case_id"]] = row["c"]
    except Exception:
        pass

    return [
        CaseSummary(
            id=r["id"],
            name=r["name"],
            document_count=r["doc_count"],
            entity_count=entity_counts.get(r["id"], 0),
            contradiction_count=r["contra_count"],
        )
        for r in rows
    ]


@router.post("", response_model=CaseSummary)
def create_case(body: CreateCaseRequest) -> CaseSummary:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO cases (id, name) VALUES (%s, %s) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name",
            (body.id, body.name),
        )
    return CaseSummary(
        id=body.id, name=body.name, document_count=0, entity_count=0, contradiction_count=0
    )


@router.get("", response_model=list[CaseSummary])
def list_cases() -> list[CaseSummary]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT c.id, c.name, "
            "COUNT(DISTINCT d.id) AS document_count, "
            "COUNT(DISTINCT ct.id) AS contradiction_count "
            "FROM cases c "
            "LEFT JOIN documents d ON d.case_id = c.id "
            "LEFT JOIN contradictions ct ON ct.case_id = c.id "
            "GROUP BY c.id, c.name, c.created_at "
            "ORDER BY c.created_at DESC"
        )
        rows = cur.fetchall()

    entity_counts = _load_entity_counts_for_cases([row["id"] for row in rows])
    return [
        CaseSummary(
            id=row["id"],
            name=row["name"],
            document_count=row["document_count"],
            entity_count=entity_counts.get(row["id"], 0),
            contradiction_count=row["contradiction_count"],
        )
        for row in rows
    ]


@router.get("/{case_id}", response_model=CaseSummary)
def get_case(case_id: str) -> CaseSummary:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, name FROM cases WHERE id = %s", (case_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="case not found")

        cur.execute("SELECT COUNT(*) AS c FROM documents WHERE case_id = %s", (case_id,))
        doc_count = cur.fetchone()["c"]

        cur.execute(
            "SELECT COUNT(*) AS c FROM contradictions WHERE case_id = %s", (case_id,)
        )
        contra_count = cur.fetchone()["c"]

    return CaseSummary(
        id=row["id"],
        name=row["name"],
        document_count=doc_count,
        entity_count=_load_entity_count(case_id),
        contradiction_count=contra_count,
    )


@router.get("/{case_id}/dashboard", response_model=CaseDashboard)
def get_case_dashboard(case_id: str) -> CaseDashboard:
    summary = get_case(case_id)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, filename, mime_type, char_length, created_at "
            "FROM documents WHERE case_id = %s "
            "ORDER BY created_at DESC LIMIT 5",
            (case_id,),
        )
        recent_documents = [
            DashboardDocument(
                id=row["id"],
                filename=row["filename"],
                mime_type=row["mime_type"],
                char_length=row["char_length"],
                created_at=row["created_at"].isoformat(),
            )
            for row in cur.fetchall()
        ]

        subject_names = _load_subject_names(case_id)
        cur.execute(
            "SELECT id, subject_entity_id, subject_label, predicate, explanation, "
            "rank_score, jsonb_array_length(conflicting_claim_ids) AS claim_count "
            "FROM contradictions WHERE case_id = %s "
            "ORDER BY rank_score DESC LIMIT 5",
            (case_id,),
        )
        top_contradictions = [
            DashboardContradiction(
                id=row["id"],
                subject_entity_id=row["subject_entity_id"],
                subject_entity_name=(
                    subject_names.get(row["subject_entity_id"]) or row["subject_label"] or None
                ),
                predicate=row["predicate"],
                explanation=row["explanation"],
                rank_score=float(row["rank_score"]),
                claim_count=row["claim_count"],
            )
            for row in cur.fetchall()
        ]

    events = read_case_events(case_id)
    timeline_highlights = [
        DashboardEvent(
            id=event["id"],
            description=event["description"],
            occurred_at=event["occurred_at"],
            participant_count=len(event["participants"]),
            participants=[participant["name"] for participant in event["participants"]],
        )
        for event in _select_timeline_highlights(events)
    ]

    return CaseDashboard(
        summary=summary,
        event_count=len(events),
        date_range=DashboardDateRange(
            start=events[0]["occurred_at"] if events else None,
            end=events[-1]["occurred_at"] if events else None,
        ),
        entity_breakdown=_load_entity_breakdown(case_id),
        recent_documents=recent_documents,
        timeline_highlights=timeline_highlights,
        top_contradictions=top_contradictions,
    )


def _load_entity_count(case_id: str) -> int:
    return _load_entity_counts_for_cases([case_id]).get(case_id, 0)


def _load_entity_counts_for_cases(case_ids: list[str]) -> dict[str, int]:
    if not case_ids:
        return {}

    try:
        from app.graph.client import get_driver

        with get_driver().session() as session:
            result = session.run(
                "MATCH (e:Entity) "
                "WHERE e.case_id IN $case_ids "
                "RETURN e.case_id AS case_id, count(e) AS c",
                case_ids=case_ids,
            )
            return {row["case_id"]: row["c"] for row in result if row["case_id"]}
    except Exception:
        return {}


def _load_entity_breakdown(case_id: str) -> list[EntityTypeCount]:
    try:
        from app.graph.client import get_driver

        with get_driver().session() as session:
            result = session.run(
                "MATCH (e:Entity {case_id: $cid}) "
                "RETURN e.type AS type, count(e) AS c "
                "ORDER BY c DESC, type ASC",
                cid=case_id,
            )
            return [
                EntityTypeCount(type=row["type"], count=row["c"])
                for row in result
                if row["type"]
            ]
    except Exception:
        return []


def _load_subject_names(case_id: str) -> dict[str, str]:
    try:
        from app.graph.client import get_driver

        with get_driver().session() as session:
            result = session.run(
                "MATCH (e:Entity {case_id: $cid}) "
                "RETURN e.canonical_id AS id, e.canonical_name AS name",
                cid=case_id,
            )
            return {row["id"]: row["name"] for row in result if row["id"] and row["name"]}
    except Exception:
        return {}


def _select_timeline_highlights(events: list[dict], limit: int = 5) -> list[dict]:
    if len(events) <= limit:
        return events

    midpoint = min(2, len(events))
    tail_count = max(limit - midpoint, 0)
    leading = events[:midpoint]
    trailing = events[-tail_count:] if tail_count else []

    ordered: list[dict] = []
    seen: set[str] = set()
    for event in [*leading, *trailing]:
        event_id = event.get("id")
        if event_id in seen:
            continue
        seen.add(event_id)
        ordered.append(event)
    return ordered[:limit]
