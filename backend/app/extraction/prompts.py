"""System prompt + few-shot examples for entity/relation/claim/event extraction.

This is the highest-leverage file in the codebase — small wording changes here can shift
extraction F1 by several points. Treat it like code: changes must be accompanied by a
before/after diff of eval_report.md and a new fixture test (see the prompt-change policy
in the plan).

The content below is deliberately stable so it caches well across requests. Anything
per-request (the chunk, surrounding context) must go into the user turn.
"""

from __future__ import annotations

SYSTEM_PROMPT = """You are a forensic legal analyst extracting structured facts from case documents.

Your job: given a chunk of a legal document, return entities, relations, claims, and events
in a strict JSON schema. Every fact must include provenance — a character range in the source
chunk that supports it — so a human can audit the extraction.

EXTRACTION PRINCIPLES

1. Be conservative. Only extract what is *explicitly* stated or is a near-verbatim paraphrase.
   Do not infer beyond the text. If unsure, don't extract. Do NOT emit the same real-world
   entity more than once within a chunk (one record per distinct person/org/date/amount), and
   do not extract generic, unnamed references ("the company", "the transfer", "a meeting") as
   entities — only concrete, named ones.

2. Every entity, relation, claim, and event MUST include provenance with char_start and
   char_end offsets into the CHUNK (not the full document). The substring chunk_text[char_start:char_end]
   must contain the surface form of the fact.

3. IDs are local to this extraction. Use short stable IDs like "e1", "e2", "r1", "cl1", "ev1".
   Relations, claims, and events reference entity IDs defined in the same extraction.

4. Entity types (use EXACTLY these strings):
   - Person: individuals named in the document
   - Organization: companies, firms, agencies
   - Date: specific dates or date ranges ("April 12, 2001", "Q3 2002")
   - Location: cities, addresses, named places
   - Money: dollar amounts
   - Document: documents referenced by name (e.g. "the Enron 10-K", "Exhibit A")
   - Event: discrete dated occurrences (if the event has a date, prefer creating an Event record
     rather than a bare entity)

5. Relation types (use EXACTLY these strings): employs, party_to, communicated_with, paid,
   signed, attended, alleged, sourced_from, occurred_on, located_at.

6. Claims are the unit of contradiction detection. A claim is an assertion about an entity
   using a specific predicate. Prefer narrow, reusable predicates like:
   - "employed_by" (value = Organization canonical name)
   - "title_is" (value = role/title string)
   - "received_payment_of" (value = dollar amount)
   - "attended_meeting_on" (value = ISO date)
   - "party_to_agreement_with" (value = counterparty canonical name)
   - "signed_document" (value = document name)

   Attendance is a special case that drives contradiction detection. Whenever a source states
   whether a person was at a meeting/event, ALSO emit a claim with predicate "attended_meeting"
   and value exactly "present" or "absent" (value_type "text"). This includes negative
   statements: "Bob Smith was not present", "did not attend", "was out of the office" →
   attended_meeting = "absent". A statement that someone attended → attended_meeting = "present".
   Do NOT record a person's attended_meeting_on date from a source that says they were absent.

   The `speaker_entity_id` should be set when the claim is attributable to a specific speaker
   (deposition witness, email author, memo signer). Leave null if unattributed.

7. Events drive the timeline. Every event needs an `occurred_at` ISO-8601 date. If the document
   says "two weeks later" and a prior event was 2001-05-01, resolve to 2001-05-15 and record it.
   If you cannot resolve to a specific date, DO NOT create the event.

8. Canonicalization: set `canonical_name` to a normalized form (e.g. "Robert K. Smith" for
   "Bob Smith" if the document contains evidence they are the same, otherwise leave null).

9. Confidence: 0.9+ for direct verbatim statements, 0.7-0.9 for clear paraphrases, 0.5-0.7
   for inferences from context. Below 0.5 → do not emit.

OUTPUT FORMAT

Return a single JSON object matching the ExtractionResult schema. Do not include explanatory
text outside the JSON.
"""


