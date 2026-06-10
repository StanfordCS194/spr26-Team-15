import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAnnotation,
  deleteAnnotation,
  getCaseDashboard,
  getWitnessComparison,
  listAnnotations,
  listContradictions,
  parseProvenance,
} from "@/lib/api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe("parseProvenance", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("parses a standard provenance string", () => {
    const p = parseProvenance("abc-123:abc-123:0:10-25");
    expect(p).toEqual({ docId: "abc-123", chunkId: "abc-123:0", start: 10, end: 25 });
  });

  it("returns null for malformed input", () => {
    expect(parseProvenance("not-a-provenance")).toBeNull();
  });

  it("handles multi-colon chunk IDs", () => {
    const p = parseProvenance("doc:X:chunk:Y:5-30");
    expect(p?.start).toBe(5);
    expect(p?.end).toBe(30);
  });

  it("builds the dashboard from stable endpoints when /dashboard is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/cases/demo/dashboard")) {
          return jsonResponse({ detail: "Not Found" }, 404);
        }
        if (url.endsWith("/cases/demo")) {
          return jsonResponse({
            id: "demo",
            name: "Enron Demo",
            document_count: 0,
            entity_count: 0,
            contradiction_count: 0,
          });
        }
        if (url.endsWith("/cases/demo/graph")) {
          return jsonResponse({
            entities: [
              { id: "p1", type: "Person", name: "Robert Smith", mention_texts: [], provenance: [] },
              { id: "o1", type: "Organization", name: "Enron", mention_texts: [], provenance: [] },
              { id: "p2", type: "Person", name: "Andrew Fastow", mention_texts: [], provenance: [] },
            ],
            relations: [],
          });
        }
        if (url.endsWith("/cases/demo/events")) {
          return jsonResponse([
            {
              id: "ev1",
              description: "Kickoff meeting",
              occurred_at: "2001-03-09",
              participant_ids: ["p1"],
              participants: [{ id: "p1", name: "Robert Smith" }],
              provenance: [],
            },
            {
              id: "ev2",
              description: "Transfer approved",
              occurred_at: "2001-03-12",
              participant_ids: ["p2"],
              participants: [{ id: "p2", name: "Andrew Fastow" }],
              provenance: [],
            },
          ]);
        }
        if (url.endsWith("/cases/demo/documents")) {
          return jsonResponse([
            { id: "doc1", case_id: "demo", filename: "memo.txt", mime_type: "text/plain", char_length: 120 },
            { id: "doc2", case_id: "demo", filename: "email.txt", mime_type: "text/plain", char_length: 80 },
          ]);
        }
        if (url.endsWith("/cases/demo/contradictions")) {
          return jsonResponse([
            {
              id: "c1",
              subject_entity_id: "p1",
              subject_entity_name: "Robert Smith",
              predicate: "attended_meeting_on",
              explanation: "Conflicting dates",
              rank_score: 2.5,
              claims: [],
            },
          ]);
        }
        throw new Error(`Unhandled fetch ${url}`);
      }),
    );

    const dashboard = await getCaseDashboard("demo");

    expect(dashboard.summary.document_count).toBe(2);
    expect(dashboard.summary.entity_count).toBe(3);
    expect(dashboard.summary.contradiction_count).toBe(1);
    expect(dashboard.entity_breakdown[0]).toEqual({ type: "Person", count: 2 });
    expect(dashboard.timeline_highlights[0].description).toBe("Kickoff meeting");
  });

  it("enriches older contradiction payloads with speaker names and filenames", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/cases/demo/contradictions")) {
          return jsonResponse([
            {
              id: "c1",
              subject_entity_id: "p1",
              subject_entity_name: null,
              predicate: "attended_meeting_on",
              explanation: "",
              rank_score: 1,
              claims: [
                {
                  claim_id: "cl1",
                  value: "2001-03-12",
                  speaker_entity_id: "p1",
                  source_doc_id: "doc1",
                  chunk_id: "doc1:0",
                  char_start: 1,
                  char_end: 8,
                  excerpt: "excerpt",
                },
              ],
            },
          ]);
        }
        if (url.endsWith("/cases/demo/graph")) {
          return jsonResponse({
            entities: [{ id: "p1", type: "Person", name: "Robert Smith", mention_texts: [], provenance: [] }],
            relations: [],
          });
        }
        if (url.endsWith("/cases/demo/documents")) {
          return jsonResponse([
            { id: "doc1", case_id: "demo", filename: "smith_deposition.txt", mime_type: "text/plain", char_length: 500 },
          ]);
        }
        throw new Error(`Unhandled fetch ${url}`);
      }),
    );

    const contradictions = await listContradictions("demo");

    expect(contradictions[0].subject_entity_name).toBe("Robert Smith");
    expect(contradictions[0].claims[0].speaker_entity_name).toBe("Robert Smith");
    expect(contradictions[0].claims[0].source_doc_filename).toBe("smith_deposition.txt");
  });

  it("builds the witness comparison matrix from contradictions when the endpoint is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/witness-comparison?")) {
          return jsonResponse({ detail: "Not Found" }, 404);
        }
        if (url.endsWith("/cases/demo/graph")) {
          return jsonResponse({
            entities: [
              { id: "p1", type: "Person", name: "Robert Smith", mention_texts: [], provenance: [] },
              { id: "p2", type: "Person", name: "Andrew Fastow", mention_texts: [], provenance: [] },
              { id: "meeting", type: "Event", name: "Raptor meeting", mention_texts: [], provenance: [] },
            ],
            relations: [],
          });
        }
        if (url.endsWith("/cases/demo/contradictions")) {
          return jsonResponse([
            {
              id: "c1",
              subject_entity_id: "meeting",
              subject_entity_name: "Raptor meeting",
              predicate: "occurred_on",
              explanation: "",
              rank_score: 10,
              claims: [
                {
                  claim_id: "cl1",
                  value: "2001-03-12",
                  speaker_entity_id: "p1",
                  speaker_entity_name: "Robert Smith",
                  source_doc_id: "doc1",
                  source_doc_filename: "smith.txt",
                  chunk_id: "doc1:0",
                  char_start: 1,
                  char_end: 10,
                  excerpt: "excerpt",
                },
                {
                  claim_id: "cl2",
                  value: "2001-03-15",
                  speaker_entity_id: "p2",
                  speaker_entity_name: "Andrew Fastow",
                  source_doc_id: "doc2",
                  source_doc_filename: "fastow.txt",
                  chunk_id: "doc2:0",
                  char_start: 2,
                  char_end: 11,
                  excerpt: "excerpt",
                },
              ],
            },
          ]);
        }
        throw new Error(`Unhandled fetch ${url}`);
      }),
    );

    const matrix = await getWitnessComparison("demo", ["p1", "p2"]);

    expect(matrix.witnesses).toEqual([
      { id: "p1", name: "Robert Smith" },
      { id: "p2", name: "Andrew Fastow" },
    ]);
    expect(matrix.rows[0].agreement).toBe("conflict");
    expect(matrix.rows[0].cells.p1[0].value).toBe("2001-03-12");
  });

  it("uses local storage for annotations when the backend endpoint is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ detail: "Not Found" }, 404)),
    );

    const created = await createAnnotation("demo", {
      target_type: "case",
      target_id: "demo",
      target_label: "Enron Demo",
      tag: "timeline",
      title: "Follow up",
      body: "Need to clarify the March 12 meeting.",
      author: "ganeshve",
    });

    expect(created.target_label).toBe("Enron Demo");

    const rows = await listAnnotations("demo");
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain("March 12");

    await deleteAnnotation("demo", created.id);
    await expect(listAnnotations("demo")).resolves.toEqual([]);
  });
});
