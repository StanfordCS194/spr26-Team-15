import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listContradictions: vi.fn(),
    listDocuments: vi.fn(),
    getGraph: vi.fn(),
  };
});

import { getGraph, listContradictions, listDocuments } from "@/lib/api";
import { ContradictionsPanel } from "../ContradictionsPanel";

describe("ContradictionsPanel", () => {
  beforeEach(() => {
    vi.mocked(listDocuments).mockResolvedValue([
      {
        id: "doc_a",
        case_id: "demo",
        filename: "smith_deposition_excerpt.txt",
        mime_type: "text/plain",
        char_length: 120,
      },
      {
        id: "doc_b",
        case_id: "demo",
        filename: "fastow_deposition_excerpt.txt",
        mime_type: "text/plain",
        char_length: 120,
      },
    ] as never);
    vi.mocked(getGraph).mockResolvedValue({
      entities: [
        {
          id: "ent_smith",
          type: "Person",
          name: "Robert K. Smith",
          mention_texts: [],
          provenance: [],
        },
        {
          id: "ent_fastow",
          type: "Person",
          name: "Andrew S. Fastow",
          mention_texts: [],
          provenance: [],
        },
      ],
      relations: [],
    } as never);
    vi.mocked(listContradictions).mockResolvedValue([
      {
        id: "contra_1",
        subject_entity_id: "ent_smith",
        subject_entity_name: "Robert K. Smith",
        predicate: "attended_meeting_on",
        explanation: "",
        rank_score: 1.25,
        claims: [
          {
            claim_id: "cl1",
            value: "2001-03-12",
            speaker_entity_id: "ent_smith",
            speaker_entity_name: "Robert K. Smith",
            source_doc_id: "doc_a",
            source_doc_filename: "smith_deposition_excerpt.txt",
            chunk_id: "doc_a:0",
            char_start: 10,
            char_end: 25,
            excerpt: "the meeting was March 12",
          },
          {
            claim_id: "cl2",
            value: "2001-03-15",
            speaker_entity_id: "ent_fastow",
            speaker_entity_name: "Andrew S. Fastow",
            source_doc_id: "doc_b",
            source_doc_filename: "fastow_deposition_excerpt.txt",
            chunk_id: "doc_b:0",
            char_start: 40,
            char_end: 55,
            excerpt: "it happened on March 15",
          },
        ],
      },
    ] as never);
  });

  it("shows speaker names and filenames for each claim", async () => {
    const onClaimSelect = vi.fn();
    render(
      <ContradictionsPanel caseId="demo" refreshToken={0} onClaimSelect={onClaimSelect} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Predicate conflict/i }));

    expect(screen.getByText(/Robert K\. Smith · smith_deposition_excerpt\.txt/)).toBeTruthy();
    expect(screen.getByText(/Andrew S\. Fastow · fastow_deposition_excerpt\.txt/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /Open source excerpt/i })[0]);
    expect(onClaimSelect).toHaveBeenCalledWith("doc_a", 10, 25);
  });
});
