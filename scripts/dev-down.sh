#!/usr/bin/env bash
# Tear down local dev infra. Preserves volumes by default; pass --volumes to wipe.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

if [[ "${1:-}" == "--volumes" ]]; then
  docker compose down -v
  echo "Containers + volumes removed."
else
  docker compose down
  echo "Containers removed. Volumes preserved (pass --volumes to wipe)."
fi
