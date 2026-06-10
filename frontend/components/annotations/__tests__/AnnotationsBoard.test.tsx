import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", () => ({
  listAnnotations: vi.fn(),
  createAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
  listDocuments: vi.fn(),
  getEvents: vi.fn(),
  listContradictions: vi.fn(),
  parseProvenance: vi.fn((value: string) => {
    const match = value.match(/^([^:]+):(.+):(\d+)-(\d+)$/);
    if (!match) return null;
    return {
      docId: match[1],
      chunkId: match[2],
      start: Number(match[3]),
      end: Number(match[4]),
    };
  }),
}));

import {
  createAnnotation,
  deleteAnnotation,
  getEvents,
  listAnnotations,
  listContradictions,
  listDocuments,
  parseProvenance,
  type AnnotationRecord,
} from "@/lib/api";
import { AnnotationsBoard } from "../AnnotationsBoard";

function makeAnnotation(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    id: "note-1",
    case_id: "demo",
    target_type: "case",
    target_id: "demo",
    target_label: "Enron Demo",
    tag: "case-note",
    title: "Open thread",
    body: "Need to reconcile the deposition chronology.",
    author: "Nathan575",
    created_at: "2026-06-06T18:30:00Z",
    ...overrides,
  };
}

describe("AnnotationsBoard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    vi.mocked(parseProvenance).mockImplementation((value: string) => {
      const dashIdx = value.lastIndexOf("-");
      if (dashIdx < 0) return null;
      const lastColon = value.lastIndexOf(":", dashIdx);
      if (lastColon < 0) return null;
      const start = Number(value.slice(lastColon + 1, dashIdx));
      const end = Number(value.slice(dashIdx + 1));
      const head = value.slice(0, lastColon);
      const split = head.indexOf(":");
      if (split < 0) return null;
      return {
        docId: head.slice(0, split),
        chunkId: head.slice(split + 1),
        start,
        end,
      };
    });
    vi.mocked(listDocuments).mockResolvedValue([
      {
        id: "doc-7",
        case_id: "demo",
        filename: "memo.txt",
        mime_type: "text/plain",
        char_length: 140,
      },
      {
        id: "doc-8",
        case_id: "demo",
        filename: "meeting_notes.txt",
        mime_type: "text/plain",
        char_length: 200,
      },
    ] as never);
    vi.mocked(getEvents).mockResolvedValue([
      {
        id: "event-1",
        description: "Board approves new plan",
        occurred_at: "2001-08-14",
        participant_ids: [],
        participants: [],
        provenance: ["doc-8:doc-8:0:12-32"],
      },
    ] as never);
    vi.mocked(listContradictions).mockResolvedValue([
      {
        id: "contra-7",
        subject_entity_id: "ent-1",
        subject_entity_name: "Robert K. Smith",
        predicate: "attended_meeting_on",
        explanation: "",
        rank_score: 1,
        claims: [
          {
            claim_id: "claim-1",
            value: "2001-03-12",
            speaker_entity_id: "ent-1",
            speaker_entity_name: "Robert K. Smith",
            source_doc_id: "doc-8",
            source_doc_filename: "meeting_notes.txt",
            chunk_id: "doc-8:0",
            char_start: 12,
            char_end: 32,
            excerpt: "excerpt",
          },
        ],
      },
    ] as never);
  });

  it("renders existing notes and filters by target type", async () => {
    vi.mocked(listAnnotations).mockResolvedValue([
      makeAnnotation(),
      makeAnnotation({
        id: "note-2",
        target_type: "event",
        target_id: "event-1",
        target_label: "2001-08-14 · Board approves new plan",
        tag: "timeline",
        title: "Board meeting",
        body: "Tie this to the compensation memo.",
      }),
    ] as never);

    render(<AnnotationsBoard caseId="demo" caseLabel="Enron Demo" draftTarget={null} />);

    expect(await screen.findByText("Open thread")).toBeTruthy();
    expect(await screen.findByText("Board meeting")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Timeline notes" }));

    expect(screen.queryByText("Open thread")).toBeNull();
    expect(await screen.findByText("Board meeting")).toBeTruthy();
  });

  it("creates a note linked to the drafted target", async () => {
    vi.mocked(listAnnotations).mockResolvedValue([] as never);
    vi.mocked(createAnnotation).mockResolvedValue(
      makeAnnotation({
        id: "note-3",
        target_type: "document",
        target_id: "doc-7",
        target_label: "memo.txt",
        tag: "source",
        title: "Key exhibit",
        body: "Need follow-up from CFO.",
      }) as never,
    );

    render(
      <AnnotationsBoard
        caseId="demo"
        caseLabel="Enron Demo"
        draftTarget={{
          targetType: "document",
          targetId: "doc-7",
          targetLabel: "memo.txt",
          suggestedTag: "source",
        }}
      />,
    );

    await screen.findByText("No annotations yet");

    fireEvent.change(screen.getByLabelText("Author"), { target: { value: "Nathan575" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Key exhibit" } });
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Need follow-up from CFO." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));

    await waitFor(() =>
      expect(createAnnotation).toHaveBeenCalledWith("demo", {
        target_type: "document",
        target_id: "doc-7",
        target_label: "memo.txt",
        tag: "source",
        title: "Key exhibit",
        body: "Need follow-up from CFO.",
        author: "Nathan575",
      }),
    );
    expect(await screen.findByText("Need follow-up from CFO.")).toBeTruthy();
  });

  it("deletes an existing note from the feed", async () => {
    vi.mocked(listAnnotations).mockResolvedValue([makeAnnotation()] as never);
    vi.mocked(deleteAnnotation).mockResolvedValue({ ok: true } as never);

    render(<AnnotationsBoard caseId="demo" caseLabel="Enron Demo" draftTarget={null} />);

    expect(await screen.findByText("Open thread")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteAnnotation).toHaveBeenCalledWith("demo", "note-1"));
    await waitFor(() => expect(screen.queryByText("Open thread")).toBeNull());
  });

  it("shows source evidence for a document note and opens the document", async () => {
    vi.mocked(listAnnotations).mockResolvedValue([
      makeAnnotation({
        id: "note-doc",
        target_type: "document",
        target_id: "doc-7",
        target_label: "memo.txt",
        title: "Key exhibit",
      }),
    ] as never);

    const onOpenDocument = vi.fn();

    render(
      <AnnotationsBoard
        caseId="demo"
        caseLabel="Enron Demo"
        draftTarget={null}
        onOpenDocument={onOpenDocument}
      />,
    );

    expect(await screen.findByText("Source Evidence")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /memo\.txt/i }));
    expect(onOpenDocument).toHaveBeenCalledWith("doc-7");
  });

  it("shows source evidence for an event note and opens the excerpt", async () => {
    vi.mocked(listAnnotations).mockResolvedValue([
      makeAnnotation({
        id: "note-event",
        target_type: "event",
        target_id: "event-1",
        target_label: "2001-08-14 · Board approves new plan",
        title: "Board meeting",
      }),
    ] as never);

    const onOpenEvidence = vi.fn();

    render(
      <AnnotationsBoard
        caseId="demo"
        caseLabel="Enron Demo"
        draftTarget={null}
        onOpenEvidence={onOpenEvidence}
      />,
    );

    expect(await screen.findByText("Timeline source excerpt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /meeting_notes\.txt/i }));
    expect(onOpenEvidence).toHaveBeenCalledWith("doc-8", 12, 32);
  });
});
