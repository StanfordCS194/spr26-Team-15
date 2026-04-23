from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import get_conn

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
    except Exception:
        pass

    return CaseSummary(
        id=row["id"],
        name=row["name"],
        document_count=doc_count,
        entity_count=entity_count,
        contradiction_count=contra_count,
    )
