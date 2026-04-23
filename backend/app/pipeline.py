"""Orchestrates the full extraction → resolution → graph → contradictions pipeline for a case.

Runs synchronously for the prototype. If we outgrow this, move per-chunk extraction into
a worker queue (Celery/Arq); the surface here stays the same.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass

from app.contradictions.detector import ContradictionRecord, detect_contradictions
from app.db import get_conn
from app.extraction.client import ExtractionClient, ExtractionValidationError
from app.graph.client import get_driver
from app.graph.writer import (
    init_graph_schema,
    resolve_entity_for_write,
    resolve_event_for_write,
    resolve_relation_for_write,
    upsert_entity,
    upsert_event,
    upsert_relation,
    wipe_case,
)
from app.models.extraction import Claim, Entity, Event, ExtractionResult, Relation
from app.resolution.resolver import build_local_to_canonical, resolve_entities

logger = logging.getLogger(__name__)


@dataclass
class PipelineStats:
    case_id: str
    documents_processed: int = 0
    chunks_processed: int = 0
    chunks_failed: int = 0
    entities_extracted: int = 0
    relations_extracted: int = 0
    claims_extracted: int = 0
    events_extracted: int = 0
    entity_clusters: int = 0
    contradictions_found: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


def run_pipeline_for_case(
    case_id: str,
    *,
    extraction_client: ExtractionClient | None = None,
    wipe_first: bool = False,
) -> PipelineStats:
    """Run extraction → resolution → graph → contradictions for every chunk in the case.

    Idempotent: safe to re-run. Pass wipe_first=True to start from a clean slate.
    """
    client = extraction_client or ExtractionClient()
    stats = PipelineStats(case_id=case_id)

    driver = get_driver()
    init_graph_schema(driver)
    if wipe_first:
        wipe_case(driver, case_id)
        _wipe_postgres_derived_state(case_id)

    per_chunk_results: list[tuple[str, str, ExtractionResult]] = []
    doc_ids_seen: set[str] = set()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT d.id AS doc_id, c.id AS chunk_id, c.char_start AS char_start, c.text AS chunk_text "
            "FROM documents d JOIN chunks c ON c.document_id = d.id "
            "WHERE d.case_id = %s ORDER BY d.created_at, c.ordinal",
            (case_id,),
        )
        rows = cur.fetchall()

    for row in rows:
        doc_id = row["doc_id"]
        chunk_id = row["chunk_id"]
        chunk_text = row["chunk_text"]
        char_offset_in_doc = row["char_start"]

        doc_ids_seen.add(doc_id)

        try:
            outcome = client.extract(
                chunk_text=chunk_text,
                source_doc_id=doc_id,
                chunk_id=chunk_id,
                char_offset_in_doc=char_offset_in_doc,
            )
        except ExtractionValidationError as e:
            logger.exception("extraction failed for chunk %s: %s", chunk_id, e)
            stats.chunks_failed += 1
            continue

        per_chunk_results.append((doc_id, chunk_id, outcome.result))
        stats.chunks_processed += 1
        stats.total_input_tokens += outcome.usage.input_tokens
        stats.total_output_tokens += outcome.usage.output_tokens
        stats.cache_read_input_tokens += outcome.usage.cache_read_input_tokens
        stats.cache_creation_input_tokens += outcome.usage.cache_creation_input_tokens

        _persist_extraction(chunk_id, outcome, stats)

    stats.documents_processed = len(doc_ids_seen)

    # --- Resolution across all chunks ---
    all_entities: list[Entity] = []
    all_relations: list[Relation] = []
    all_claims: list[Claim] = []
    all_events: list[Event] = []
    # Locally extracted IDs collide across chunks ("e1" in every chunk), so namespace by chunk.
    namespaced_entities: list[Entity] = []
    namespace_map: dict[str, str] = {}  # original local ID → namespaced ID

    def _ns(chunk_id: str, local_id: str) -> str:
        return f"{chunk_id}::{local_id}"

    for _doc_id, chunk_id, result in per_chunk_results:
        for e in result.entities:
            new_id = _ns(chunk_id, e.id)
            namespace_map[_ns(chunk_id, e.id)] = new_id
            namespaced_entities.append(e.model_copy(update={"id": new_id}))
        for r in result.relations:
            all_relations.append(
                r.model_copy(
                    update={
                        "id": _ns(chunk_id, r.id),
                        "subject_id": _ns(chunk_id, r.subject_id),
                        "object_id": _ns(chunk_id, r.object_id),
                    }
                )
            )
        for c in result.claims:
            speaker = (
                _ns(chunk_id, c.speaker_entity_id) if c.speaker_entity_id else None
            )
            all_claims.append(
                c.model_copy(
                    update={
                        "id": _ns(chunk_id, c.id),
                        "subject_entity_id": _ns(chunk_id, c.subject_entity_id),
                        "speaker_entity_id": speaker,
                    }
                )
            )
        for ev in result.events:
            all_events.append(
                ev.model_copy(
                    update={
                        "id": _ns(chunk_id, ev.id),
                        "participant_ids": [_ns(chunk_id, p) for p in ev.participant_ids],
                        "location_entity_id": _ns(chunk_id, ev.location_entity_id)
                        if ev.location_entity_id
                        else None,
                    }
                )
            )

    all_entities = namespaced_entities
    clusters = resolve_entities(all_entities)
    local_to_canonical = build_local_to_canonical(clusters)
    stats.entity_clusters = len(clusters)

    # Cluster canonical-name lookup
    canonical_info = {c.canonical_id: (c.canonical_name, c.type) for c in clusters}

    # --- Graph writes ---
    # Pick one representative entity per cluster for the canonical row, then append each
    # original mention as additional provenance.
    cluster_to_members: dict[str, list[Entity]] = {}
    for e in all_entities:
        cid = local_to_canonical[e.id]
        cluster_to_members.setdefault(cid, []).append(e)

    for cid, members in cluster_to_members.items():
        canonical_name = canonical_info[cid][0]
        for m in members:
            upsert_entity(driver, resolve_entity_for_write(m, cid, canonical_name, case_id))

    for r in all_relations:
        subj = local_to_canonical.get(r.subject_id)
        obj = local_to_canonical.get(r.object_id)
        if not subj or not obj:
            continue  # dangling refs were flagged upstream; skip defensively
        upsert_relation(driver, resolve_relation_for_write(r, subj, obj, case_id))

    for ev in all_events:
        participants = [
            local_to_canonical[p] for p in ev.participant_ids if p in local_to_canonical
        ]
        event_canonical_id = _event_canonical_id(ev)
        upsert_event(
            driver,
            resolve_event_for_write(ev, event_canonical_id, participants, case_id),
        )

    # --- Contradictions ---
    contradictions = detect_contradictions(all_claims, local_to_canonical=local_to_canonical)
    stats.contradictions_found = len(contradictions)
    _persist_claims_and_contradictions(case_id, all_claims, local_to_canonical, contradictions)

    return stats


def _persist_extraction(chunk_id: str, outcome, stats) -> None:
    """Append tallies and persist the raw extraction for audit."""
    result = outcome.result
    stats.entities_extracted += len(result.entities)
    stats.relations_extracted += len(result.relations)
    stats.claims_extracted += len(result.claims)
    stats.events_extracted += len(result.events)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO extractions (chunk_id, result, model, prompt_cache_hit, input_tokens, output_tokens) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (
                chunk_id,
                json.dumps(result.model_dump(mode="json")),
                outcome.model,
                outcome.usage.cache_read_input_tokens > 0,
                outcome.usage.input_tokens,
                outcome.usage.output_tokens,
            ),
        )


def _persist_claims_and_contradictions(
    case_id: str,
    claims: list[Claim],
    local_to_canonical: dict[str, str],
    contradictions: list[ContradictionRecord],
) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        # Wipe and rewrite derived state for this case — pipeline is idempotent by design.
        cur.execute("DELETE FROM claims WHERE case_id = %s", (case_id,))
        cur.execute("DELETE FROM contradictions WHERE case_id = %s", (case_id,))
        for c in claims:
            canonical_subject = local_to_canonical.get(
                c.subject_entity_id, c.subject_entity_id
            )
            canonical_speaker = (
                local_to_canonical.get(c.speaker_entity_id)
                if c.speaker_entity_id
                else None
            )
            cur.execute(
                "INSERT INTO claims (id, case_id, subject_entity_id, predicate, value, value_type, "
                "speaker_entity_id, source_doc_id, chunk_id, char_start, char_end, confidence) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (id) DO NOTHING",
                (
                    c.id,
                    case_id,
                    canonical_subject,
                    c.predicate,
                    c.value,
                    c.value_type,
                    canonical_speaker,
                    c.provenance.source_doc_id,
                    c.provenance.chunk_id,
                    c.provenance.char_start,
                    c.provenance.char_end,
                    c.confidence,
                ),
            )
        for contra in contradictions:
            cur.execute(
                "INSERT INTO contradictions (id, case_id, subject_entity_id, predicate, "
                "conflicting_claim_ids, explanation, rank_score) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (id) DO NOTHING",
                (
                    contra.id,
                    case_id,
                    contra.subject_entity_id,
                    contra.predicate,
                    json.dumps(contra.conflicting_claim_ids),
                    "",  # LLM-generated explanation is a follow-up; leave empty for v1
                    contra.rank_score,
                ),
            )


def _wipe_postgres_derived_state(case_id: str) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM extractions WHERE chunk_id IN "
            "(SELECT c.id FROM chunks c JOIN documents d ON c.document_id = d.id WHERE d.case_id = %s)",
            (case_id,),
        )
        cur.execute("DELETE FROM claims WHERE case_id = %s", (case_id,))
        cur.execute("DELETE FROM contradictions WHERE case_id = %s", (case_id,))


def _event_canonical_id(event: Event) -> str:
    key = f"{event.description.strip().lower()}|{event.occurred_at}"
    return "evt_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
