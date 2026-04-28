"""Pure-logic tests for graph writer helpers.

Full Neo4j integration is covered under tests/integration (requires docker-compose).
"""

from __future__ import annotations

from app.graph.writer import (
    resolve_entity_for_write,
    resolve_relation_for_write,
)
from app.models.extraction import Entity, EntityType, Provenance, Relation, RelationType


def _prov(start: int = 0, end: int = 5, doc: str = "doc1", chunk: str = "doc1:0") -> Provenance:
    return Provenance(source_doc_id=doc, chunk_id=chunk, char_start=start, char_end=end)


def test_entity_prov_string_format() -> None:
    e = Entity(id="e1", type=EntityType.PERSON, mention_text="Alice", provenance=_prov(10, 15))
    resolved = resolve_entity_for_write(e, canonical_id="ent_X", canonical_name="Alice", case_id="c1")
    assert resolved.provenance_str == "doc1:doc1:0:10-15"
    assert resolved.canonical_id == "ent_X"
    assert resolved.case_id == "c1"
    assert resolved.type == "Person"


def test_relation_keeps_canonical_ids() -> None:
    r = Relation(
        id="r1",
        type=RelationType.EMPLOYS,
        subject_id="a",
        object_id="b",
        qualifiers={"amount": "50k"},
        provenance=_prov(0, 20),
    )
    resolved = resolve_relation_for_write(
        r, subject_canonical_id="ent_A", object_canonical_id="ent_B", case_id="c1"
    )
    assert resolved.subject_canonical_id == "ent_A"
    assert resolved.object_canonical_id == "ent_B"
    assert resolved.type == "employs"
    assert resolved.qualifiers == {"amount": "50k"}
