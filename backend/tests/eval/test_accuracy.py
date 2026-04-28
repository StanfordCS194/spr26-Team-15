"""Accuracy evaluation harness. Runs only under pytest -m live.

Depends on:
  - A running pipeline (Neo4j + Postgres + Anthropic API key)
  - Case "demo" already seeded via ./scripts/seed-demo.sh

Emits an eval_report.md at the repo root with metrics + a diff-friendly summary.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from app.db import get_conn
from app.graph.client import get_driver

from .metrics import score_contradiction_detection, score_entity_extraction

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
GROUND_TRUTH = REPO_ROOT / "data" / "enron_seed" / "ground_truth.json"
REPORT = REPO_ROOT / "eval_report.md"


@pytest.mark.live
def test_eval_demo_case() -> None:
    truth = json.loads(GROUND_TRUTH.read_text())

    # --- Fetch predicted state ---
    with get_driver().session() as session:
        ent_rows = session.run(
            "MATCH (e:Entity {case_id: 'demo'}) RETURN e.canonical_id AS id, e.type AS type, "
            "e.canonical_name AS canonical_name"
        )
        predicted_entities = [dict(r) for r in ent_rows]

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, subject_entity_id, predicate FROM contradictions WHERE case_id = 'demo'"
        )
        predicted_contradictions = [dict(r) for r in cur.fetchall()]

    # --- Score ---
    entity_prf = score_entity_extraction(predicted_entities, truth["entities"])
    entity_name_by_id = {e["id"]: (e.get("canonical_name") or "") for e in predicted_entities}
    contra_prf = score_contradiction_detection(
        predicted_contradictions,
        truth["contradictions"],
        predicted_entity_name_by_id=entity_name_by_id,
    )

    # --- Report ---
    report = (
        "# Evaluation Report\n\n"
        f"Corpus: {GROUND_TRUTH.relative_to(REPO_ROOT)}\n\n"
        "## Entity extraction / resolution\n"
        f"- precision: **{entity_prf.precision:.3f}**  recall: **{entity_prf.recall:.3f}**  "
        f"F1: **{entity_prf.f1:.3f}**  (tp={entity_prf.true_positives} "
        f"fp={entity_prf.false_positives} fn={entity_prf.false_negatives})\n\n"
        "## Contradiction detection\n"
        f"- precision: **{contra_prf.precision:.3f}**  recall: **{contra_prf.recall:.3f}**  "
        f"F1: **{contra_prf.f1:.3f}**  (tp={contra_prf.true_positives} "
        f"fp={contra_prf.false_positives} fn={contra_prf.false_negatives})\n"
    )
    REPORT.write_text(report)

    # --- Gate — fails the test (and CI) if we regress below PRD initial targets ---
    assert entity_prf.f1 >= 0.50, (
        f"entity F1 {entity_prf.f1:.3f} below acceptance threshold 0.50 — see eval_report.md"
    )
    # Contradiction recall must hit at least one of the three labeled cases.
    assert contra_prf.recall >= 1 / 3 - 1e-9, (
        f"contradiction recall {contra_prf.recall:.3f} below acceptance threshold 0.33"
    )
