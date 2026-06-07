/** Thin fetcher around the FastAPI backend. */

import type { CaseSummary, DocumentDetail, DocumentSummary, GraphResponse } from "./types";

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${path} ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function listCases(): Promise<CaseSummary[]> {
  return fetchJson<CaseSummary[]>("/cases");
}

export async function createCase(
  caseId: string,
  name = `Case ${caseId}`,
): Promise<CaseSummary> {
  return fetchJson<CaseSummary>("/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: caseId, name }),
  });
}

export async function getCase(caseId: string): Promise<CaseSummary> {
  return fetchJson<CaseSummary>(`/cases/${encodeURIComponent(caseId)}`);
}

export interface CaseDashboard {
  summary: CaseSummary;
  event_count: number;
  date_range: {
    start: string | null;
    end: string | null;
  };
  entity_breakdown: Array<{
    type: string;
    count: number;
  }>;
  recent_documents: Array<{
    id: string;
    filename: string;
    mime_type: string;
    char_length: number;
    created_at: string;
  }>;
  timeline_highlights: Array<{
    id: string;
    description: string;
    occurred_at: string;
    participant_count: number;
    participants: string[];
  }>;
  top_contradictions: Array<{
    id: string;
    subject_entity_id: string;
    subject_entity_name: string | null;
    predicate: string;
    explanation: string;
    rank_score: number;
    claim_count: number;
  }>;
}

export async function getCaseDashboard(caseId: string): Promise<CaseDashboard> {
  return fetchJson<CaseDashboard>(`/cases/${encodeURIComponent(caseId)}/dashboard`);
}

export async function getGraph(caseId: string): Promise<GraphResponse> {
  return fetchJson<GraphResponse>(`/cases/${encodeURIComponent(caseId)}/graph`);
}

export interface TimelineEventRecord {
  id: string;
  description: string;
  occurred_at: string;
  participant_ids: string[];
  participants: Array<{ id: string; name: string }>;
  provenance: string[];
}

export async function getEvents(caseId: string): Promise<TimelineEventRecord[]> {
  return fetchJson<TimelineEventRecord[]>(`/cases/${encodeURIComponent(caseId)}/events`);
}

export async function listDocuments(caseId: string): Promise<DocumentSummary[]> {
  return fetchJson<DocumentSummary[]>(`/cases/${encodeURIComponent(caseId)}/documents`);
}

export async function getDocument(caseId: string, docId: string): Promise<DocumentDetail> {
  return fetchJson<DocumentDetail>(
    `/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(docId)}`,
  );
}

export interface ContradictionDetail {
  id: string;
  subject_entity_id: string;
  subject_entity_name: string | null;
  predicate: string;
  explanation: string;
  rank_score: number;
  claims: Array<{
    claim_id: string;
    value: string;
    speaker_entity_id: string | null;
    speaker_entity_name: string | null;
    source_doc_id: string;
    chunk_id: string;
    char_start: number;
    char_end: number;
    excerpt: string;
  }>;
}

export async function listContradictions(caseId: string): Promise<ContradictionDetail[]> {
  return fetchJson<ContradictionDetail[]>(
    `/cases/${encodeURIComponent(caseId)}/contradictions`,
  );
}

export async function uploadDocument(
  caseId: string,
  file: File,
): Promise<{
  document: DocumentSummary;
  pipeline: {
    documents_processed: number;
    chunks_processed: number;
    chunks_failed: number;
    entities_extracted: number;
    relations_extracted: number;
    claims_extracted: number;
    events_extracted: number;
    entity_clusters: number;
    contradictions_found: number;
  };
  message: string;
}> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(
    `${BASE}/cases/${encodeURIComponent(caseId)}/documents`,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`upload failed ${res.status}: ${body}`);
  }
  return res.json();
}

/** Parse a provenance string of the form "doc_id:chunk_id:start-end" into its parts. */
export function parseProvenance(p: string):
  | { docId: string; chunkId: string; start: number; end: number }
  | null {
  // doc_id may contain colons (it's a UUID, but future-proof). Split from the right.
  const dashIdx = p.lastIndexOf("-");
  if (dashIdx < 0) return null;
  const lastColon = p.lastIndexOf(":", dashIdx);
  if (lastColon < 0) return null;
  const start = Number(p.slice(lastColon + 1, dashIdx));
  const end = Number(p.slice(dashIdx + 1));
  const head = p.slice(0, lastColon); // "doc_id:chunk_id"
  const split = head.indexOf(":");
  if (split < 0) return null;
  return {
    docId: head.slice(0, split),
    chunkId: head.slice(split + 1),
    start,
    end,
  };
}
