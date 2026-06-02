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


def _match_key(entity: Entity, entity_type: EntityType) -> str:
    """The string used for fuzzy matching during resolution.

    Prefer the model's `canonical_name` over the raw surface form: the LLM resolves aliases
    we can't reach by string similarity alone (e.g. "Bob" / "Bob Smith" → "Robert Smith").
    Falls back to the verbatim mention when the model gave no canonical_name.
    """
    base = entity.canonical_name or entity.mention_text
    return normalize_name(base, entity_type)


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
        norm_keys: list[str] = [_match_key(e, etype) for e in members]

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


# --- Event resolution -------------------------------------------------------------------
# The same real-world event (e.g. "the Raptor II finance committee meeting") is described
# differently across documents and — critically — sometimes dated differently. We cluster
# events by description similarity while IGNORING the date, so a meeting dated March 12 in
# three documents and March 15 in a fourth resolves to ONE event whose date is in dispute.

# Single-linkage cutoff for event descriptions. Tuned to sit above the similarity of
# boilerplate-heavy-but-distinct events (e.g. two depositions that share "Deposition of … taken
# in case CV-…" but name different people) and below the similarity of genuine re-tellings of
# the same event. The same-meeting cluster is held together by several strong links (0.86–1.0),
# so it stays intact even if a terse paraphrase drops out.
EVENT_DESC_THRESHOLD = 82.0

_ALPHA_TOKENS = re.compile(r"[a-z]+")


@dataclass(frozen=True)
class ResolvedEventCluster:
    canonical_id: str
    canonical_description: str  # the fullest member description, shown to users
    member_ids: tuple[str, ...]


def normalize_event_description(description: str) -> str:
    """Alphabetic-token key for fuzzy event matching.

    Drops digits and punctuation so dates/amounts ("March 15", "$2.5M") don't drive matching —
    we want events grouped by *what happened*, not *when* (the date is exactly what may conflict).
    """
    return " ".join(_ALPHA_TOKENS.findall(description.lower()))


def _event_cluster_id(normalized_key: str) -> str:
    h = hashlib.sha1(f"event|{normalized_key}".encode()).hexdigest()[:16]
    return f"evt_{h}"


def resolve_events(
    events: Iterable[tuple[str, str]],
    threshold: float = EVENT_DESC_THRESHOLD,
) -> list[ResolvedEventCluster]:
    """Cluster events by description similarity, ignoring dates.

    Args:
        events: iterable of (local_event_id, description) pairs.
        threshold: single-linkage token_set_ratio cutoff (0-100).

    Returns one ResolvedEventCluster per distinct underlying event, each with a stable
    canonical_id derived from the fullest member description.
    """
    items = list(events)
    if not items:
        return []

    norm = [normalize_event_description(desc) for _eid, desc in items]
    parent = list(range(len(items)))

    for i in range(len(items)):
        if not norm[i]:
            continue
        for j in range(i + 1, len(items)):
            if not norm[j] or _find(parent, i) == _find(parent, j):
                continue
            if fuzz.token_set_ratio(norm[i], norm[j]) >= threshold:
                _union(parent, i, j)

    groups: dict[int, list[int]] = {}
    for i in range(len(items)):
        groups.setdefault(_find(parent, i), []).append(i)

    clusters: list[ResolvedEventCluster] = []
    for idxs in groups.values():
        # Representative = longest description (usually the most complete phrasing).
        rep_idx = max(idxs, key=lambda i: len(items[i][1]))
        rep_desc = items[rep_idx][1]
        cid = _event_cluster_id(norm[rep_idx] or items[rep_idx][0])
        clusters.append(
            ResolvedEventCluster(
                canonical_id=cid,
                canonical_description=rep_desc,
                member_ids=tuple(items[i][0] for i in idxs),
            )
        )
    return clusters
