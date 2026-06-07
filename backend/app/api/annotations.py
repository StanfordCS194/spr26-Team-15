from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator

from app.db import get_conn

router = APIRouter()

AnnotationTargetType = Literal["case", "document", "contradiction", "event"]


class AnnotationCreateRequest(BaseModel):
    target_type: AnnotationTargetType
    target_id: str
    target_label: str
    tag: str = ""
    title: str = ""
    body: str
    author: str

    @field_validator("target_id", "target_label", "body", "author")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("must not be empty")
        return trimmed

    @field_validator("tag", "title")
    @classmethod
    def trim_optional_text(cls, value: str) -> str:
        return value.strip()


class AnnotationRecord(BaseModel):
    id: str
    case_id: str
    target_type: AnnotationTargetType
    target_id: str
    target_label: str
    tag: str
    title: str
    body: str
    author: str
    created_at: datetime


class DeleteAnnotationResponse(BaseModel):
    ok: bool


@router.get("/{case_id}/annotations", response_model=list[AnnotationRecord])
def list_annotations(
    case_id: str,
    target_type: AnnotationTargetType | None = Query(default=None),
    target_id: str | None = Query(default=None),
) -> list[AnnotationRecord]:
    query = (
        "SELECT id, case_id, target_type, target_id, target_label, tag, title, body, author, "
        "created_at FROM annotations WHERE case_id = %s"
    )
    params: list[object] = [case_id]

    if target_type is not None:
        query += " AND target_type = %s"
        params.append(target_type)
    if target_id is not None:
        query += " AND target_id = %s"
        params.append(target_id)

    query += " ORDER BY created_at DESC"

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(query, params)
        return [AnnotationRecord(**row) for row in cur.fetchall()]


@router.post("/{case_id}/annotations", response_model=AnnotationRecord)
def create_annotation(case_id: str, body: AnnotationCreateRequest) -> AnnotationRecord:
    with get_conn() as conn, conn.cursor() as cur:
        _ensure_case_exists(cur, case_id)

        annotation_id = str(uuid4())
        cur.execute(
            "INSERT INTO annotations (id, case_id, target_type, target_id, target_label, tag, "
            "title, body, author) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING "
            "id, case_id, target_type, target_id, target_label, tag, title, body, author, "
            "created_at",
            (
                annotation_id,
                case_id,
                body.target_type,
                body.target_id,
                body.target_label,
                body.tag,
                body.title,
                body.body,
                body.author,
            ),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="annotation insert failed")
        return AnnotationRecord(**row)


@router.delete(
    "/{case_id}/annotations/{annotation_id}",
    response_model=DeleteAnnotationResponse,
)
def delete_annotation(case_id: str, annotation_id: str) -> DeleteAnnotationResponse:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM annotations WHERE case_id = %s AND id = %s RETURNING id",
            (case_id, annotation_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="annotation not found")
    return DeleteAnnotationResponse(ok=True)


def _ensure_case_exists(cur, case_id: str) -> None:
    cur.execute("SELECT 1 FROM cases WHERE id = %s", (case_id,))
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail="case not found")
