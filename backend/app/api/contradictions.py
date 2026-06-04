from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.db import get_conn

router = APIRouter()


class ClaimExcerpt(BaseModel):
    claim_id: str
    value: str
    speaker_entity_id: str | None
    speaker_entity_name: str | None
    source_doc_id: str
    chunk_id: str
    char_start: int
    char_end: int
    excerpt: str


class ContradictionDetail(BaseModel):
    id: str
    subject_entity_id: str
    subject_entity_name: str | None
    predicate: str
    explanation: str
    rank_score: float
    claims: list[ClaimExcerpt]


@router.get("/{case_id}/contradictions", response_model=list[ContradictionDetail])
def list_contradictions(case_id: str) -> list[ContradictionDetail]:
    with get_conn() as conn, conn.cursor() as cur:
        subject_names = _load_subject_names(case_id)
        cur.execute(
            "SELECT id, subject_entity_id, subject_label, predicate, conflicting_claim_ids, "
            "explanation, rank_score "
            "FROM contradictions WHERE case_id = %s ORDER BY rank_score DESC",
            (case_id,),
        )
        contras = cur.fetchall()

        out: list[ContradictionDetail] = []
        for c in contras:
            claim_ids = c["conflicting_claim_ids"]
            cur.execute(
                "SELECT cl.id, cl.value, cl.speaker_entity_id, cl.source_doc_id, cl.chunk_id, "
                "cl.char_start, cl.char_end, d.raw_text "
                "FROM claims cl JOIN documents d ON d.id = cl.source_doc_id "
                "WHERE cl.id = ANY(%s::text[])",
                (list(claim_ids),),
            )
            rows = cur.fetchall()
            excerpts = [
                ClaimExcerpt(
                    claim_id=r["id"],
                    value=r["value"],
                    speaker_entity_id=r["speaker_entity_id"],
                    speaker_entity_name=subject_names.get(r["speaker_entity_id"])
                    if r["speaker_entity_id"]
                    else None,
                    source_doc_id=r["source_doc_id"],
                    chunk_id=r["chunk_id"],
                    char_start=r["char_start"],
                    char_end=r["char_end"],
                    excerpt=r["raw_text"][
                        max(0, r["char_start"] - 100) : r["char_end"] + 100
                    ],
                )
                for r in rows
            ]
            out.append(
                ContradictionDetail(
                    id=c["id"],
                    subject_entity_id=c["subject_entity_id"],
                    subject_entity_name=(
                        subject_names.get(c["subject_entity_id"])
                        or (c["subject_label"] or None)
                    ),
                    predicate=c["predicate"],
                    explanation=c["explanation"],
                    rank_score=float(c["rank_score"]),
                    claims=excerpts,
                )
            )
    return out


def _load_subject_names(case_id: str) -> dict[str, str]:
    try:
        from app.graph.client import get_driver

        with get_driver().session() as session:
            result = session.run(
                "MATCH (e:Entity {case_id: $cid}) "
                "RETURN e.canonical_id AS id, e.canonical_name AS name",
                cid=case_id,
            )
            return {
                row["id"]: row["name"]
                for row in result
                if row["id"] and row["name"]
            }
    except Exception:
        return {}
