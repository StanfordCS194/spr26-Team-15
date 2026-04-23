"""Single source of truth for what the LLM returns and what lives in the graph.

Every extracted fact carries Provenance back to a specific char range in a source document,
so the UI can always highlight the text that supported an extraction.
"""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

logger = logging.getLogger(__name__)

# Aliases for values LLMs commonly produce that don't match the schema exactly.
_RELATION_TYPE_ALIASES: dict[str, str] = {
    "approved": "signed",
    "authorized": "signed",
    "wrote": "signed",
    "sent": "communicated_with",
    "emailed": "communicated_with",
    "contacted": "communicated_with",
    "messaged": "communicated_with",
    "owns": "party_to",
    "partner_of": "party_to",
    "works_for": "employs",
    "employed_by": "employs",
    "hired": "employs",
    "claimed": "alleged",
    "asserted": "alleged",
    "stated": "alleged",
    "reported": "alleged",
    "from": "sourced_from",
    "paid_to": "paid",
    "participated_in": "attended",
    "joined": "attended",
    "happened_on": "occurred_on",
    "took_place_on": "occurred_on",
    "located_in": "located_at",
    "based_in": "located_at",
}

_VALUE_TYPE_ALIASES: dict[str, str] = {
    "string": "text",
    "str": "text",
    "boolean": "text",
    "bool": "text",
    "integer": "number",
    "int": "number",
    "float": "number",
    "decimal": "money",
    "currency": "money",
    "dollar": "money",
    "amount": "money",
    "reference": "entity_ref",
    "ref": "entity_ref",
    "entity": "entity_ref",
    "timestamp": "date",
    "datetime": "date",
}


class EntityType(StrEnum):
    PERSON = "Person"
    ORGANIZATION = "Organization"
    DATE = "Date"
    LOCATION = "Location"
    MONEY = "Money"
    DOCUMENT = "Document"
    EVENT = "Event"


class RelationType(StrEnum):
    EMPLOYS = "employs"
    PARTY_TO = "party_to"
    COMMUNICATED_WITH = "communicated_with"
    PAID = "paid"
    SIGNED = "signed"
    ATTENDED = "attended"
    ALLEGED = "alleged"
    SOURCED_FROM = "sourced_from"
    OCCURRED_ON = "occurred_on"
    LOCATED_AT = "located_at"


class Provenance(BaseModel):
    """Pointer from any extracted fact back to its supporting text span."""

    model_config = ConfigDict(frozen=True)

    source_doc_id: str
    chunk_id: str
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)

    @field_validator("char_end")
    @classmethod
    def _end_after_start(cls, v: int, info) -> int:
        start = info.data.get("char_start")
        if start is not None and v < start:
            raise ValueError("char_end must be >= char_start")
        return v


class Entity(BaseModel):
    """A person, org, date, etc. `mention_text` is verbatim from the source."""

    model_config = ConfigDict(extra="ignore")

    id: str  # local-to-extraction ID assigned by the LLM; canonicalized during resolution
    type: EntityType
    mention_text: str  # exact surface form as it appears in the doc
    canonical_name: str | None = None  # LLM's best guess at a normalized form
    attributes: dict[str, str] = Field(default_factory=dict)  # e.g. {"role": "CEO"}
    provenance: Provenance
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)


class Relation(BaseModel):
    """Edge between two entities, with provenance to the span that expresses the relation."""

    model_config = ConfigDict(extra="ignore")

    id: str
    type: RelationType
    subject_id: str  # refers to Entity.id
    object_id: str
    qualifiers: dict[str, str] = Field(default_factory=dict)  # e.g. {"amount": "$50k"}
    provenance: Provenance
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)

    @field_validator("type", mode="before")
    @classmethod
    def _coerce_relation_type(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        normalized = v.lower().strip()
        valid = {rt.value for rt in RelationType}
        if normalized in valid:
            return normalized
        if normalized in _RELATION_TYPE_ALIASES:
            mapped = _RELATION_TYPE_ALIASES[normalized]
            logger.debug("coerced relation type %r → %r", v, mapped)
            return mapped
        logger.warning("unknown relation type %r, falling back to 'alleged'", v)
        return "alleged"


class Claim(BaseModel):
    """An assertion made in a source document about an entity.

    Claims are the unit of contradiction detection: two claims with the same
    (subject_entity_id, predicate) but different values conflict.
    """

    model_config = ConfigDict(extra="ignore")

    id: str
    subject_entity_id: str
    predicate: str  # free-form but normalized, e.g. "employed_by", "attended_on"
    value: str  # stringified value; comparisons happen on this
    value_type: Literal["text", "date", "money", "entity_ref", "number"] = "text"
    speaker_entity_id: str | None = None  # who made the claim (deposition witness, email author)
    provenance: Provenance
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)

    @field_validator("value_type", mode="before")
    @classmethod
    def _coerce_value_type(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        normalized = v.lower().strip()
        valid = {"text", "date", "money", "entity_ref", "number"}
        if normalized in valid:
            return normalized
        if normalized in _VALUE_TYPE_ALIASES:
            mapped = _VALUE_TYPE_ALIASES[normalized]
            logger.debug("coerced value_type %r → %r", v, mapped)
            return mapped
        logger.warning("unknown value_type %r, falling back to 'text'", v)
        return "text"


class Event(BaseModel):
    """A dated event extracted from a document. Drives the timeline view."""

    model_config = ConfigDict(extra="ignore")

    id: str
    description: str
    occurred_at: str  # ISO-8601 date or date range
    participant_ids: list[str] = Field(default_factory=list)
    location_entity_id: str | None = None
    provenance: Provenance
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)


class ExtractionResult(BaseModel):
    """Top-level schema the LLM is asked to produce per chunk."""

    model_config = ConfigDict(extra="ignore")

    entities: list[Entity] = Field(default_factory=list)
    relations: list[Relation] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)

    def validate_references(self) -> list[str]:
        """Return a list of dangling-reference errors (relations/claims pointing to missing entity IDs)."""
        known = {e.id for e in self.entities}
        errors: list[str] = []
        for r in self.relations:
            if r.subject_id not in known:
                errors.append(f"relation {r.id} subject {r.subject_id} not in entities")
            if r.object_id not in known:
                errors.append(f"relation {r.id} object {r.object_id} not in entities")
        for c in self.claims:
            if c.subject_entity_id not in known:
                errors.append(f"claim {c.id} subject {c.subject_entity_id} not in entities")
            if c.speaker_entity_id is not None and c.speaker_entity_id not in known:
                errors.append(f"claim {c.id} speaker {c.speaker_entity_id} not in entities")
        for ev in self.events:
            for p in ev.participant_ids:
                if p not in known:
                    errors.append(f"event {ev.id} participant {p} not in entities")
        return errors


class Contradiction(BaseModel):
    """A detected conflict among claims. Created in the contradictions stage, not by the LLM directly."""

    model_config = ConfigDict(extra="forbid")

    id: str
    subject_entity_id: str
    predicate: str
    conflicting_claim_ids: list[str]
    explanation: str  # LLM-generated
    rank_score: float  # higher = more important


def extraction_json_schema() -> dict:
    """JSON schema for ExtractionResult — fed to Claude for structured output."""
    return ExtractionResult.model_json_schema()
