// Mirror of backend/app/models/extraction.py. Keep in sync by hand for now;
// if drift becomes a problem, swap to generation via datamodel-code-generator.

export type EntityType =
  | "Person"
  | "Organization"
  | "Date"
  | "Location"
  | "Money"
  | "Document"
  | "Event";

export type RelationType =
  | "employs"
  | "party_to"
  | "communicated_with"
  | "paid"
  | "signed"
  | "attended"
  | "alleged"
  | "sourced_from"
  | "occurred_on"
  | "located_at";

export type ClaimValueType = "text" | "date" | "money" | "entity_ref" | "number";

export interface Provenance {
  source_doc_id: string;
  chunk_id: string;
  char_start: number;
  char_end: number;
}

export interface Entity {
  id: string;
  type: EntityType;
  mention_text: string;
  canonical_name?: string | null;
  attributes?: Record<string, string>;
  provenance: Provenance;
  confidence: number;
}

export interface Relation {
  id: string;
  type: RelationType;
  subject_id: string;
  object_id: string;
  qualifiers?: Record<string, string>;
  provenance: Provenance;
  confidence: number;
}

export interface Claim {
  id: string;
  subject_entity_id: string;
  predicate: string;
  value: string;
  value_type: ClaimValueType;
  speaker_entity_id?: string | null;
  provenance: Provenance;
  confidence: number;
}

export interface Event {
  id: string;
  description: string;
  occurred_at: string;
  participant_ids: string[];
  location_entity_id?: string | null;
  provenance: Provenance;
  confidence: number;
}

export interface Contradiction {
  id: string;
  subject_entity_id: string;
  predicate: string;
  conflicting_claim_ids: string[];
  explanation: string;
  rank_score: number;
}

export interface GraphResponse {
  entities: Entity[];
  relations: Relation[];
  events: Event[];
}

export interface CaseSummary {
  id: string;
  name: string;
  document_count: number;
  entity_count: number;
  contradiction_count: number;
}

export interface DocumentSummary {
  id: string;
  case_id: string;
  filename: string;
  mime_type: string;
  char_length: number;
  created_at: string;
}

export interface DocumentDetail extends DocumentSummary {
  text: string;
}
