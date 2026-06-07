import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getGraph: vi.fn(),
    getEvents: vi.fn(),
    listContradictions: vi.fn(),
    listDocuments: vi.fn(),
  };
});

import { getEvents, getGraph, listContradictions, listDocuments } from "@/lib/api";
import { EntityProfileDrawer } from "../EntityProfileDrawer";

const mockGraph = {
  entities: [
    {
      id: "ent_smith",
      type: "Person" as const,
      name: "Robert K. Smith",
      mention_texts: ["Robert K. Smith", "Bob Smith"],
      provenance: [
        "doc_a:doc_a:0:10-25",
        "doc_a:doc_a:0:200-215",
        "doc_b:doc_b:0:5-20",
      ],
    },
    {
      id: "ent_fastow",
      type: "Person" as const,
      name: "Andrew S. Fastow",
      mention_texts: ["Andrew S. Fastow"],
      provenance: ["doc_c:doc_c:0:30-50"],
    },
    {
      id: "ent_enron",
      type: "Organization" as const,
      name: "Enron",
      mention_texts: ["Enron"],
      provenance: [],
    },
  ],
  relations: [
    {
      subject_id: "ent_smith",
      object_id: "ent_enron",
      type: "employs" as const,
      qualifiers: {},
      provenance: [],
    },
    {
      subject_id: "ent_fastow",
      object_id: "ent_smith",
      type: "communicated_with" as const,
      qualifiers: {},
      provenance: [],
    },
  ],
};

const mockEvents = [
  {
    id: "ev1",
    description: "Finance committee meeting",
    occurred_at: "2001-03-12",
    participant_ids: ["ent_smith", "ent_fastow"],
    participants: [
      { id: "ent_smith", name: "Robert K. Smith" },
      { id: "ent_fastow", name: "Andrew S. Fastow" },
    ],
    provenance: [],
  },
  {
    id: "ev2",
    description: "Different event without Smith",
    occurred_at: "2001-04-01",
    participant_ids: ["ent_fastow"],
    participants: [{ id: "ent_fastow", name: "Andrew S. Fastow" }],
    provenance: [],
  },
];

const mockContradictions = [
  {
    id: "contra_1",
    subject_entity_id: "ent_smith",
    subject_entity_name: "Robert K. Smith",
    predicate: "attended_meeting_on",
    explanation: "",
    rank_score: 1.5,
    claims: [
      {
        claim_id: "cl1",
        value: "2001-03-12",
        speaker_entity_id: "ent_smith",
        speaker_entity_name: "Robert K. Smith",
        source_doc_id: "doc_a",
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
        source_doc_id: "doc_c",
        chunk_id: "doc_c:0",
        char_start: 30,
        char_end: 50,
        excerpt: "March 15, 2001",
      },
    ],
  },
  {
    id: "contra_2",
    subject_entity_id: "ent_other",
    subject_entity_name: "Other",
    predicate: "received_payment_of",
    explanation: "",
    rank_score: 0.9,
    claims: [
      {
        claim_id: "cl3",
        value: "$1M",
        speaker_entity_id: "ent_fastow",
        speaker_entity_name: "Andrew S. Fastow",
        source_doc_id: "doc_c",
        chunk_id: "doc_c:0",
        char_start: 60,
        char_end: 70,
        excerpt: "one million",
      },
    ],
  },
];

const mockDocuments = [
  {
    id: "doc_a",
    case_id: "demo",
    filename: "smith_deposition.txt",
    mime_type: "text/plain",
    char_length: 500,
    created_at: "2026-04-28",
  },
  {
    id: "doc_b",
    case_id: "demo",
    filename: "email_001.txt",
    mime_type: "text/plain",
    char_length: 300,
    created_at: "2026-04-28",
  },
  {
    id: "doc_c",
    case_id: "demo",
    filename: "fastow_deposition.txt",
    mime_type: "text/plain",
    char_length: 600,
    created_at: "2026-04-28",
  },
];

function renderDrawer(props: Partial<React.ComponentProps<typeof EntityProfileDrawer>> = {}) {
  const defaults = {
    caseId: "demo",
    entityId: "ent_smith",
    onClose: vi.fn(),
    onJumpToProvenance: vi.fn(),
    onEntityNavigate: vi.fn(),
  };
  return {
    ...defaults,
    ...props,
    ...render(<EntityProfileDrawer {...defaults} {...props} />),
  };
}

