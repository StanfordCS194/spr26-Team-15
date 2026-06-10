from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.config import get_settings, should_use_offline_demo_mode
from app.db import get_conn
from app.demo_seed import DemoPipelineStats, populate_demo_case
from app.ingestion.chunker import chunk_text
from app.ingestion.parsers import detect_and_extract
from app.pipeline import PipelineStats, run_pipeline_for_case

router = APIRouter()


class DocumentSummary(BaseModel):
    id: str
    case_id: str
    filename: str
    mime_type: str
    char_length: int


class DocumentDetail(DocumentSummary):
    text: str


class PipelineSummary(BaseModel):
    documents_processed: int
    chunks_processed: int
    chunks_failed: int
    entities_extracted: int
    relations_extracted: int
    claims_extracted: int
    events_extracted: int
    entity_clusters: int
    contradictions_found: int


class UploadDocumentResponse(BaseModel):
    document: DocumentSummary
    pipeline: PipelineSummary
    message: str


def _default_case_name(case_id: str) -> str:
    return f"Case {case_id}"


def _to_pipeline_summary(stats: PipelineStats) -> PipelineSummary:
    return PipelineSummary(
        documents_processed=stats.documents_processed,
        chunks_processed=stats.chunks_processed,
        chunks_failed=stats.chunks_failed,
        entities_extracted=stats.entities_extracted,
        relations_extracted=stats.relations_extracted,
        claims_extracted=stats.claims_extracted,
        events_extracted=stats.events_extracted,
        entity_clusters=stats.entity_clusters,
        contradictions_found=stats.contradictions_found,
    )


def _demo_stats_to_summary(stats: DemoPipelineStats) -> PipelineSummary:
    return PipelineSummary(
        documents_processed=stats.documents_processed,
        chunks_processed=stats.chunks_processed,
        chunks_failed=stats.chunks_failed,
        entities_extracted=stats.entities_extracted,
        relations_extracted=stats.relations_extracted,
        claims_extracted=stats.claims_extracted,
        events_extracted=stats.events_extracted,
        entity_clusters=stats.entity_clusters,
        contradictions_found=stats.contradictions_found,
    )


@router.post("/{case_id}/documents", response_model=UploadDocumentResponse)
async def upload_document(
    case_id: str, file: Annotated[UploadFile, File(...)]
) -> UploadDocumentResponse:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO cases (id, name) VALUES (%s, %s) "
            "ON CONFLICT (id) DO NOTHING",
            (case_id, _default_case_name(case_id)),
        )

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

    document = DocumentSummary(
        id=doc_id,
        case_id=case_id,
        filename=file.filename or "unnamed",
        mime_type=mime_type,
        char_length=len(text),
    )

    message = ""
    settings = get_settings()
    if should_use_offline_demo_mode(case_id, settings):
        demo_stats = populate_demo_case(case_id)
        if demo_stats is None:
            raise HTTPException(
                status_code=503,
                detail="Document uploaded, but offline demo data could not be populated.",
            )
        pipeline = _demo_stats_to_summary(demo_stats)
        message = (
            f"Uploaded {document.filename}. The workspace was populated using offline demo data "
            "for the canonical demo flow."
        )
        return UploadDocumentResponse(
            document=document,
            pipeline=pipeline,
            message=message,
        )

    try:
        stats = run_pipeline_for_case(case_id, wipe_first=True)
        pipeline = _to_pipeline_summary(stats)
        message = (
            f"Uploaded {document.filename} and reprocessed {stats.documents_processed} "
            f"document(s) for the case."
        )
    except Exception as e:
        demo_stats = populate_demo_case(case_id)
        if demo_stats is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Document uploaded, but case extraction could not complete. "
                    f"Reason: {e}"
                ),
            ) from e
        pipeline = _demo_stats_to_summary(demo_stats)
        message = (
            f"Uploaded {document.filename}. Live extraction was unavailable, so the "
            "workspace was populated using the offline Enron demo fallback."
        )

    return UploadDocumentResponse(
        document=document,
        pipeline=pipeline,
        message=message,
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
