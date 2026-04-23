#!/usr/bin/env bash
# End-to-end: wipe case "demo", ingest the Enron seed corpus, run extraction + resolution +
# contradictions, and verify basic counts against data/enron_seed/manifest.json.
#
# Requires:
#   - ./scripts/dev-up.sh has been run (Neo4j + Postgres reachable)
#   - backend .venv installed with [dev] extras
#   - ANTHROPIC_API_KEY in .env (or exported)
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))
cd "$REPO_ROOT"

CASE_ID="${1:-demo}"

if [[ ! -d backend/.venv ]]; then
  echo "ERROR: backend/.venv not found. Run: (cd backend && python -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]')" >&2
  exit 1
fi

# shellcheck disable=SC1091
source backend/.venv/bin/activate

export PYTHONPATH="$REPO_ROOT/backend:${PYTHONPATH:-}"

python - <<PY
import os, sys, json, pathlib
from app.db import init_schema, get_conn
from app.pipeline import run_pipeline_for_case
from app.ingestion.parsers import detect_and_extract
from app.ingestion.chunker import chunk_text
import uuid

CASE_ID = "${CASE_ID}"
SEED_DIR = pathlib.Path("data/enron_seed")
manifest = json.loads((SEED_DIR / "manifest.json").read_text())

init_schema()

with get_conn() as conn, conn.cursor() as cur:
    cur.execute("INSERT INTO cases (id, name) VALUES (%s, %s) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name",
                (CASE_ID, manifest["case_name"]))
    # Wipe prior docs so ingest is idempotent
    cur.execute("DELETE FROM documents WHERE case_id = %s", (CASE_ID,))

ingested = 0
for doc in manifest["documents"]:
    path = SEED_DIR / doc["path"]
    data = path.read_bytes()
    text, mime = detect_and_extract(path.name, None, data)
    doc_id = str(uuid.uuid4())
    chunks = chunk_text(text)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO documents (id, case_id, filename, mime_type, raw_text, char_length) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (doc_id, CASE_ID, path.name, mime, text, len(text)),
        )
        for i, ch in enumerate(chunks):
            cur.execute(
                "INSERT INTO chunks (id, document_id, ordinal, char_start, char_end, text) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (f"{doc_id}:{i}", doc_id, i, ch.char_start, ch.char_end, ch.text),
            )
    ingested += 1

print(f"Ingested {ingested} documents. Running pipeline...")
stats = run_pipeline_for_case(CASE_ID, wipe_first=True)
print(json.dumps({
    "case_id": stats.case_id,
    "documents_processed": stats.documents_processed,
    "chunks_processed": stats.chunks_processed,
    "chunks_failed": stats.chunks_failed,
    "entities_extracted": stats.entities_extracted,
    "relations_extracted": stats.relations_extracted,
    "claims_extracted": stats.claims_extracted,
    "events_extracted": stats.events_extracted,
    "entity_clusters": stats.entity_clusters,
    "contradictions_found": stats.contradictions_found,
    "input_tokens": stats.total_input_tokens,
    "output_tokens": stats.total_output_tokens,
    "cache_read_input_tokens": stats.cache_read_input_tokens,
    "cache_creation_input_tokens": stats.cache_creation_input_tokens,
}, indent=2))

expected_min_entities = manifest.get("expected_entity_minimum", 0)
expected_contradictions = len(manifest.get("expected_contradictions", []))
failed = []
if stats.entity_clusters < expected_min_entities:
    failed.append(f"entity_clusters={stats.entity_clusters} < expected>={expected_min_entities}")
if stats.contradictions_found < max(1, expected_contradictions - 1):
    failed.append(f"contradictions={stats.contradictions_found} below expected {expected_contradictions}")
if failed:
    print("FAILED acceptance checks:", "; ".join(failed), file=sys.stderr)
    sys.exit(2)
print("OK")
PY
