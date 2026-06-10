from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import get_conn

logger = logging.getLogger(__name__)

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
    except Exception as e:
        logger.warning("Neo4j unavailable, entity counts will be 0: %s", e)

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

    # Entity count comes from Neo4j; return 0 if unavailable so the endpoint still works.
    entity_count = 0
    try:
        from app.graph.client import get_driver

        with get_driver().session() as session:
            result = session.run(
                "MATCH (e:Entity {case_id: $cid}) RETURN count(e) AS c",
                cid=case_id,
            )
            entity_count = result.single()["c"]
    except Exception as e:
        logger.warning("Neo4j unavailable, entity_count will be 0: %s", e)

    return CaseSummary(
        id=row["id"],
        name=row["name"],
        document_count=doc_count,
        entity_count=entity_count,
        contradiction_count=contra_count,
    )
