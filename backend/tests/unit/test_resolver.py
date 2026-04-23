from __future__ import annotations

from app.models.extraction import Entity, EntityType, Provenance
from app.resolution.resolver import (
    build_local_to_canonical,
    normalize_name,
    resolve_entities,
)


def _prov() -> Provenance:
    return Provenance(source_doc_id="d", chunk_id="d:0", char_start=0, char_end=1)


def _p(id_: str, type_: EntityType, text: str, canonical: str | None = None) -> Entity:
    return Entity(
        id=id_, type=type_, mention_text=text, canonical_name=canonical, provenance=_prov()
    )


def test_normalize_strips_titles_and_punctuation() -> None:
    assert normalize_name("Mr. Bob Smith Jr.", EntityType.PERSON) == "bob smith"
    assert normalize_name("Dr. Jane Doe, PhD", EntityType.PERSON) == "jane doe"


def test_normalize_money_digits_only() -> None:
    assert normalize_name("$1,234.56", EntityType.MONEY) == "1234.56"
    assert normalize_name("USD 1,234.56", EntityType.MONEY) == "1234.56"


def test_exact_duplicates_merge() -> None:
    ents = [
        _p("a", EntityType.PERSON, "Alice Smith"),
        _p("b", EntityType.PERSON, "alice smith"),
        _p("c", EntityType.PERSON, "Alice Smith"),
    ]
    clusters = resolve_entities(ents)
    assert len(clusters) == 1
    assert set(clusters[0].member_ids) == {"a", "b", "c"}


def test_fuzzy_name_variants_merge() -> None:
    ents = [
        _p("a", EntityType.PERSON, "Robert K. Smith"),
        _p("b", EntityType.PERSON, "Bob Smith"),  # nickname — should NOT merge on lexical
        _p("c", EntityType.PERSON, "Robert Smith"),
        _p("d", EntityType.PERSON, "Robert K Smith"),  # minor punctuation diff
    ]
    clusters = resolve_entities(ents)
    # a/c/d should merge (same real entity); b stays separate until LLM adjudication
    cluster_members = {c.canonical_id: set(c.member_ids) for c in clusters}
    # find the big cluster
    big = max(cluster_members.values(), key=len)
    assert {"a", "c", "d"}.issubset(big)
    assert "b" not in big


def test_different_types_never_merge() -> None:
    ents = [
        _p("a", EntityType.PERSON, "Acme"),
        _p("b", EntityType.ORGANIZATION, "Acme"),
    ]
    clusters = resolve_entities(ents)
    assert len(clusters) == 2
    assert {c.type for c in clusters} == {EntityType.PERSON, EntityType.ORGANIZATION}


def test_canonical_id_is_stable() -> None:
    c1 = resolve_entities([_p("a", EntityType.PERSON, "Alice Smith")])[0].canonical_id
    c2 = resolve_entities([_p("xyz", EntityType.PERSON, "alice smith")])[0].canonical_id
    assert c1 == c2


def test_build_local_to_canonical_maps_all_locals() -> None:
    ents = [
        _p("a", EntityType.PERSON, "Alice Smith"),
        _p("b", EntityType.PERSON, "alice smith"),
        _p("c", EntityType.ORGANIZATION, "Acme"),
    ]
    clusters = resolve_entities(ents)
    mapping = build_local_to_canonical(clusters)
    assert mapping["a"] == mapping["b"]
    assert mapping["a"] != mapping["c"]
    assert set(mapping.keys()) == {"a", "b", "c"}


def test_organization_fuzzy_merge() -> None:
    ents = [
        _p("a", EntityType.ORGANIZATION, "Enron Corporation"),
        _p("b", EntityType.ORGANIZATION, "Enron Corp."),
        _p("c", EntityType.ORGANIZATION, "Enron"),
    ]
    clusters = resolve_entities(ents)
    # At least Enron Corporation / Enron Corp. should merge (very close tokens).
    assert any(len(c.member_ids) >= 2 for c in clusters)


def test_empty_input() -> None:
    assert resolve_entities([]) == []


def test_precision_does_not_merge_distinct_people() -> None:
    """Explicit distinct people must NEVER collapse — merge-precision is load-bearing."""
    ents = [
        _p("a", EntityType.PERSON, "Alice Smith"),
        _p("b", EntityType.PERSON, "Bob Jones"),
        _p("c", EntityType.PERSON, "Carol Lee"),
    ]
    clusters = resolve_entities(ents)
    assert len(clusters) == 3
