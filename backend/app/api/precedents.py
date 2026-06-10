from __future__ import annotations

import json
import logging

from fastapi import APIRouter
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.db import get_conn
from app.llm import AnthropicProvider, make_provider

logger = logging.getLogger(__name__)
router = APIRouter()


class Precedent(BaseModel):
    title: str
    citation: str
    area_of_law: str
    relevance: str


class _PrecedentList(BaseModel):
    precedents: list[Precedent]


_SYSTEM = """\
You are a legal research assistant helping attorneys identify relevant case law.
Given a summary of facts, contradictions, and claims extracted from case documents, \
suggest 3 to 5 real, well-known legal precedents that are directly relevant.

For each precedent provide:
- title: the case name (e.g. "Miranda v. Arizona")
- citation: the official citation (e.g. "384 U.S. 436 (1966)")
- area_of_law: a short label such as "Criminal Procedure" or "Contract Law"
- relevance: one sentence explaining which specific facts or issues in this case it applies to

Only suggest real, verifiable cases. Prefer landmark or widely-cited precedents.
You MUST respond with a JSON object containing exactly one key called "precedents" \
whose value is an array of precedent objects. Example structure:
{"precedents": [{"title": "...", "citation": "...", "area_of_law": "...", "relevance": "..."}]}
"""


@router.get("/{case_id}/precedents", response_model=list[Precedent])
def list_precedents(case_id: str) -> list[Precedent]:
    doc_count = _get_document_count(case_id)

    cached = _read_cache(case_id, doc_count)
    if cached is not None:
        return cached

    facts = _load_case_facts(case_id)
    if not facts:
        return []

    precedents = _call_llm(case_id, facts)
    if precedents:
        _write_cache(case_id, doc_count, precedents)
    return precedents


def _get_document_count(case_id: str) -> int:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM documents WHERE case_id = %s", (case_id,))
        return cur.fetchone()["c"]


def _read_cache(case_id: str, doc_count: int) -> list[Precedent] | None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT results FROM precedent_cache WHERE case_id = %s AND document_count = %s",
            (case_id, doc_count),
        )
        row = cur.fetchone()
    if row is None:
        return None
    try:
        return [Precedent.model_validate(item) for item in row["results"]]
    except Exception:
        return None


def _write_cache(case_id: str, doc_count: int, precedents: list[Precedent]) -> None:
    payload = json.dumps([p.model_dump() for p in precedents])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO precedent_cache (case_id, document_count, results)
            VALUES (%s, %s, %s::jsonb)
            ON CONFLICT (case_id) DO UPDATE
                SET document_count = EXCLUDED.document_count,
                    results = EXCLUDED.results,
                    created_at = NOW()
            """,
            (case_id, doc_count, payload),
        )


def _call_llm(case_id: str, facts: str) -> list[Precedent]:
    try:
        settings = get_settings()
        base = make_provider(settings)
        # Use the cheaper resolution model for Anthropic to reduce cost.
        if isinstance(base, AnthropicProvider):
            provider = AnthropicProvider(
                api_key=settings.anthropic_api_key,
                model=settings.resolution_model,
            )
        else:
            provider = base

        result, _ = provider.parse(
            messages=[{"role": "user", "content": f"Case facts:\n\n{facts}"}],
            system=_SYSTEM,
            output_format=_PrecedentList,
            max_tokens=1024,
        )
        return result.precedents
    except Exception as e:
        # Groq json_object mode doesn't enforce the schema key name; recover by
        # pulling the actual input dict out of pydantic's ValidationError and
        # scanning it for the first list value.
        if isinstance(e, ValidationError):
            errors = e.errors()
            if errors:
                payload = errors[0].get("input")
                if isinstance(payload, dict):
                    for v in payload.values():
                        if isinstance(v, list):
                            try:
                                return [Precedent.model_validate(item) for item in v]
                            except Exception:
                                pass
        logger.exception("Precedent LLM call failed for case %s", case_id)
        return []


def _load_case_facts(case_id: str) -> str:
    """Build a short fact summary from contradictions and claims stored in Postgres."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT predicate, explanation FROM contradictions "
            "WHERE case_id = %s ORDER BY rank_score DESC LIMIT 5",
            (case_id,),
        )
        contradictions = cur.fetchall()

        cur.execute(
            "SELECT value FROM claims WHERE case_id = %s LIMIT 15",
            (case_id,),
        )
        claims = cur.fetchall()

    if not contradictions and not claims:
        return ""

    lines: list[str] = []
    if contradictions:
        lines.append("Key contradictions identified in the case:")
        for c in contradictions:
            lines.append(f"  - {c['predicate']}: {c['explanation']}")
    if claims:
        lines.append("\nFactual claims extracted from case documents:")
        for cl in claims:
            lines.append(f"  - {cl['value']}")
    return "\n".join(lines)