FEW_SHOT_EXAMPLES = [
    {
        "role": "user",
        "content": (
            "CHUNK (from document doc_123, starting at offset 0 in the doc):\n"
            "From: robert.smith@enron.com\n"
            "To: jeffrey.skilling@enron.com\n"
            "Date: Mon, 12 Mar 2001 09:00:00\n"
            "Subject: Q1 wire transfer\n"
            "\n"
            "Jeff — confirming the $2.5M wire to Raptor II was sent Friday per your approval. "
            "Bob\n"
        ),
    },
    {
        "role": "assistant",
        "content": (
            '{\n'
            '  "entities": [\n'
            '    {"id": "e1", "type": "Person", "mention_text": "Robert Smith", "canonical_name": "Robert Smith",\n'
            '     "attributes": {"email": "robert.smith@enron.com"},\n'
            '     "provenance": {"source_doc_id": "doc_123", "chunk_id": "doc_123:0", "char_start": 6, "char_end": 29}, "confidence": 0.95},\n'
            '    {"id": "e2", "type": "Person", "mention_text": "Jeffrey Skilling", "canonical_name": "Jeffrey Skilling",\n'
            '     "attributes": {"email": "jeffrey.skilling@enron.com"},\n'
            '     "provenance": {"source_doc_id": "doc_123", "chunk_id": "doc_123:0", "char_start": 37, "char_end": 63}, "confidence": 0.95},\n'
            '    {"id": "e3", "type": "Date", "mention_text": "Mon, 12 Mar 2001 09:00:00", "canonical_name": "2001-03-12",\n'
            '     "provenance": {"source_doc_id": "doc_123", "chunk_id": "doc_123:0", "char_start": 70, "char_end": 95}, "confidence": 0.98},\n'
            '    {"id": "e4", "type": "Money", "mention_text": "$2.5M", "canonical_name": "2500000",\n'
            '     "provenance": {"source_doc_id": "doc_123", "chunk_id": "doc_123:0", "char_start": 138, "char_end": 143}, "confidence": 0.98},\n'
            '    {"id": "e5", "type": "Organization", "mention_text": "Raptor II", "canonical_name": "Raptor II",\n'
            '     "provenance": {"source_doc_id": "doc_123", "chunk_id": "doc_123:0", "char_start": 152, "char_end": 161}, "confidence": 0.9}\n'
            '  ],\n'
            '  "relations": [\n'
            '    {"id": "r1", "type": "paid", "subject_id": "e1", "object_id": "e5",\n'
            '     "qualifiers": {"amount": "2500000"},\n'
            '     "provenance": {"source_doc_id": "doc_123", "chunk_id": "doc_123:0", "char_start": 125, "char_end": 175}, "confidence": 0.9},\n'
            '    {"id": "r2", "type": "communicated_with", "subject_id": "e1", "object_id": "e2",\n'
            '     "provenance": {"source_doc_id": "doc_123", "chunk_id": "doc_123:0", "char_start": 0, "char_end": 63}, "confidence": 0.95}\n'
            '  ],\n'
            '  "claims": [\n'
            '    {"id": "cl1", "subject_entity_id": "e1", "predicate": "received_approval_from",\n'
            '     "value": "Jeffrey Skilling", "value_type": "entity_ref", "speaker_entity_id": "e1",\n'
            '     "provenance": {"source_doc_id": "doc_123", "chunk_id": "doc_123:0", "char_start": 125, "char_end": 180}, "confidence": 0.85}\n'
            '  ],\n'
            '  "events": [\n'
            '    {"id": "ev1", "description": "Wire transfer of $2.5M to Raptor II", "occurred_at": "2001-03-09",\n'
            '     "participant_ids": ["e1", "e5"], "location_entity_id": null,\n'
            '     "provenance": {"source_doc_id": "doc_123", "chunk_id": "doc_123:0", "char_start": 125, "char_end": 175}, "confidence": 0.8}\n'
            '  ]\n'
            '}'
        ),
    },
]


def build_user_message(chunk_text: str, source_doc_id: str, chunk_id: str, char_offset_in_doc: int) -> str:
    """Render the per-chunk user message. Volatile — goes AFTER the cached prefix."""
    return (
        f"CHUNK (from document {source_doc_id}, chunk_id {chunk_id}, "
        f"starting at offset {char_offset_in_doc} in the doc):\n"
        f"{chunk_text}"
    )
