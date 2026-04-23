from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.db import get_conn
from app.ingestion.chunker import chunk_text
from app.ingestion.parsers import detect_and_extract

router = APIRouter()


class DocumentSummary(BaseModel):
    id: str
    case_id: str
    filename: str
    mime_type: str
    char_length: int


class DocumentDetail(DocumentSummary):
    text: str


@router.post("/{case_id}/documents", response_model=DocumentSummary)
async def upload_document(
    case_id: str, file: Annotated[UploadFile, File(...)]
) -> DocumentSummary:
    # Ensure case exists.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM cases WHERE id = %s", (case_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="case not found; create it first")

    raw_bytes = await file.read()
    try:
        text, mime_type = detect_and_extract(
            filename=file.filename or "unnamed",
            content_type=file.content_type,
            data=raw_bytes,
        )
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e)) from e

    doc_id = str(uuid.uuid4())
    chunks = chunk_text(text)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO documents (id, case_id, filename, mime_type, raw_text, char_length) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (doc_id, case_id, file.filename or "unnamed", mime_type, text, len(text)),
        )
        for i, ch in enumerate(chunks):
            chunk_id = f"{doc_id}:{i}"
            cur.execute(
                "INSERT INTO chunks (id, document_id, ordinal, char_start, char_end, text) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (chunk_id, doc_id, i, ch.char_start, ch.char_end, ch.text),
            )

    return DocumentSummary(
        id=doc_id,
        case_id=case_id,
        filename=file.filename or "unnamed",
        mime_type=mime_type,
        char_length=len(text),
    )


@router.get("/{case_id}/documents", response_model=list[DocumentSummary])
def list_documents(case_id: str) -> list[DocumentSummary]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, case_id, filename, mime_type, char_length FROM documents WHERE case_id = %s ORDER BY created_at",
            (case_id,),
        )
        rows = cur.fetchall()
    return [DocumentSummary(**r) for r in rows]


@router.get("/{case_id}/documents/{doc_id}", response_model=DocumentDetail)
def get_document(case_id: str, doc_id: str) -> DocumentDetail:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, case_id, filename, mime_type, char_length, raw_text FROM documents "
            "WHERE case_id = %s AND id = %s",
            (case_id, doc_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="document not found")
    return DocumentDetail(
        id=row["id"],
        case_id=row["case_id"],
        filename=row["filename"],
        mime_type=row["mime_type"],
        char_length=row["char_length"],
        text=row["raw_text"],
    )
