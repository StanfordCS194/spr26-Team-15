import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", () => ({
  listAnnotations: vi.fn(),
  createAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
}));

import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
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
});
