import { describe, expect, it } from "vitest";

import { createReportFilename, formatCaseReport } from "@/lib/exportReport";

describe("createReportFilename", () => {
  it("slugifies case ids into stable markdown filenames", () => {
    expect(createReportFilename("Case 001 / Demo")).toBe("case-001-demo-report.md");
  });

  it("falls back when the case id is blank", () => {
    expect(createReportFilename("   ")).toBe("case-report.md");
  });
});

describe("formatCaseReport", () => {
  it("includes timeline highlights and contradiction details", () => {
    const report = formatCaseReport({
      summary: {
        id: "demo",
        name: "Enron Demo",
        document_count: 2,
        entity_count: 14,
        contradiction_count: 1,
      },
      documents: [
        {
          id: "doc-1",
          case_id: "demo",
          filename: "memo.txt",
          mime_type: "text/plain",
          char_length: 987,
          created_at: "2026-05-22T10:00:00Z",
        },
      ],
      events: [
        {
          id: "event-1",
          description: " Board   approves   new compensation plan ",
          occurred_at: "2001-08-14",
          participant_ids: ["e-1", "e-2"],
          participants: [
            { id: "e-1", name: "Kenneth Lay" },
            { id: "e-2", name: "Enron Corp." },
          ],
          provenance: ["doc-1:chunk-1:10-22", "doc-1:chunk-2:40-58"],
        },
      ],
      contradictions: [
        {
          id: "c-1",
          subject_entity_id: "e-3",
          subject_entity_name: "Andrew Fastow",
          predicate: "role",
          explanation: "Records disagree about Fastow's title.",
          rank_score: 0.91,
          claims: [
            {
              claim_id: "claim-1",
              value: "CFO",
              speaker_entity_id: null,
              speaker_entity_name: null,
              source_doc_id: "doc-1",
              chunk_id: "chunk-1",
              char_start: 10,
              char_end: 22,
              excerpt: " Fastow   served as CFO. ",
            },
          ],
        },
      ],
      generatedAt: new Date("2026-05-22T17:30:00Z"),
    });

    expect(report).toContain("# Case Report: Enron Demo");
    expect(report).toContain("## Timeline Highlights");
    expect(report).toContain("Supporting excerpts: 2");
    expect(report).toContain("## Full Timeline");
    expect(report).toContain("Participants: Kenneth Lay, Enron Corp.");
    expect(report).toContain("### 1. Andrew Fastow · role");
    expect(report).toContain('- CFO | memo.txt | chars 10-22 | Excerpt: "Fastow served as CFO."');
  });

  it("renders sensible empty states", () => {
    const report = formatCaseReport({
      summary: {
        id: "empty",
        name: "Empty Case",
        document_count: 0,
        entity_count: 0,
        contradiction_count: 0,
      },
      documents: [],
      events: [],
      contradictions: [],
    });

    expect(report).toContain("## Documents\n- None");
    expect(report).toContain("## Timeline Highlights\nNo timeline highlights available.");
    expect(report).toContain("## Full Timeline\nNo events available.");
    expect(report).toContain("## Contradictions\nNo contradictions detected.");
  });
});
