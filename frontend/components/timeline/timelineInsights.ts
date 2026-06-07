import type { ContradictionDetail, TimelineEventRecord } from "@/lib/api";

export type TimelineFilter = "all" | "linked_conflicts" | "multi_source";

export interface ParticipantConflictSummary {
  id: string;
  name: string;
  contradictionCount: number;
}

export interface EventConflictSummary {
  totalLinkedContradictions: number;
  conflictingParticipants: ParticipantConflictSummary[];
}

export type EventConflictIndex = Record<string, EventConflictSummary>;

export function buildEventConflictIndex(
  events: TimelineEventRecord[],
  contradictions: ContradictionDetail[],
): EventConflictIndex {
  const contradictionCounts = new Map<string, number>();

  contradictions.forEach((contradiction) => {
    contradictionCounts.set(
      contradiction.subject_entity_id,
      (contradictionCounts.get(contradiction.subject_entity_id) ?? 0) + 1,
    );
  });

  return Object.fromEntries(
    events.map((event) => {
      const conflictingParticipants = event.participants
        .map((participant) => ({
          id: participant.id,
          name: participant.name,
          contradictionCount: contradictionCounts.get(participant.id) ?? 0,
        }))
        .filter((participant) => participant.contradictionCount > 0);

      return [
        event.id,
        {
          totalLinkedContradictions: conflictingParticipants.reduce(
            (sum, participant) => sum + participant.contradictionCount,
            0,
          ),
          conflictingParticipants,
        },
      ];
    }),
  );
}

export function filterTimelineEvents(
  events: TimelineEventRecord[],
  search: string,
  filter: TimelineFilter,
  conflictIndex: EventConflictIndex,
): TimelineEventRecord[] {
  const query = search.trim().toLowerCase();

  return events.filter((event) => {
    if (query) {
      const matchesSearch =
        event.description.toLowerCase().includes(query) ||
        event.occurred_at.toLowerCase().includes(query) ||
        event.participants.some((participant) => participant.name.toLowerCase().includes(query));

      if (!matchesSearch) return false;
    }

    if (filter === "linked_conflicts") {
      return (conflictIndex[event.id]?.totalLinkedContradictions ?? 0) > 0;
    }

    if (filter === "multi_source") {
      return event.provenance.length > 1;
    }

    return true;
  });
}
