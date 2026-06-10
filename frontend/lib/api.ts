/** Thin fetcher around the FastAPI backend. */

import type { CaseSummary, DocumentDetail, DocumentSummary, GraphResponse } from "./types";

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";
const LOCAL_ANNOTATIONS_KEY_PREFIX = "case-intel-demo-annotations:";

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
  try {
    return await fetchJson<CaseDashboard>(`/cases/${encodeURIComponent(caseId)}/dashboard`);
  } catch (error) {
    if (!isMissingEndpointError(error)) throw error;
    return buildCaseDashboardFallback(caseId);
  }
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
    source_doc_filename: string;
    chunk_id: string;
    char_start: number;
    char_end: number;
    excerpt: string;
  }>;
}

export async function listContradictions(caseId: string): Promise<ContradictionDetail[]> {
  const rows = await fetchJson<ContradictionDetail[]>(
    `/cases/${encodeURIComponent(caseId)}/contradictions`,
  );
  return normalizeContradictions(caseId, rows);
}

export type AnnotationTargetType = "case" | "document" | "contradiction" | "event";

export interface AnnotationRecord {
  id: string;
  case_id: string;
  target_type: AnnotationTargetType;
  target_id: string;
  target_label: string;
  tag: string;
  title: string;
  body: string;
  author: string;
  created_at: string;
}

export interface CreateAnnotationInput {
  target_type: AnnotationTargetType;
  target_id: string;
  target_label: string;
  tag?: string;
  title?: string;
  body: string;
  author: string;
}

export async function listAnnotations(
  caseId: string,
  filters?: {
    targetType?: AnnotationTargetType;
    targetId?: string;
  },
): Promise<AnnotationRecord[]> {
  const params = new URLSearchParams();
  if (filters?.targetType) params.set("target_type", filters.targetType);
  if (filters?.targetId) params.set("target_id", filters.targetId);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  try {
    return await fetchJson<AnnotationRecord[]>(
      `/cases/${encodeURIComponent(caseId)}/annotations${query}`,
    );
  } catch (error) {
    if (!isMissingEndpointError(error)) throw error;
    return filterLocalAnnotations(loadLocalAnnotations(caseId), filters);
  }
}

