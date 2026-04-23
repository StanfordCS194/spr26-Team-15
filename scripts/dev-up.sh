#!/usr/bin/env bash
# Bring up local dev infra (Neo4j + Postgres) and wait for both to be healthy.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))
cd "$REPO_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not installed" >&2
  exit 1
fi

docker compose up -d

echo "Waiting for Neo4j + Postgres to be healthy..."
TRIES=0
MAX=40
while true; do
  NEO4J_STATUS=$(docker inspect --format='{{.State.Health.Status}}' cs194w_neo4j 2>/dev/null || echo "unknown")
  PG_STATUS=$(docker inspect --format='{{.State.Health.Status}}' cs194w_postgres 2>/dev/null || echo "unknown")
  if [[ "$NEO4J_STATUS" == "healthy" && "$PG_STATUS" == "healthy" ]]; then
    echo "Both services healthy."
    echo "  Neo4j browser: http://localhost:7474  (user: neo4j, pass: changeme_local_only)"
    echo "  Postgres:      postgresql://cs194w:cs194w@localhost:5432/cs194w"
    exit 0
  fi
  TRIES=$((TRIES + 1))
  if [[ $TRIES -ge $MAX ]]; then
    echo "ERROR: services did not become healthy within $((MAX * 3))s." >&2
    echo "  neo4j:    $NEO4J_STATUS" >&2
    echo "  postgres: $PG_STATUS" >&2
    docker compose logs --tail=50
    exit 1
  fi
  sleep 3
done
