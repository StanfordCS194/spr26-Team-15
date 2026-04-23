#!/usr/bin/env bash
# Pre-demo ritual: wipe case "demo" state across both databases and optionally re-seed.
# Usage: ./scripts/reset-demo.sh           # wipe only
#        ./scripts/reset-demo.sh --seed    # wipe + re-run seed-demo
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))
cd "$REPO_ROOT"

source backend/.venv/bin/activate
export PYTHONPATH="$REPO_ROOT/backend:${PYTHONPATH:-}"

python - <<'PY'
from app.db import get_conn, init_schema
from app.graph.client import get_driver
from app.graph.writer import wipe_case

init_schema()
with get_conn() as conn, conn.cursor() as cur:
    cur.execute("DELETE FROM documents WHERE case_id = 'demo'")
    cur.execute("DELETE FROM claims WHERE case_id = 'demo'")
    cur.execute("DELETE FROM contradictions WHERE case_id = 'demo'")
wipe_case(get_driver(), "demo")
print("Wiped case 'demo' from both databases.")
PY

if [[ "${1:-}" == "--seed" ]]; then
  "$REPO_ROOT/scripts/seed-demo.sh" demo
fi
