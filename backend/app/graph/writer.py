"""Write resolved entities + relations + events to Neo4j, idempotently.

Graph model:
  (:Entity {canonical_id, case_id, type, canonical_name, mention_texts[], provenance[]})
  -[:RELATES {type, qualifiers, provenance[]}]->(:Entity)

Provenance is a list (not a scalar) because the same (canonical_entity, relation_type,
canonical_entity) pair may be supported by many source excerpts across the corpus.
Each provenance entry is "doc_id:chunk_id:start-end".
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from neo4j import Driver

from app.models.extraction import Entity, Event, Relation


@dataclass(frozen=True)
class ResolvedEntity:
    """Entity with its local ID already replaced by the canonical ID."""

    canonical_id: str
    case_id: str
    type: str
    canonical_name: str
    mention_text: str
    provenance_str: str  # "doc_id:chunk_id:start-end"


@dataclass(frozen=True)
class ResolvedRelation:
    case_id: str
    subject_canonical_id: str
    object_canonical_id: str
    type: str
    qualifiers: dict[str, str]
    provenance_str: str


@dataclass(frozen=True)
class ResolvedEvent:
    case_id: str
    event_id: str  # canonical event ID (hash of (description, occurred_at))
    description: str
    occurred_at: str
    participant_canonical_ids: list[str]
    provenance_str: str


def _prov_str(e_or_r) -> str:
    p = e_or_r.provenance
    return f"{p.source_doc_id}:{p.chunk_id}:{p.char_start}-{p.char_end}"


def resolve_entity_for_write(
    entity: Entity, canonical_id: str, canonical_name: str, case_id: str
) -> ResolvedEntity:
    return ResolvedEntity(
        canonical_id=canonical_id,
        case_id=case_id,
        type=entity.type.value,
        canonical_name=canonical_name,
        mention_text=entity.mention_text,
        provenance_str=_prov_str(entity),
    )


def resolve_relation_for_write(
    relation: Relation,
    subject_canonical_id: str,
    object_canonical_id: str,
    case_id: str,
) -> ResolvedRelation:
    return ResolvedRelation(
        case_id=case_id,
        subject_canonical_id=subject_canonical_id,
        object_canonical_id=object_canonical_id,
        type=relation.type.value,
        qualifiers=relation.qualifiers,
        provenance_str=_prov_str(relation),
    )


def resolve_event_for_write(
    event: Event,
    event_canonical_id: str,
    participant_canonical_ids: list[str],
    case_id: str,
) -> ResolvedEvent:
    return ResolvedEvent(
        case_id=case_id,
        event_id=event_canonical_id,
        description=event.description,
        occurred_at=event.occurred_at,
        participant_canonical_ids=participant_canonical_ids,
        provenance_str=_prov_str(event),
    )


CONSTRAINTS_CYPHER = [
    "CREATE CONSTRAINT entity_canonical_id IF NOT EXISTS FOR (e:Entity) REQUIRE (e.canonical_id, e.case_id) IS UNIQUE",
    "CREATE CONSTRAINT event_id IF NOT EXISTS FOR (ev:Event) REQUIRE (ev.event_id, ev.case_id) IS UNIQUE",
    "CREATE INDEX entity_case_id IF NOT EXISTS FOR (e:Entity) ON (e.case_id)",
]


def init_graph_schema(driver: Driver) -> None:
    with driver.session() as session:
        for stmt in CONSTRAINTS_CYPHER:
            session.run(stmt)


# Idempotent upsert: append provenance to an existing array, union mention_texts.
_UPSERT_ENTITY = """
MERGE (e:Entity {canonical_id: $canonical_id, case_id: $case_id})
ON CREATE SET
    e.type = $type,
    e.canonical_name = $canonical_name,
    e.mention_texts = [$mention_text],
    e.provenance = [$provenance_str]
ON MATCH SET
    e.mention_texts = CASE WHEN $mention_text IN e.mention_texts
                           THEN e.mention_texts
                           ELSE e.mention_texts + $mention_text END,
    e.provenance = CASE WHEN $provenance_str IN e.provenance
                        THEN e.provenance
                        ELSE e.provenance + $provenance_str END
"""

_UPSERT_RELATION = """
MATCH (a:Entity {canonical_id: $subject_id, case_id: $case_id})
MATCH (b:Entity {canonical_id: $object_id, case_id: $case_id})
MERGE (a)-[r:RELATES {type: $type}]->(b)
ON CREATE SET r.qualifiers = $qualifiers, r.provenance = [$provenance_str]
ON MATCH SET r.provenance = CASE WHEN $provenance_str IN r.provenance
                                 THEN r.provenance
                                 ELSE r.provenance + $provenance_str END
"""

_UPSERT_EVENT = """
MERGE (ev:Event {event_id: $event_id, case_id: $case_id})
ON CREATE SET
    ev.description = $description,
    ev.occurred_at = $occurred_at,
    ev.provenance = [$provenance_str]
ON MATCH SET
    ev.description = $description,
    ev.occurred_at = $occurred_at,
    ev.provenance = CASE WHEN $provenance_str IN ev.provenance
                         THEN ev.provenance
                         ELSE ev.provenance + $provenance_str END
WITH ev
UNWIND $participant_ids AS pid
MATCH (p:Entity {canonical_id: pid, case_id: $case_id})
MERGE (p)-[:PARTICIPATED_IN]->(ev)
"""


def upsert_entity(driver: Driver, entity: ResolvedEntity) -> None:
    with driver.session() as session:
        session.run(
            _UPSERT_ENTITY,
            canonical_id=entity.canonical_id,
            case_id=entity.case_id,
            type=entity.type,
            canonical_name=entity.canonical_name,
            mention_text=entity.mention_text,
            provenance_str=entity.provenance_str,
        )


def upsert_relation(driver: Driver, relation: ResolvedRelation) -> None:
    with driver.session() as session:
        session.run(
            _UPSERT_RELATION,
            case_id=relation.case_id,
            subject_id=relation.subject_canonical_id,
            object_id=relation.object_canonical_id,
            type=relation.type,
            qualifiers=json.dumps(relation.qualifiers),
            provenance_str=relation.provenance_str,
        )


def upsert_event(driver: Driver, event: ResolvedEvent) -> None:
    with driver.session() as session:
        session.run(
            _UPSERT_EVENT,
            event_id=event.event_id,
            case_id=event.case_id,
            description=event.description,
            occurred_at=event.occurred_at,
            participant_ids=event.participant_canonical_ids,
            provenance_str=event.provenance_str,
        )


def wipe_case(driver: Driver, case_id: str) -> None:
    """Detach-delete every node for this case. Used by the reset-demo script."""
    with driver.session() as session:
        session.run(
            "MATCH (n) WHERE n.case_id = $cid DETACH DELETE n",
            cid=case_id,
        )
