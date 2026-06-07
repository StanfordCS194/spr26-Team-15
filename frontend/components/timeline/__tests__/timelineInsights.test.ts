import { describe, expect, it } from "vitest";

import type { ContradictionDetail, TimelineEventRecord } from "@/lib/api";
import {
  buildEventConflictIndex,
  filterTimelineEvents,
} from "../timelineInsights";

const events: TimelineEventRecord[] = [
  {
    id: "event-1",
    description: "Board approves compensation plan",
    occurred_at: "2001-08-14",
    participant_ids: ["e-1", "e-2"],
    participants: [
      { id: "e-1", name: "Kenneth Lay" },
      { id: "e-2", name: "Enron Corp." },
    ],
    provenance: ["doc-1:chunk-1:10-20", "doc-2:chunk-1:30-50"],
  },
  {
    id: "event-2",
    description: "Press release goes out",
    occurred_at: "2001-08-15",
    participant_ids: ["e-4"],
    participants: [{ id: "e-4", name: "Jeff Skilling" }],
    provenance: ["doc-3:chunk-1:12-22"],
  },
];

const contradictions: ContradictionDetail[] = [
  {
    id: "c-1",
    subject_entity_id: "e-1",
    subject_entity_name: "Kenneth Lay",
    predicate: "role",
    explanation: "Conflicting titles across sources.",
    rank_score: 0.8,
    claims: [],
  },
  {
    id: "c-2",
    subject_entity_id: "e-1",
    subject_entity_name: "Kenneth Lay",
    predicate: "statement",
    explanation: "Different accounts of the approval.",
    rank_score: 0.7,
    claims: [],
  },
];

describe("buildEventConflictIndex", () => {
  it("maps participant-linked contradictions back onto events", () => {
    const index = buildEventConflictIndex(events, contradictions);

    expect(index["event-1"].totalLinkedContradictions).toBe(2);
    expect(index["event-1"].conflictingParticipants).toEqual([
      {
        id: "e-1",
        name: "Kenneth Lay",
        contradictionCount: 2,
      },
    ]);
    expect(index["event-2"].totalLinkedContradictions).toBe(0);
  });
});

describe("filterTimelineEvents", () => {
  it("filters for contradiction-linked events", () => {
    const conflictIndex = buildEventConflictIndex(events, contradictions);

    expect(filterTimelineEvents(events, "", "linked_conflicts", conflictIndex)).toEqual([
      events[0],
    ]);
  });

  it("filters for multi-source events and search text together", () => {
    const conflictIndex = buildEventConflictIndex(events, contradictions);

    expect(filterTimelineEvents(events, "board", "multi_source", conflictIndex)).toEqual([
      events[0],
    ]);
    expect(filterTimelineEvents(events, "press", "multi_source", conflictIndex)).toEqual([]);
  });
});
