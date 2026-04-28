"""Tests for the pipeline's local-ID namespacing logic — the piece that prevents two chunks'
"e1" from colliding during cross-chunk resolution.

Full pipeline integration (extraction → resolution → Neo4j) lives under tests/integration.
"""

from __future__ import annotations

from app.models.extraction import (
    Entity,
    EntityType,
    ExtractionResult,
    Provenance,
    Relation,
    RelationType,
)
from app.resolution.resolver import build_local_to_canonical, resolve_entities


def _prov(doc: str, chunk: str) -> Provenance:
    return Provenance(source_doc_id=doc, chunk_id=chunk, char_start=0, char_end=5)


def test_same_local_id_across_chunks_gets_namespaced_then_resolved() -> None:
    """Simulates what the pipeline does: namespace local IDs by chunk, then resolve.

    Two chunks both emit an "e1" for "Alice Smith". After namespacing + resolution the two
    should collapse into one canonical cluster.
    """
    chunk1_result = ExtractionResult(
        entities=[
            Entity(
                id="e1",
                type=EntityType.PERSON,
                mention_text="Alice Smith",
                provenance=_prov("doc1", "doc1:0"),
            )
        ]
    )
    chunk2_result = ExtractionResult(
        entities=[
            Entity(
                id="e1",
                type=EntityType.PERSON,
                mention_text="Alice Smith",
                provenance=_prov("doc2", "doc2:0"),
            )
        ]
    )

    namespaced = []
    for chunk_id, res in [("doc1:0", chunk1_result), ("doc2:0", chunk2_result)]:
        for e in res.entities:
            namespaced.append(e.model_copy(update={"id": f"{chunk_id}::{e.id}"}))

    clusters = resolve_entities(namespaced)
    mapping = build_local_to_canonical(clusters)

    # The two namespaced IDs should map to the same canonical cluster.
    assert mapping["doc1:0::e1"] == mapping["doc2:0::e1"]
    assert len(clusters) == 1


def test_relation_ids_still_resolve_after_namespacing() -> None:
    """Namespacing the subject_id / object_id of a relation must keep the relation valid."""
    result = ExtractionResult(
        entities=[
            Entity(id="e1", type=EntityType.PERSON, mention_text="Alice", provenance=_prov("d", "d:0")),
            Entity(id="e2", type=EntityType.ORGANIZATION, mention_text="Acme", provenance=_prov("d", "d:0")),
        ],
        relations=[
            Relation(
                id="r1",
                type=RelationType.EMPLOYS,
                subject_id="e2",
                object_id="e1",
                provenance=_prov("d", "d:0"),
            )
        ],
    )
    ns = "d:0"
    rewritten = [e.model_copy(update={"id": f"{ns}::{e.id}"}) for e in result.entities]
    rel = result.relations[0].model_copy(
        update={
            "subject_id": f"{ns}::{result.relations[0].subject_id}",
            "object_id": f"{ns}::{result.relations[0].object_id}",
        }
    )
    clusters = resolve_entities(rewritten)
    mapping = build_local_to_canonical(clusters)

    assert rel.subject_id in mapping
    assert rel.object_id in mapping
    # Different entity types → different canonical clusters.
    assert mapping[rel.subject_id] != mapping[rel.object_id]