export async function createAnnotation(
  caseId: string,
  input: CreateAnnotationInput,
): Promise<AnnotationRecord> {
  try {
    return await fetchJson<AnnotationRecord>(`/cases/${encodeURIComponent(caseId)}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (!isMissingEndpointError(error)) throw error;
    const record: AnnotationRecord = {
      id: makeLocalId("note"),
      case_id: caseId,
      target_type: input.target_type,
      target_id: input.target_id,
      target_label: input.target_label,
      tag: input.tag ?? "",
      title: input.title ?? "",
      body: input.body,
      author: input.author,
      created_at: new Date().toISOString(),
    };
    const rows = [record, ...loadLocalAnnotations(caseId)];
    saveLocalAnnotations(caseId, rows);
    return record;
  }
}

export async function deleteAnnotation(
  caseId: string,
  annotationId: string,
): Promise<{ ok: boolean }> {
  try {
    return await fetchJson<{ ok: boolean }>(
      `/cases/${encodeURIComponent(caseId)}/annotations/${encodeURIComponent(annotationId)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    if (!isMissingEndpointError(error)) throw error;
    saveLocalAnnotations(
      caseId,
      loadLocalAnnotations(caseId).filter((annotation) => annotation.id !== annotationId),
    );
    return { ok: true };
  }
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

// --- Witness comparison ----------------------------------------------------

export interface WitnessRef {
  id: string;
  name: string | null;
}

export interface ClaimCell {
  value: string;
  source_doc_id: string;
  chunk_id: string;
  char_start: number;
  char_end: number;
}

export interface ComparisonRow {
  predicate: string;
  subject_entity_id: string;
  subject_label: string | null;
  cells: Record<string, ClaimCell[]>;
  agreement: "agreement" | "conflict" | "single_source";
}

export interface WitnessComparisonResponse {
  witnesses: WitnessRef[];
  rows: ComparisonRow[];
}

export async function getWitnessComparison(
  caseId: string,
  entityIds: string[],
): Promise<WitnessComparisonResponse> {
  const qs = new URLSearchParams({ entity_ids: entityIds.join(",") });
  try {
    return await fetchJson<WitnessComparisonResponse>(
      `/cases/${encodeURIComponent(caseId)}/witness-comparison?${qs.toString()}`,
    );
  } catch (error) {
    if (!isMissingEndpointError(error)) throw error;
    return buildWitnessComparisonFallback(caseId, entityIds);
  }
}

function isMissingEndpointError(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

async function buildCaseDashboardFallback(caseId: string): Promise<CaseDashboard> {
  const [summary, graph, events, documents, contradictions] = await Promise.all([
    getCase(caseId),
    getGraph(caseId),
    getEvents(caseId),
    listDocuments(caseId),
    listContradictions(caseId),
  ]);

  const eventRange = {
    start: events[0]?.occurred_at ?? null,
    end: events[events.length - 1]?.occurred_at ?? null,
  };

  return {
    summary: {
      ...summary,
      document_count: documents.length,
      entity_count: graph.entities.length,
      contradiction_count: contradictions.length,
    },
    event_count: events.length,
    date_range: eventRange,
    entity_breakdown: buildEntityBreakdown(graph),
    recent_documents: documents.slice(0, 5).map((doc, index) => ({
      id: doc.id,
      filename: doc.filename,
      mime_type: doc.mime_type,
      char_length: doc.char_length,
      // Old backend responses do not expose created_at; synthesize a stable display value.
      created_at: new Date(Date.now() - index * 60_000).toISOString(),
    })),
    timeline_highlights: selectTimelineHighlights(events).map((event) => ({
      id: event.id,
      description: event.description,
      occurred_at: event.occurred_at,
      participant_count: event.participants.length,
      participants: event.participants.map((participant) => participant.name),
    })),
    top_contradictions: contradictions.slice(0, 5).map((contradiction) => ({
      id: contradiction.id,
      subject_entity_id: contradiction.subject_entity_id,
      subject_entity_name: contradiction.subject_entity_name,
      predicate: contradiction.predicate,
      explanation: contradiction.explanation,
      rank_score: contradiction.rank_score,
      claim_count: contradiction.claims.length,
    })),
  };
}

function buildEntityBreakdown(graph: GraphResponse): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entity of graph.entities) {
    counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function selectTimelineHighlights(events: TimelineEventRecord[], limit = 5): TimelineEventRecord[] {
  if (events.length <= limit) return events;

  const midpoint = Math.min(2, events.length);
  const tailCount = Math.max(limit - midpoint, 0);
  const ordered: TimelineEventRecord[] = [];
  const seen = new Set<string>();

  for (const event of [...events.slice(0, midpoint), ...events.slice(-tailCount)]) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    ordered.push(event);
  }
  return ordered.slice(0, limit);
}

async function normalizeContradictions(
  caseId: string,
  rows: ContradictionDetail[],
): Promise<ContradictionDetail[]> {
  const needsEnrichment = rows.some(
    (row) =>
      !row.subject_entity_name ||
      row.claims.some((claim) => !claim.speaker_entity_name || !claim.source_doc_filename),
  );

  if (!needsEnrichment) {
    return rows.map((row) => ({
      ...row,
      claims: row.claims.map((claim) => ({
        ...claim,
        source_doc_filename: claim.source_doc_filename,
      })),
    }));
  }

  const [graph, documents] = await Promise.all([
    getGraph(caseId).catch(() => null),
    listDocuments(caseId).catch(() => [] as DocumentSummary[]),
  ]);

  const entityNameById = new Map(graph?.entities.map((entity) => [entity.id, entity.name]) ?? []);
  const documentById = new Map(documents.map((doc) => [doc.id, doc]));

  return rows.map((row) => ({
    ...row,
    subject_entity_name:
      row.subject_entity_name ?? entityNameById.get(row.subject_entity_id) ?? null,
    claims: row.claims.map((claim) => ({
      ...claim,
      speaker_entity_name:
        claim.speaker_entity_name ??
        (claim.speaker_entity_id ? entityNameById.get(claim.speaker_entity_id) ?? null : null),
      source_doc_filename:
        claim.source_doc_filename ??
        documentById.get(claim.source_doc_id)?.filename ??
        claim.source_doc_id.slice(0, 8),
    })),
  }));
}

async function buildWitnessComparisonFallback(
  caseId: string,
  entityIds: string[],
): Promise<WitnessComparisonResponse> {
  const [graph, contradictions] = await Promise.all([getGraph(caseId), listContradictions(caseId)]);
  const entityNameById = new Map(graph.entities.map((entity) => [entity.id, entity.name]));

  const rows: ComparisonRow[] = contradictions
    .map((contradiction) => {
      const cells = Object.fromEntries(
        entityIds.map((entityId) => [
          entityId,
          contradiction.claims
            .filter((claim) => claim.speaker_entity_id === entityId)
            .map((claim) => ({
              value: claim.value,
              source_doc_id: claim.source_doc_id,
              chunk_id: claim.chunk_id,
              char_start: claim.char_start,
              char_end: claim.char_end,
            })),
        ]),
      ) as Record<string, ClaimCell[]>;

      return {
        predicate: contradiction.predicate,
        subject_entity_id: contradiction.subject_entity_id,
        subject_label: contradiction.subject_entity_name,
        cells,
        agreement: computeWitnessAgreement(cells),
      } satisfies ComparisonRow;
    })
    .filter((row) => Object.values(row.cells).some((claims) => claims.length > 0));

  return {
    witnesses: entityIds.map((entityId) => ({
      id: entityId,
      name: entityNameById.get(entityId) ?? null,
    })),
    rows,
  };
}

function computeWitnessAgreement(
  cells: Record<string, ClaimCell[]>,
): ComparisonRow["agreement"] {
  const witnessCount = Object.values(cells).filter((claims) => claims.length > 0).length;
  if (witnessCount <= 1) return "single_source";

  const distinctValues = new Set(
    Object.values(cells)
      .flat()
      .map((claim) => claim.value.trim().toLowerCase()),
  );
  return distinctValues.size <= 1 ? "agreement" : "conflict";
}

function annotationStorageKey(caseId: string): string {
  return `${LOCAL_ANNOTATIONS_KEY_PREFIX}${caseId}`;
}

function loadLocalAnnotations(caseId: string): AnnotationRecord[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(annotationStorageKey(caseId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalAnnotations(caseId: string, rows: AnnotationRecord[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(annotationStorageKey(caseId), JSON.stringify(rows));
}

function filterLocalAnnotations(
  rows: AnnotationRecord[],
  filters?: { targetType?: AnnotationTargetType; targetId?: string },
): AnnotationRecord[] {
  return rows.filter((row) => {
    if (filters?.targetType && row.target_type !== filters.targetType) return false;
    if (filters?.targetId && row.target_id !== filters.targetId) return false;
    return true;
  });
}

function makeLocalId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
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