describe("EntityProfileDrawer", () => {
  beforeEach(() => {
    vi.mocked(getGraph).mockResolvedValue(mockGraph as never);
    vi.mocked(getEvents).mockResolvedValue(mockEvents as never);
    vi.mocked(listContradictions).mockResolvedValue(mockContradictions as never);
    vi.mocked(listDocuments).mockResolvedValue(mockDocuments as never);
  });

  it("renders nothing when entityId is null", () => {
    const { container } = render(
      <EntityProfileDrawer
        caseId="demo"
        entityId={null}
        onClose={() => {}}
        onJumpToProvenance={() => {}}
        onEntityNavigate={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the entity name and type once data loads", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Robert K. Smith");
    expect(dialog.textContent).toContain("Person");
  });

  it("groups mentions by document and labels each by filename", async () => {
    renderDrawer();
    // Smith has 2 mentions in doc_a (smith_deposition.txt) and 1 in doc_b (email_001.txt).
    await screen.findByRole("dialog");
    expect(await screen.findByText("smith_deposition.txt")).toBeTruthy();
    expect(await screen.findByText("email_001.txt")).toBeTruthy();
    expect(screen.queryByText("fastow_deposition.txt")).toBeNull();
  });

  it("lists relations in both directions", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    // outgoing: smith employs Enron
    expect(dialog.textContent).toContain("employs");
    expect(dialog.textContent).toContain("Enron");
    // incoming: Fastow communicated_with smith
    expect(dialog.textContent).toContain("communicated_with");
    expect(dialog.textContent).toContain("Andrew S. Fastow");
  });

  it("only lists events the entity participates in", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Finance committee meeting");
    expect(dialog.textContent).not.toContain("Different event without Smith");
  });

  it("surfaces contradictions where entity is subject OR speaker, ignoring unrelated", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    // contra_1 has ent_smith as subject — should appear
    expect(dialog.textContent).toContain("attended_meeting_on");
    // contra_2 has ent_other subject and ent_fastow speaker; Smith not involved
    expect(dialog.textContent).not.toContain("received_payment_of");
  });

  it("clicking a mention chip calls onJumpToProvenance with the right args", async () => {
    const onJumpToProvenance = vi.fn();
    renderDrawer({ onJumpToProvenance });
    await screen.findByRole("dialog");
    const chip = await screen.findByRole("button", { name: /chars 10–25/ });
    fireEvent.click(chip);
    expect(onJumpToProvenance).toHaveBeenCalledWith("doc_a", 10, 25);
  });

  it("clicking a connected entity calls onEntityNavigate", async () => {
    const onEntityNavigate = vi.fn();
    renderDrawer({ onEntityNavigate });
    await screen.findByRole("dialog");
    const enronBtn = await screen.findByRole("button", { name: /Enron/ });
    fireEvent.click(enronBtn);
    expect(onEntityNavigate).toHaveBeenCalledWith("ent_enron");
  });

  it("clicking the Close button calls onClose", async () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /Close entity profile/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("pressing Escape calls onClose", async () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("flags claims with the minority value as outliers", async () => {
    // contra_1: ent_smith subject. Three claims, but two share "2001-03-12" and
    // one has "2001-03-15". The minority value should be marked data-outlier=true.
    const threeWay = {
      ...mockContradictions[0],
      claims: [
        ...mockContradictions[0].claims,
        {
          claim_id: "cl4",
          value: "2001-03-12",
          speaker_entity_id: "ent_skilling",
          speaker_entity_name: "Jeffrey K. Skilling",
          source_doc_id: "doc_b",
          chunk_id: "doc_b:0",
          char_start: 100,
          char_end: 110,
          excerpt: "March 12 per my calendar",
        },
      ],
    };
    vi.mocked(listContradictions).mockResolvedValueOnce([threeWay] as never);

    renderDrawer();
    await screen.findByRole("dialog");
    // The outlier claim button should carry data-outlier="true".
    const buttons = await screen.findAllByRole("button");
    const claimButtons = buttons.filter((b) => b.dataset.outlier !== undefined);
    const outliers = claimButtons.filter((b) => b.dataset.outlier === "true");
    const majority = claimButtons.filter((b) => b.dataset.outlier === "false");
    expect(outliers.length).toBe(1);
    expect(majority.length).toBe(2);
    expect(outliers[0].textContent).toContain("2001-03-15");
  });

  it("does not flag any outlier when the conflict is a 1-to-1 tie", async () => {
    // mockContradictions[0] has exactly two claims with two distinct values.
    // No clear majority → nothing should be highlighted as outlier.
    renderDrawer();
    await screen.findByRole("dialog");
    const buttons = await screen.findAllByRole("button");
    const claimButtons = buttons.filter((b) => b.dataset.outlier !== undefined);
    const outliers = claimButtons.filter((b) => b.dataset.outlier === "true");
    expect(outliers.length).toBe(0);
  });

  it("shows the conflicting excerpts inline on each claim", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("the meeting was March 12");
    expect(dialog.textContent).toContain("March 15, 2001");
  });
});
