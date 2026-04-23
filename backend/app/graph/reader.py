"""Read helpers for the frontend graph endpoint."""

from __future__ import annotations

from app.graph.client import get_driver


def read_case_graph(case_id: str) -> dict:
    with get_driver().session() as session:
        ent_result = session.run(
            "MATCH (e:Entity {case_id: $cid}) "
            "RETURN e.canonical_id AS id, e.type AS type, e.canonical_name AS name, "
            "e.mention_texts AS mention_texts, e.provenance AS provenance",
            cid=case_id,
        )
        entities = [dict(r) for r in ent_result]

        rel_result = session.run(
            "MATCH (a:Entity {case_id: $cid})-[r:RELATES]->(b:Entity {case_id: $cid}) "
            "RETURN a.canonical_id AS subject_id, b.canonical_id AS object_id, "
            "r.type AS type, r.qualifiers AS qualifiers, r.provenance AS provenance",
            cid=case_id,
        )
        relations = [dict(r) for r in rel_result]

    return {"entities": entities, "relations": relations}


def read_case_events(case_id: str) -> list[dict]:
    with get_driver().session() as session:
        result = session.run(
            "MATCH (ev:Event {case_id: $cid}) "
            "OPTIONAL MATCH (p:Entity)-[:PARTICIPATED_IN]->(ev) "
            "RETURN ev.event_id AS id, ev.description AS description, "
            "ev.occurred_at AS occurred_at, ev.provenance AS provenance, "
            "collect(p.canonical_id) AS participant_ids "
            "ORDER BY ev.occurred_at",
            cid=case_id,
        )
        return [dict(r) for r in result]
