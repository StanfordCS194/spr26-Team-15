"""Entity resolution: collapse duplicate mentions of the same real-world entity.

Three-stage cascade, cheapest to most expensive:
  1. Deterministic normalization (strip titles, punctuation, case)
  2. Fuzzy string matching (rapidfuzz) with per-type thresholds
  3. LLM adjudication on borderline pairs only (currently a hook; disabled in unit tests)

Canonical entity ID is a content-hash of the normalized key — stable across runs, so
re-ingesting the same documents produces the same graph.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from dataclasses import dataclass

from rapidfuzz import fuzz

from app.models.extraction import Entity, EntityType

# Fuzzy threshold is per-type. People and orgs are forgiving; dates/money must match exactly.
DEFAULT_THRESHOLDS = {
    EntityType.PERSON: 88.0,
    EntityType.ORGANIZATION: 90.0,
    EntityType.LOCATION: 92.0,
    EntityType.DOCUMENT: 95.0,
    EntityType.EVENT: 95.0,
}

_PERSON_TITLES = re.compile(
    r"^(mr|mrs|ms|miss|dr|prof|sir|madam|hon|rev|jr|sr|ii|iii|iv)\.?\s+",
    flags=re.IGNORECASE,
)
_PERSON_SUFFIX = re.compile(
    r"\s+(jr|sr|ii|iii|iv|esq|phd|md|mba)\.?$",
    flags=re.IGNORECASE,
)
_NON_WORD = re.compile(r"[^\w\s]")


@dataclass(frozen=True)
class ResolvedCluster:
    canonical_id: str  # stable content hash
    canonical_name: str
    type: EntityType
    member_ids: tuple[str, ...]  # the Entity.id values (local) that collapsed into this cluster
    representative_entity: Entity


def normalize_name(name: str, entity_type: EntityType) -> str:
    """Deterministic key for fuzzy matching. Lower-case, strip titles/punctuation."""
    s = name.strip().lower()
    if entity_type == EntityType.PERSON:
        s = _PERSON_TITLES.sub("", s)
        s = _PERSON_SUFFIX.sub("", s)
    if entity_type == EntityType.MONEY:
        # Normalize $1,234.56 / USD 1234.56 / $1.2M → compare as a digits-only key.
        digits = re.sub(r"[^\d.]", "", s)
        return digits
    s = _NON_WORD.sub(" ", s)
    s = " ".join(s.split())
    return s


def _canonical_id(entity_type: EntityType, normalized: str) -> str:
    h = hashlib.sha1(f"{entity_type.value}|{normalized}".encode()).hexdigest()[:16]
    return f"ent_{h}"


def _find(parent: list[int], x: int) -> int:
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _union(parent: list[int], a: int, b: int) -> None:
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[ra] = rb


def _pick_canonical_name(members: list[Entity]) -> str:
    """Prefer the longest mention (usually the fullest form); fall back to any canonical_name."""
    for m in members:
        if m.canonical_name:
            return m.canonical_name
    return max(members, key=lambda e: len(e.mention_text)).mention_text


def resolve_entities(
    entities: Iterable[Entity],
    thresholds: dict[EntityType, float] | None = None,
) -> list[ResolvedCluster]:
    """Collapse duplicate Entity objects into canonical clusters.

    Args:
        entities: stream of extracted entities (may span many chunks/docs).
        thresholds: optional per-type fuzzy-match cutoffs (0-100). Defaults are tuned for
            legal-document names.

    Returns a list of ResolvedCluster with stable canonical_ids.
    """
    thr = thresholds or DEFAULT_THRESHOLDS

    # Group by type first — cross-type merging is never correct.
    by_type: dict[EntityType, list[Entity]] = {}
    for e in entities:
        by_type.setdefault(e.type, []).append(e)

    clusters: list[ResolvedCluster] = []

    for etype, members in by_type.items():
        # Map normalized key → list of entities that share it.
        # We do single-linkage clustering on the fuzzy-match graph within this type.
        norm_keys: list[str] = [normalize_name(e.mention_text, etype) for e in members]

        parent = list(range(len(members)))

        cutoff = thr.get(etype, 95.0)
        exact_bucket: dict[str, int] = {}
        for i, key in enumerate(norm_keys):
            if not key:
                continue
            if key in exact_bucket:
                _union(parent, i, exact_bucket[key])
            else:
                exact_bucket[key] = i

        # Fuzzy pass only for PERSON/ORG/LOCATION (O(n^2) — fine at prototype scale).
        fuzzy_types = {EntityType.PERSON, EntityType.ORGANIZATION, EntityType.LOCATION}
        if etype in fuzzy_types:
            for i in range(len(members)):
                if not norm_keys[i]:
                    continue
                for j in range(i + 1, len(members)):
                    if not norm_keys[j] or _find(parent, i) == _find(parent, j):
                        continue
                    score = fuzz.token_set_ratio(norm_keys[i], norm_keys[j])
                    if score >= cutoff:
                        _union(parent, i, j)

        # Collect clusters
        groups: dict[int, list[int]] = {}
        for i in range(len(members)):
            groups.setdefault(_find(parent, i), []).append(i)

        for _, idxs in groups.items():
            group_members = [members[i] for i in idxs]
            canonical_name = _pick_canonical_name(group_members)
            # Use the fullest-mention entity's normalized form as the canonical key.
            rep = max(group_members, key=lambda e: len(e.mention_text))
            normalized = normalize_name(canonical_name, etype) or normalize_name(
                rep.mention_text, etype
            )
            cid = _canonical_id(etype, normalized)
            clusters.append(
                ResolvedCluster(
                    canonical_id=cid,
                    canonical_name=canonical_name,
                    type=etype,
                    member_ids=tuple(sorted(e.id for e in group_members)),
                    representative_entity=rep,
                )
            )

    return clusters


def build_local_to_canonical(clusters: list[ResolvedCluster]) -> dict[str, str]:
    """Map every local Entity.id to its canonical_id. Downstream code replaces local IDs with
    canonical IDs before writing to the graph."""
    out: dict[str, str] = {}
    for cluster in clusters:
        for local_id in cluster.member_ids:
            out[local_id] = cluster.canonical_id
    return out
