"""Postgres connection + schema bootstrap.

Prototype-scale: we lean on a small number of hand-rolled tables rather than an ORM + migrations.
When this outgrows the prototype, swap to SQLAlchemy models + Alembic.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from app.config import get_settings

SCHEMA_DDL = """
CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    char_length INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_case_id ON documents(case_id);

CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    char_start INTEGER NOT NULL,
    char_end INTEGER NOT NULL,
    text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);

-- Extraction outputs land here in raw JSON form as an audit trail.
-- Canonical form lives in Neo4j, but this makes re-runs and debugging easier.
CREATE TABLE IF NOT EXISTS extractions (
    id SERIAL PRIMARY KEY,
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    result JSONB NOT NULL,
    model TEXT NOT NULL,
    prompt_cache_hit BOOLEAN,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_extractions_chunk_id ON extractions(chunk_id);

-- Contradictions are a derived artifact but we persist them for the UI to query.
CREATE TABLE IF NOT EXISTS contradictions (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    subject_entity_id TEXT NOT NULL,
    subject_label TEXT NOT NULL DEFAULT '',
    predicate TEXT NOT NULL,
    conflicting_claim_ids JSONB NOT NULL,
    explanation TEXT NOT NULL,
    rank_score DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Migration for DBs created before subject_label existed.
ALTER TABLE contradictions ADD COLUMN IF NOT EXISTS subject_label TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_contradictions_case_id ON contradictions(case_id);

-- Claims are persisted here (not Neo4j) because their value-comparison logic is table-shaped.
CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    subject_entity_id TEXT NOT NULL,
    predicate TEXT NOT NULL,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL,
    speaker_entity_id TEXT,
    source_doc_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    char_start INTEGER NOT NULL,
    char_end INTEGER NOT NULL,
    confidence DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_case_subject_predicate ON claims(case_id, subject_entity_id, predicate);
"""


@contextmanager
def get_conn() -> Iterator[psycopg.Connection]:
    s = get_settings()
    conn = psycopg.connect(s.database_url, row_factory=dict_row, autocommit=False)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_schema() -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(SCHEMA_DDL)
