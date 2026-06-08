import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getGraph: vi.fn(),
    getWitnessComparison: vi.fn(),
    listDocuments: vi.fn(),
  };
});

import {
  getGraph,
  getWitnessComparison,
  listDocuments,
  type WitnessComparisonResponse,
} from "@/lib/api";
import { WitnessComparison } from "../WitnessComparison";

const mockDocs = [
  {
    id: "doc_smith",
    case_id: "demo",
    filename: "smith_deposition.txt",
    mime_type: "text/plain",
    char_length: 500,
    created_at: "2026-04-28",
  },
  {
    id: "doc_fastow",
    case_id: "demo",
    filename: "fastow_deposition.txt",
    mime_type: "text/plain",
    char_length: 600,
    created_at: "2026-04-28",
  },
];

const mockGraph = {
  entities: [
    {
      id: "ent_smith",
      type: "Person" as const,
      name: "Robert K. Smith",
      mention_texts: ["Robert K. Smith"],
      provenance: [],
    },
    {
      id: "ent_fastow",
      type: "Person" as const,
      name: "Andrew S. Fastow",
      mention_texts: ["Andrew S. Fastow"],
      provenance: [],
    },
    {
      id: "ent_skilling",
      type: "Person" as const,
      name: "Jeffrey K. Skilling",
      mention_texts: ["Jeffrey K. Skilling"],
      provenance: [],
    },
    {
      id: "ent_enron",
      type: "Organization" as const,
      name: "Enron",
      mention_texts: ["Enron"],
      provenance: [],
    },
  ],
  relations: [],
};

function comparisonResponse(
  witnesses: { id: string; name: string }[],
  rows: WitnessComparisonResponse["rows"],
): WitnessComparisonResponse {
  return { witnesses, rows };
}

