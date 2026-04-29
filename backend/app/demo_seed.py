"""Offline fallback population for the Enron demo corpus.

This keeps the demo workspace usable when live LLM extraction is unavailable
(for example due to local network issues or provider rate limits).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from app.contradictions.detector import detect_contradictions
from app.db import get_conn
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
from app.models.extraction import (
    Claim,
    Entity,
    EntityType,
    Event,
    Provenance,
    Relation,
    RelationType,
)


@dataclass(frozen=True)
class DemoPipelineStats:
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


@dataclass(frozen=True)
class _DocContext:
    doc_id: str
    chunk_id: str
    text: str


@dataclass(frozen=True)
class _EntitySpec:
    canonical_id: str
    canonical_name: str
    entity_type: EntityType
    filename: str
    mention_text: str


@dataclass(frozen=True)
class _RelationSpec:
    relation_type: RelationType
    subject_id: str
    object_id: str
    filename: str
    evidence: str
    qualifiers: dict[str, str] | None = None


@dataclass(frozen=True)
class _ClaimSpec:
    subject_id: str
    predicate: str
    value: str
    value_type: str
    speaker_id: str | None
    filename: str
    evidence: str


@dataclass(frozen=True)
class _EventSpec:
    event_id: str
    description: str
    occurred_at: str
    participant_ids: list[str]
    filename: str
    evidence: str


ENTITY_SPECS: tuple[_EntitySpec, ...] = (
    _EntitySpec("person_smith", "Robert K. Smith", EntityType.PERSON, "smith_deposition_excerpt.txt", "Robert K. Smith"),
    _EntitySpec("person_smith", "Robert K. Smith", EntityType.PERSON, "skilling_deposition_excerpt.txt", "Robert Smith"),
    _EntitySpec("person_smith", "Robert K. Smith", EntityType.PERSON, "fastow_deposition_excerpt.txt", "Bob Smith"),
    _EntitySpec("person_smith", "Robert K. Smith", EntityType.PERSON, "email_001.txt", "Bob"),
    _EntitySpec("person_smith", "Robert K. Smith", EntityType.PERSON, "email_002.txt", "Bob"),
    _EntitySpec("person_smith", "Robert K. Smith", EntityType.PERSON, "internal_memo_raptor2.txt", "Robert K. Smith"),
    _EntitySpec("person_skilling", "Jeffrey K. Skilling", EntityType.PERSON, "smith_deposition_excerpt.txt", "Jeffrey Skilling"),
    _EntitySpec("person_skilling", "Jeffrey K. Skilling", EntityType.PERSON, "fastow_deposition_excerpt.txt", "Jeff Skilling"),
    _EntitySpec("person_skilling", "Jeffrey K. Skilling", EntityType.PERSON, "skilling_deposition_excerpt.txt", "JEFFREY K. SKILLING"),
    _EntitySpec("person_skilling", "Jeffrey K. Skilling", EntityType.PERSON, "email_001.txt", "jeffrey.skilling@enron.com"),
    _EntitySpec("person_skilling", "Jeffrey K. Skilling", EntityType.PERSON, "email_002.txt", "jeffrey.skilling@enron.com"),
    _EntitySpec("person_skilling", "Jeffrey K. Skilling", EntityType.PERSON, "internal_memo_raptor2.txt", "Jeffrey Skilling"),
    _EntitySpec("person_fastow", "Andrew S. Fastow", EntityType.PERSON, "smith_deposition_excerpt.txt", "Andrew Fastow"),
    _EntitySpec("person_fastow", "Andrew S. Fastow", EntityType.PERSON, "fastow_deposition_excerpt.txt", "ANDREW S. FASTOW"),
    _EntitySpec("person_fastow", "Andrew S. Fastow", EntityType.PERSON, "email_001.txt", "andrew.fastow@enron.com"),
    _EntitySpec("person_fastow", "Andrew S. Fastow", EntityType.PERSON, "internal_memo_raptor2.txt", "Andrew Fastow"),
    _EntitySpec("org_raptor_ii", "Raptor II", EntityType.ORGANIZATION, "smith_deposition_excerpt.txt", "Raptor II"),
    _EntitySpec("org_raptor_ii", "Raptor II", EntityType.ORGANIZATION, "fastow_deposition_excerpt.txt", "Raptor II"),
    _EntitySpec("org_raptor_ii", "Raptor II", EntityType.ORGANIZATION, "skilling_deposition_excerpt.txt", "Raptor II"),
    _EntitySpec("org_raptor_ii", "Raptor II", EntityType.ORGANIZATION, "email_001.txt", "Raptor II"),
    _EntitySpec("org_raptor_ii", "Raptor II", EntityType.ORGANIZATION, "email_002.txt", "Raptor II Holdings"),
    _EntitySpec("org_raptor_ii", "Raptor II", EntityType.ORGANIZATION, "internal_memo_raptor2.txt", "Raptor II"),
    _EntitySpec("org_finance_committee", "Enron Finance Committee", EntityType.ORGANIZATION, "smith_deposition_excerpt.txt", "finance committee"),
    _EntitySpec("org_finance_committee", "Enron Finance Committee", EntityType.ORGANIZATION, "fastow_deposition_excerpt.txt", "finance committee"),
    _EntitySpec("org_finance_committee", "Enron Finance Committee", EntityType.ORGANIZATION, "skilling_deposition_excerpt.txt", "finance meeting"),
    _EntitySpec("org_finance_committee", "Enron Finance Committee", EntityType.ORGANIZATION, "internal_memo_raptor2.txt", "ENRON FINANCE COMMITTEE"),
    _EntitySpec("date_2001_03_09", "2001-03-09", EntityType.DATE, "smith_deposition_excerpt.txt", "March 9, 2001"),
    _EntitySpec("date_2001_03_09", "2001-03-09", EntityType.DATE, "email_001.txt", "the 9th"),
    _EntitySpec("date_2001_03_09", "2001-03-09", EntityType.DATE, "email_002.txt", "Fri, 9 Mar 2001"),
    _EntitySpec("date_2001_03_09", "2001-03-09", EntityType.DATE, "internal_memo_raptor2.txt", "March 9, 2001"),
    _EntitySpec("date_2001_03_12", "2001-03-12", EntityType.DATE, "smith_deposition_excerpt.txt", "March 12, 2001"),
    _EntitySpec("date_2001_03_12", "2001-03-12", EntityType.DATE, "skilling_deposition_excerpt.txt", "March 12, 2001"),
    _EntitySpec("date_2001_03_12", "2001-03-12", EntityType.DATE, "email_001.txt", "Mon, 12 Mar 2001"),
    _EntitySpec("date_2001_03_12", "2001-03-12", EntityType.DATE, "internal_memo_raptor2.txt", "March 12, 2001"),
    _EntitySpec("date_2001_03_15", "2001-03-15", EntityType.DATE, "fastow_deposition_excerpt.txt", "March 15, 2001"),
    _EntitySpec("money_2500000", "2500000", EntityType.MONEY, "smith_deposition_excerpt.txt", "$2.5 million"),
    _EntitySpec("money_2500000", "2500000", EntityType.MONEY, "skilling_deposition_excerpt.txt", "$2.5 million"),
    _EntitySpec("money_2500000", "2500000", EntityType.MONEY, "email_001.txt", "$2.5M"),
    _EntitySpec("money_2500000", "2500000", EntityType.MONEY, "email_002.txt", "$2.5M"),
    _EntitySpec("money_2500000", "2500000", EntityType.MONEY, "internal_memo_raptor2.txt", "$2.5 million"),
    _EntitySpec("money_5000000", "5000000", EntityType.MONEY, "fastow_deposition_excerpt.txt", "$5 million"),
    _EntitySpec("event_meeting", "Raptor II finance committee meeting", EntityType.EVENT, "smith_deposition_excerpt.txt", "finance committee meeting regarding the Raptor II vehicle"),
    _EntitySpec("event_meeting", "Raptor II finance committee meeting", EntityType.EVENT, "fastow_deposition_excerpt.txt", "Raptor II finance committee meeting"),
    _EntitySpec("event_meeting", "Raptor II finance committee meeting", EntityType.EVENT, "skilling_deposition_excerpt.txt", "Raptor II finance meeting"),
    _EntitySpec("event_transfer", "Raptor II wire transfer", EntityType.EVENT, "smith_deposition_excerpt.txt", "wire transfer"),
    _EntitySpec("event_transfer", "Raptor II wire transfer", EntityType.EVENT, "fastow_deposition_excerpt.txt", "wire transfer"),
    _EntitySpec("event_transfer", "Raptor II wire transfer", EntityType.EVENT, "skilling_deposition_excerpt.txt", "wire transfer"),
    _EntitySpec("event_transfer", "Raptor II wire transfer", EntityType.EVENT, "email_001.txt", "wire transfer"),
    _EntitySpec("event_transfer", "Raptor II wire transfer", EntityType.EVENT, "email_002.txt", "wire authorization"),
)

RELATION_SPECS: tuple[_RelationSpec, ...] = (
    _RelationSpec(RelationType.COMMUNICATED_WITH, "person_skilling", "person_smith", "email_002.txt", "Approved. Please proceed with the $2.5M transfer to Raptor II Holdings as discussed."),
    _RelationSpec(RelationType.COMMUNICATED_WITH, "person_smith", "person_skilling", "email_001.txt", "Confirming the $2.5M wire to Raptor II was sent Friday per your approval."),
    _RelationSpec(RelationType.PARTY_TO, "org_raptor_ii", "org_finance_committee", "internal_memo_raptor2.txt", "Raptor II vehicle status"),
    _RelationSpec(RelationType.SIGNED, "person_smith", "org_raptor_ii", "smith_deposition_excerpt.txt", "I signed off on it personally at Jeff's request."),
)

CLAIM_SPECS: tuple[_ClaimSpec, ...] = (
    _ClaimSpec("event_meeting", "occurred_on", "2001-03-12", "date", "person_smith", "smith_deposition_excerpt.txt", "A. To the best of my recollection, it was March 12, 2001."),
    _ClaimSpec("person_smith", "attended_meeting_on", "2001-03-12", "text", "person_smith", "smith_deposition_excerpt.txt", "A. Jeffrey Skilling attended, along with Andrew Fastow and myself."),
    _ClaimSpec("event_transfer", "received_payment_of", "2500000", "money", "person_smith", "smith_deposition_excerpt.txt", "A. Yes. A $2.5 million transfer to Raptor II."),
    _ClaimSpec("event_transfer", "authorized_by", "person_skilling", "entity_ref", "person_smith", "smith_deposition_excerpt.txt", "I signed off on it personally at Jeff's request."),
    _ClaimSpec("event_transfer", "authorized_on", "2001-03-09", "date", "person_smith", "smith_deposition_excerpt.txt", "The approval came via email on March 9, 2001."),
    _ClaimSpec("event_meeting", "occurred_on", "2001-03-15", "date", "person_fastow", "fastow_deposition_excerpt.txt", "A. March 15, 2001."),
    _ClaimSpec("person_smith", "attended_meeting_on", "absent", "text", "person_fastow", "fastow_deposition_excerpt.txt", "Bob Smith was not present — he was out of the office that week."),
    _ClaimSpec("event_transfer", "received_payment_of", "5000000", "money", "person_fastow", "fastow_deposition_excerpt.txt", "A. I recall it being approximately $5 million, not the smaller figure some documents suggest."),
    _ClaimSpec("event_transfer", "authorized_by", "person_skilling", "entity_ref", "person_fastow", "fastow_deposition_excerpt.txt", "The transfer was approved by Mr. Skilling directly, not by me."),
    _ClaimSpec("event_meeting", "occurred_on", "2001-03-12", "date", "person_skilling", "skilling_deposition_excerpt.txt", "A. I believe it was March 12, 2001. My calendar confirms that."),
    _ClaimSpec("person_smith", "attended_meeting_on", "2001-03-12", "text", "person_skilling", "skilling_deposition_excerpt.txt", "A. Robert Smith, Andrew Fastow, and myself."),
    _ClaimSpec("event_transfer", "received_payment_of", "2500000", "money", "person_skilling", "skilling_deposition_excerpt.txt", "A. Yes, I approved a $2.5 million transfer."),
    _ClaimSpec("event_transfer", "authorized_by", "person_skilling", "entity_ref", "person_skilling", "skilling_deposition_excerpt.txt", "A. Yes, I approved a $2.5 million transfer."),
    _ClaimSpec("event_transfer", "received_payment_of", "2500000", "money", "person_smith", "email_001.txt", "Confirming the $2.5M wire to Raptor II was sent Friday per your approval."),
    _ClaimSpec("event_transfer", "authorized_by", "person_skilling", "entity_ref", "person_smith", "email_001.txt", "I have the authorization you sent me on the 9th on file if needed."),
    _ClaimSpec("event_transfer", "received_payment_of", "2500000", "money", "person_skilling", "email_002.txt", "Approved. Please proceed with the $2.5M transfer to Raptor II Holdings as discussed."),
    _ClaimSpec("event_meeting", "occurred_on", "2001-03-12", "date", "person_skilling", "email_002.txt", "Let's review at the finance committee on Monday."),
    _ClaimSpec("event_transfer", "received_payment_of", "2500000", "money", "person_smith", "internal_memo_raptor2.txt", "Raptor II received a $2.5 million capital infusion on March 9, 2001"),
    _ClaimSpec("event_transfer", "authorized_by", "person_skilling", "entity_ref", "person_smith", "internal_memo_raptor2.txt", "per Mr. Skilling's written authorization to Mr. Smith dated the same day."),
    _ClaimSpec("person_smith", "attended_meeting_on", "2001-03-12", "text", "person_smith", "internal_memo_raptor2.txt", "Attendees: Jeffrey Skilling, Andrew Fastow, Robert K. Smith"),
)

EVENT_SPECS: tuple[_EventSpec, ...] = (
    _EventSpec("timeline_transfer_authorization", "Jeffrey Skilling authorized the Raptor II transfer", "2001-03-09", ["person_skilling", "person_smith"], "email_002.txt", "Approved. Please proceed with the $2.5M transfer to Raptor II Holdings as discussed."),
    _EventSpec("timeline_transfer_confirmation", "Robert Smith confirmed the Raptor II wire transfer", "2001-03-12", ["person_smith", "person_skilling"], "email_001.txt", "Confirming the $2.5M wire to Raptor II was sent Friday per your approval."),
    _EventSpec("timeline_finance_committee_meeting", "Raptor II finance committee meeting", "2001-03-12", ["person_smith", "person_skilling", "person_fastow"], "internal_memo_raptor2.txt", "Attendees: Jeffrey Skilling, Andrew Fastow, Robert K. Smith"),
    _EventSpec("timeline_fastow_account", "Andrew Fastow testified the committee meeting was on March 15, 2001", "2001-03-15", ["person_fastow", "person_skilling"], "fastow_deposition_excerpt.txt", "A. March 15, 2001."),
)


def populate_demo_case(case_id: str) -> DemoPipelineStats | None:
    docs = _load_docs(case_id)
    if not docs:
        return None

    driver = get_driver()
    init_graph_schema(driver)
    wipe_case(driver, case_id)
    _wipe_postgres_derived_state(case_id)

    entities_written = 0
    relations_written = 0
    claims_written: list[Claim] = []
    events_written = 0
    canonical_entities: set[str] = set()

    for spec in ENTITY_SPECS:
        doc = docs.get(spec.filename)
        if not doc:
            continue
        prov = _provenance(doc, spec.mention_text)
        if prov is None:
            continue
        entity = Entity(
            id=f"{spec.canonical_id}:{spec.filename}",
            type=spec.entity_type,
            mention_text=spec.mention_text,
            canonical_name=spec.canonical_name,
            provenance=prov,
            confidence=1.0,
        )
        upsert_entity(
            driver,
            resolve_entity_for_write(entity, spec.canonical_id, spec.canonical_name, case_id),
        )
        entities_written += 1
        canonical_entities.add(spec.canonical_id)

    for spec in RELATION_SPECS:
        doc = docs.get(spec.filename)
        if not doc:
            continue
        prov = _provenance(doc, spec.evidence)
        if prov is None:
            continue
        relation = Relation(
            id=f"rel:{spec.subject_id}:{spec.object_id}:{spec.filename}",
            type=spec.relation_type,
            subject_id=spec.subject_id,
            object_id=spec.object_id,
            qualifiers=spec.qualifiers or {},
            provenance=prov,
            confidence=1.0,
        )
        upsert_relation(
            driver,
            resolve_relation_for_write(
                relation, spec.subject_id, spec.object_id, case_id
            ),
        )
        relations_written += 1

    for spec in EVENT_SPECS:
        doc = docs.get(spec.filename)
        if not doc:
            continue
        prov = _provenance(doc, spec.evidence)
        if prov is None:
            continue
        event = Event(
            id=spec.event_id,
            description=spec.description,
            occurred_at=spec.occurred_at,
            participant_ids=spec.participant_ids,
            provenance=prov,
            confidence=1.0,
        )
        event_canonical_id = "evt_" + hashlib.sha1(
            f"{spec.description}|{spec.occurred_at}".encode()
        ).hexdigest()[:16]
        upsert_event(
            driver,
            resolve_event_for_write(event, event_canonical_id, spec.participant_ids, case_id),
        )
        events_written += 1

    for spec in CLAIM_SPECS:
        doc = docs.get(spec.filename)
        if not doc:
            continue
        prov = _provenance(doc, spec.evidence)
        if prov is None:
            continue
        claims_written.append(
            Claim(
                id=f"claim:{spec.subject_id}:{spec.predicate}:{spec.filename}",
                subject_entity_id=spec.subject_id,
                predicate=spec.predicate,
                value=spec.value,
                value_type=spec.value_type,
                speaker_entity_id=spec.speaker_id,
                provenance=prov,
                confidence=1.0,
            )
        )

    contradictions = detect_contradictions(claims_written)
    _persist_claims_and_contradictions(case_id, claims_written, contradictions)

    return DemoPipelineStats(
        case_id=case_id,
        documents_processed=len(docs),
        chunks_processed=len(docs),
        entities_extracted=entities_written,
        relations_extracted=relations_written,
        claims_extracted=len(claims_written),
        events_extracted=events_written,
        entity_clusters=len(canonical_entities),
        contradictions_found=len(contradictions),
    )


def _load_docs(case_id: str) -> dict[str, _DocContext]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT d.id, d.filename, d.raw_text, c.id AS chunk_id "
            "FROM documents d "
            "LEFT JOIN chunks c ON c.document_id = d.id AND c.ordinal = 0 "
            "WHERE d.case_id = %s ORDER BY d.created_at",
            (case_id,),
        )
        rows = cur.fetchall()

    docs: dict[str, _DocContext] = {}
    for row in rows:
        docs[row["filename"]] = _DocContext(
            doc_id=row["id"],
            chunk_id=row["chunk_id"] or f'{row["id"]}:0',
            text=row["raw_text"],
        )
    return docs


def _provenance(doc: _DocContext, needle: str) -> Provenance | None:
    start = doc.text.find(needle)
    if start < 0:
        return None
    return Provenance(
        source_doc_id=doc.doc_id,
        chunk_id=doc.chunk_id,
        char_start=start,
        char_end=start + len(needle),
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


def _persist_claims_and_contradictions(case_id: str, claims: list[Claim], contradictions) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        for claim in claims:
            cur.execute(
                "INSERT INTO claims (id, case_id, subject_entity_id, predicate, value, value_type, "
                "speaker_entity_id, source_doc_id, chunk_id, char_start, char_end, confidence) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (id) DO NOTHING",
                (
                    claim.id,
                    case_id,
                    claim.subject_entity_id,
                    claim.predicate,
                    claim.value,
                    claim.value_type,
                    claim.speaker_entity_id,
                    claim.provenance.source_doc_id,
                    claim.provenance.chunk_id,
                    claim.provenance.char_start,
                    claim.provenance.char_end,
                    claim.confidence,
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
                    "",
                    contra.rank_score,
                ),
            )
