import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getCaseDashboard: vi.fn(),
  };
});

import { getCaseDashboard } from "@/lib/api";
import { CaseDashboard } from "../CaseDashboard";

const mockDashboard = {
  summary: {
    id: "demo",
    name: "Enron Demo",
    document_count: 3,
    entity_count: 12,
    contradiction_count: 2,
  },
  event_count: 4,
  date_range: {
    start: "2001-03-12",
    end: "2001-08-14",
  },
  entity_breakdown: [
    { type: "Person", count: 7 },
    { type: "Organization", count: 3 },
  ],
  recent_documents: [
    {
      id: "doc-1",
      filename: "smith_deposition.txt",
      mime_type: "text/plain",
      char_length: 4200,
      created_at: "2026-06-06T20:00:00Z",
    },
  ],
  timeline_highlights: [
    {
      id: "ev-1",
      description: "Finance committee meeting",
      occurred_at: "2001-03-12",
      participant_count: 2,
      participants: ["Robert K. Smith", "Andrew S. Fastow"],
    },
  ],
  top_contradictions: [
    {
      id: "contra-1",
      subject_entity_id: "ent-1",
      subject_entity_name: "Robert K. Smith",
      predicate: "attended_meeting_on",
      explanation: "Statements disagree on the date of the meeting.",
      rank_score: 0.92,
      claim_count: 2,
    },
  ],
};

describe("CaseDashboard", () => {
  beforeEach(() => {
    vi.mocked(getCaseDashboard).mockResolvedValue(mockDashboard as never);
  });

  it("renders summary metrics and key sections", async () => {
    render(
      <CaseDashboard
        caseId="demo"
        onOpenWorkspace={() => {}}
        onOpenContradictions={() => {}}
        onOpenDocument={() => {}}
      />,
    );

    expect(await screen.findByText(/Start with the case overview/i)).toBeTruthy();
    expect(screen.getByText("Timeline Highlights")).toBeTruthy();
    expect(screen.getByText("Contradiction Hotspots")).toBeTruthy();
    expect(screen.getByText("Recent Documents")).toBeTruthy();
    expect(screen.getByText("Entity Mix")).toBeTruthy();
    expect(screen.getByText("Finance committee meeting")).toBeTruthy();
    expect(screen.getByText("smith_deposition.txt")).toBeTruthy();
  });

  it("routes action buttons through the provided callbacks", async () => {
    const onOpenWorkspace = vi.fn();
    const onOpenContradictions = vi.fn();
    const onOpenDocument = vi.fn();

    render(
      <CaseDashboard
        caseId="demo"
        onOpenWorkspace={onOpenWorkspace}
        onOpenContradictions={onOpenContradictions}
        onOpenDocument={onOpenDocument}
      />,
    );

    await screen.findByText("Finance committee meeting");

    fireEvent.click(screen.getByRole("button", { name: /Open timeline workspace/i }));
    expect(onOpenWorkspace).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Review contradictions/i }));
    expect(onOpenContradictions).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Open doc/i }));
    expect(onOpenDocument).toHaveBeenCalledWith("doc-1");
  });

  it("shows empty-state copy when dashboard buckets are empty", async () => {
    vi.mocked(getCaseDashboard).mockResolvedValueOnce({
      ...mockDashboard,
      event_count: 0,
      date_range: { start: null, end: null },
      entity_breakdown: [],
      recent_documents: [],
      timeline_highlights: [],
      top_contradictions: [],
    } as never);

    render(
      <CaseDashboard
        caseId="demo"
        onOpenWorkspace={() => {}}
        onOpenContradictions={() => {}}
        onOpenDocument={() => {}}
      />,
    );

    expect(await screen.findByText(/No extracted events yet/i)).toBeTruthy();
    expect(screen.getByText(/No contradictions are currently ranked/i)).toBeTruthy();
    expect(screen.getByText(/No source documents have been uploaded yet/i)).toBeTruthy();
    expect(screen.getByText(/Entity resolution has not produced a graph yet/i)).toBeTruthy();
  });
});