describe("WitnessComparison", () => {
  beforeEach(() => {
    vi.mocked(getGraph).mockReset();
    vi.mocked(getWitnessComparison).mockReset();
    vi.mocked(listDocuments).mockReset();
    vi.mocked(listDocuments).mockResolvedValue(mockDocs as never);
  });

  it("auto-selects the first two Person entities and only Person types", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce(mockGraph as never);
    vi.mocked(getWitnessComparison).mockResolvedValueOnce(
      comparisonResponse(
        [
          { id: "ent_smith", name: "Robert K. Smith" },
          { id: "ent_fastow", name: "Andrew S. Fastow" },
        ],
        [],
      ),
    );
    render(<WitnessComparison caseId="demo" />);
    await waitFor(() =>
      expect(getWitnessComparison).toHaveBeenCalledWith("demo", [
        "ent_smith",
        "ent_fastow",
      ]),
    );
    // Enron is an Organization, not a Person, so it shouldn't be pickable.
    expect(screen.queryByRole("button", { name: "Enron" })).toBeNull();
  });

  it("re-fetches when a witness is toggled in", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce(mockGraph as never);
    vi.mocked(getWitnessComparison).mockResolvedValue(
      comparisonResponse(
        [
          { id: "ent_smith", name: "Robert K. Smith" },
          { id: "ent_fastow", name: "Andrew S. Fastow" },
        ],
        [],
      ),
    );
    render(<WitnessComparison caseId="demo" />);
    await waitFor(() => expect(getWitnessComparison).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Jeffrey K. Skilling" }));
    await waitFor(() =>
      expect(getWitnessComparison).toHaveBeenLastCalledWith("demo", [
        "ent_smith",
        "ent_fastow",
        "ent_skilling",
      ]),
    );
  });

  it("renders the matrix with values from each witness's cells", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce(mockGraph as never);
    vi.mocked(getWitnessComparison).mockResolvedValueOnce(
      comparisonResponse(
        [
          { id: "ent_smith", name: "Robert K. Smith" },
          { id: "ent_fastow", name: "Andrew S. Fastow" },
        ],
        [
          {
            predicate: "attended_meeting_on",
            subject_entity_id: "ent_raptor",
            subject_label: "Raptor II meeting",
            cells: {
              ent_smith: [
                {
                  value: "March 12, 2001",
                  source_doc_id: "doc_smith",
                  chunk_id: "doc_smith:0",
                  char_start: 50,
                  char_end: 65,
                },
              ],
              ent_fastow: [
                {
                  value: "March 15, 2001",
                  source_doc_id: "doc_fastow",
                  chunk_id: "doc_fastow:0",
                  char_start: 30,
                  char_end: 45,
                },
              ],
            },
            agreement: "conflict",
          },
        ],
      ),
    );
    render(<WitnessComparison caseId="demo" />);
    expect(await screen.findByText("March 12, 2001")).toBeTruthy();
    expect(screen.getByText("March 15, 2001")).toBeTruthy();
    // Topic label shown as the group header.
    expect(screen.getByText(/Raptor II meeting/)).toBeTruthy();
  });

  it("color-codes a conflict row and a single_source row distinctly", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce(mockGraph as never);
    vi.mocked(getWitnessComparison).mockResolvedValueOnce(
      comparisonResponse(
        [
          { id: "ent_smith", name: "Robert K. Smith" },
          { id: "ent_fastow", name: "Andrew S. Fastow" },
        ],
        [
          {
            predicate: "wire_transfer_amount",
            subject_entity_id: "ent_transfer",
            subject_label: "Wire transfer",
            cells: {
              ent_smith: [
                {
                  value: "$2.5M",
                  source_doc_id: "doc_smith",
                  chunk_id: "doc_smith:0",
                  char_start: 1,
                  char_end: 5,
                },
              ],
              ent_fastow: [
                {
                  value: "$5M",
                  source_doc_id: "doc_fastow",
                  chunk_id: "doc_fastow:0",
                  char_start: 1,
                  char_end: 3,
                },
              ],
            },
            agreement: "conflict",
          },
          {
            predicate: "authorized_by",
            subject_entity_id: "ent_transfer",
            subject_label: "Wire transfer",
            cells: {
              ent_smith: [
                {
                  value: "Skilling",
                  source_doc_id: "doc_smith",
                  chunk_id: "doc_smith:0",
                  char_start: 10,
                  char_end: 18,
                },
              ],
              ent_fastow: [],
            },
            agreement: "single_source",
          },
        ],
      ),
    );
    render(<WitnessComparison caseId="demo" />);
    await screen.findByText("$2.5M");
    expect(screen.getByText("Conflict")).toBeTruthy();
    expect(screen.getByText("Single source")).toBeTruthy();
    // Empty Fastow cell shows the "not asked" marker.
    const notAsked = screen.getAllByText(/not asked/);
    expect(notAsked.length).toBeGreaterThanOrEqual(1);
  });

  it("fires onJumpToProvenance when a source filename link is clicked", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce(mockGraph as never);
    vi.mocked(getWitnessComparison).mockResolvedValueOnce(
      comparisonResponse(
        [
          { id: "ent_smith", name: "Robert K. Smith" },
          { id: "ent_fastow", name: "Andrew S. Fastow" },
        ],
        [
          {
            predicate: "attended_meeting_on",
            subject_entity_id: "ent_raptor",
            subject_label: "Raptor II meeting",
            cells: {
              ent_smith: [
                {
                  value: "March 12, 2001",
                  source_doc_id: "doc_smith",
                  chunk_id: "doc_smith:0",
                  char_start: 50,
                  char_end: 65,
                },
              ],
              ent_fastow: [],
            },
            agreement: "single_source",
          },
        ],
      ),
    );
    const onJumpToProvenance = vi.fn();
    render(
      <WitnessComparison
        caseId="demo"
        onJumpToProvenance={onJumpToProvenance}
      />,
    );
    // Click goes through the filename link, not the value text.
    fireEvent.click(await screen.findByRole("button", { name: "smith_deposition.txt" }));
    expect(onJumpToProvenance).toHaveBeenCalledWith("doc_smith", 50, 65);
  });

  it("renders one clickable filename per distinct source doc when a value has multiple sources", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce(mockGraph as never);
    vi.mocked(getWitnessComparison).mockResolvedValueOnce(
      comparisonResponse(
        [
          { id: "ent_smith", name: "Robert K. Smith" },
          { id: "ent_fastow", name: "Andrew S. Fastow" },
        ],
        [
          {
            predicate: "wire_transfer_amount",
            subject_entity_id: "ent_transfer",
            subject_label: "Wire transfer",
            cells: {
              ent_smith: [
                {
                  value: "2500000",
                  source_doc_id: "doc_smith",
                  chunk_id: "doc_smith:0",
                  char_start: 10,
                  char_end: 17,
                },
                {
                  value: "2500000",
                  source_doc_id: "doc_fastow",
                  chunk_id: "doc_fastow:0",
                  char_start: 20,
                  char_end: 27,
                },
              ],
              ent_fastow: [],
            },
            agreement: "single_source",
          },
        ],
      ),
    );
    const onJumpToProvenance = vi.fn();
    render(
      <WitnessComparison
        caseId="demo"
        onJumpToProvenance={onJumpToProvenance}
      />,
    );
    // Numeric value becomes currency since the predicate looks like money.
    await screen.findByText(/\$2,500,000/);
    // Each source filename is its own clickable link.
    fireEvent.click(screen.getByRole("button", { name: "fastow_deposition.txt" }));
    expect(onJumpToProvenance).toHaveBeenCalledWith("doc_fastow", 20, 27);
  });

  it("shows a helpful empty state when chosen witnesses have no overlapping claims", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce(mockGraph as never);
    vi.mocked(getWitnessComparison).mockResolvedValueOnce(
      comparisonResponse(
        [
          { id: "ent_smith", name: "Robert K. Smith" },
          { id: "ent_fastow", name: "Andrew S. Fastow" },
        ],
        [],
      ),
    );
    render(<WitnessComparison caseId="demo" />);
    // Component uses a curly apostrophe (&rsquo;) — match without it to be robust.
    expect(
      await screen.findByText(/made overlapping claims/i),
    ).toBeTruthy();
  });

  it("dedupes repeat values within a cell and shows the source filename", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce(mockGraph as never);
    vi.mocked(getWitnessComparison).mockResolvedValueOnce(
      comparisonResponse(
        [
          { id: "ent_smith", name: "Robert K. Smith" },
          { id: "ent_fastow", name: "Andrew S. Fastow" },
        ],
        [
          {
            predicate: "wire_transfer_amount",
            subject_entity_id: "ent_transfer",
            subject_label: "Wire transfer",
            cells: {
              ent_smith: [
                // Same value 3 times from the same doc — should collapse.
                {
                  value: "2500000",
                  source_doc_id: "doc_smith",
                  chunk_id: "doc_smith:0",
                  char_start: 10,
                  char_end: 17,
                },
                {
                  value: "2500000",
                  source_doc_id: "doc_smith",
                  chunk_id: "doc_smith:0",
                  char_start: 100,
                  char_end: 107,
                },
                {
                  value: "2500000",
                  source_doc_id: "doc_smith",
                  chunk_id: "doc_smith:0",
                  char_start: 200,
                  char_end: 207,
                },
              ],
              ent_fastow: [
                {
                  value: "5000000",
                  source_doc_id: "doc_fastow",
                  chunk_id: "doc_fastow:0",
                  char_start: 30,
                  char_end: 37,
                },
              ],
            },
            agreement: "conflict",
          },
        ],
      ),
    );
    render(<WitnessComparison caseId="demo" />);
    // 3 repeats collapse to 1 row. Numeric value becomes currency.
    const smithValues = await screen.findAllByText(/\$2,500,000/);
    expect(smithValues.length).toBe(1);
    // Filename shown under the value.
    expect(screen.getByText(/smith_deposition\.txt/)).toBeTruthy();
    // Shows "3× mentions" so the dedupe is visible.
    expect(screen.getByText(/3.{0,2}mention/i)).toBeTruthy();
  });

  it("formats raw values for display: entity refs, ISO dates, and money", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce(mockGraph as never);
    vi.mocked(getWitnessComparison).mockResolvedValueOnce(
      comparisonResponse(
        [
          { id: "ent_smith", name: "Robert K. Smith" },
          { id: "ent_fastow", name: "Andrew S. Fastow" },
        ],
        [
          {
            predicate: "authorized_by",
            subject_entity_id: "ent_transfer",
            subject_label: "Wire transfer",
            cells: {
              // Entity id should resolve to the real name.
              ent_smith: [
                {
                  value: "ent_skilling",
                  source_doc_id: "doc_smith",
                  chunk_id: "doc_smith:0",
                  char_start: 1,
                  char_end: 12,
                },
              ],
              ent_fastow: [],
            },
            agreement: "single_source",
          },
          {
            predicate: "occurred_on",
            subject_entity_id: "ent_meeting",
            subject_label: "Meeting",
            cells: {
              // ISO date should format to "March 12, 2001".
              ent_smith: [
                {
                  value: "2001-03-12",
                  source_doc_id: "doc_smith",
                  chunk_id: "doc_smith:0",
                  char_start: 1,
                  char_end: 11,
                },
              ],
              ent_fastow: [],
            },
            agreement: "single_source",
          },
        ],
      ),
    );
    render(<WitnessComparison caseId="demo" />);
    // ent_skilling -> "Jeffrey K. Skilling" from mockGraph.
    expect(await screen.findByText("Jeffrey K. Skilling")).toBeTruthy();
    // ISO -> "March 12, 2001"
    expect(screen.getByText("March 12, 2001")).toBeTruthy();
    // snake_case -> "Authorized by", "Occurred on"
    expect(screen.getByText("Authorized by")).toBeTruthy();
    expect(screen.getByText("Occurred on")).toBeTruthy();
  });

  it("surfaces an API error from the matrix fetch", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce(mockGraph as never);
    vi.mocked(getWitnessComparison).mockRejectedValueOnce(new Error("boom"));
    render(<WitnessComparison caseId="demo" />);
    expect(await screen.findByText(/boom/)).toBeTruthy();
  });

  it("renders a 'no people extracted' empty state when there are no Person entities", async () => {
    vi.mocked(getGraph).mockResolvedValueOnce({
      entities: [],
      relations: [],
    } as never);
    render(<WitnessComparison caseId="demo" />);
    expect(await screen.findByText(/No people extracted yet/)).toBeTruthy();
    expect(getWitnessComparison).not.toHaveBeenCalled();
  });
});
