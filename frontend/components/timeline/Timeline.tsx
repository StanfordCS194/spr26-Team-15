"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Timeline as VisTimeline } from "vis-timeline/standalone";
import { DataSet } from "vis-data";

import {
  getEvents,
  listContradictions,
  type ContradictionDetail,
  type TimelineEventRecord,
} from "@/lib/api";
import {
  buildEventConflictIndex,
  filterTimelineEvents,
  type TimelineFilter,
} from "./timelineInsights";

interface Props {
  caseId: string;
  refreshToken?: number;
  onEventSelect: (event: TimelineEventRecord) => void;
  onParticipantSelect: (entityId: string) => void;
  onAnnotateEvent?: (event: { id: string; description: string; occurred_at: string }) => void;
  onConflictFocus?: (participantName: string) => void;
}

export function Timeline({
  caseId,
  refreshToken = 0,
  onEventSelect,
  onParticipantSelect,
  onAnnotateEvent,
  onConflictFocus,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<VisTimeline | null>(null);
  const itemsRef = useRef<DataSet<{ id: string; content: string; start: string }> | null>(null);
  const [events, setEvents] = useState<TimelineEventRecord[]>([]);
  const [contradictions, setContradictions] = useState<ContradictionDetail[]>([]);
  const [search, setSearch] = useState("");
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the select handler reading current events without re-creating the widget.
  const eventsRef = useRef<TimelineEventRecord[]>(events);
  const onEventSelectRef = useRef(onEventSelect);
  useEffect(() => {
    eventsRef.current = events;
    onEventSelectRef.current = onEventSelect;
  }, [events, onEventSelect]);

  useEffect(() => {
    let cancelled = false;
    getEvents(caseId)
      .then((es) => {
        if (!cancelled) {
          setEvents(es);
          setSelectedEventId((current) => current ?? es[0]?.id ?? null);
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    listContradictions(caseId)
      .then((rows) => {
        if (!cancelled) setContradictions(rows);
      })
      .catch(() => {
        if (!cancelled) setContradictions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  const conflictIndex = useMemo(
    () => buildEventConflictIndex(events, contradictions),
    [events, contradictions],
  );

  // Memoized so unrelated re-renders (e.g. selecting an event) don't rebuild the vis-timeline.
  const filteredEvents = useMemo(
    () => filterTimelineEvents(events, search, timelineFilter, conflictIndex),
    [events, search, timelineFilter, conflictIndex],
  );

  useEffect(() => {
    if (filteredEvents.length === 0) {
      setSelectedEventId(null);
      return;
    }

    if (selectedEventId && filteredEvents.some((event) => event.id === selectedEventId)) return;

    const next = filteredEvents[0];
    setSelectedEventId(next.id);
    onEventSelectRef.current(next);
  }, [filteredEvents, selectedEventId]);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    (async () => {
      // Dynamic import so vis-timeline only loads in the browser.
      const { Timeline } = await import("vis-timeline/standalone");
      if (cancelled || !containerRef.current) return;

      const data = filteredEvents.map((e) => ({
        id: e.id,
        content: e.description,
        start: e.occurred_at,
      }));

      // Update the existing widget's dataset in place — no destroy/recreate, so typing in the
      // search box doesn't flicker or drop selection.
      if (timelineRef.current && itemsRef.current) {
        itemsRef.current.clear();
        itemsRef.current.add(data);
        return;
      }

      const items = new DataSet(data);
      itemsRef.current = items;
      timelineRef.current = new Timeline(containerRef.current, items, {
        stack: true,
        zoomable: true,
        selectable: true,
        margin: { item: 8 },
        height: "100%",
      });
      timelineRef.current.on("select", (evt: { items: string[] }) => {
        if (evt.items.length === 0) return;
        const event = eventsRef.current.find((candidate) => candidate.id === evt.items[0]);
        if (!event) return;
        setSelectedEventId(event.id);
        onEventSelectRef.current(event);
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [filteredEvents]);

  // Destroy the widget only on unmount.
  useEffect(() => {
    return () => {
      timelineRef.current?.destroy();
      timelineRef.current = null;
      itemsRef.current = null;
    };
  }, []);

  if (error) return <div className="p-5 text-sm text-red-600">Timeline error: {error}</div>;
  if (events.length === 0)
    return (
      <div className="flex h-full flex-col justify-between p-5">
        <div>
          <div className="panel-title">Timeline</div>
          <h2 className="mt-2 text-lg font-semibold">No extracted events yet</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-[color:var(--muted)]">
            Once the case pipeline extracts dated events, this timeline becomes the primary entry
            point for reviewing what happened, when it happened, and which people or organizations
            were involved.
          </p>
        </div>
        <div className="rounded-2xl border border-dashed border-[color:var(--line-strong)] bg-[color:var(--bg-soft)] p-4 text-sm text-[color:var(--muted)]">
          Tip: use the seeded Enron corpus or a processed case to showcase timeline navigation.
        </div>
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,rgba(255,253,249,0.98),rgba(250,245,239,0.86))]">
      <div className="border-b border-[color:var(--line)] px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="panel-title">Timeline</div>
            <h2 className="mt-2 text-xl font-semibold">Case chronology</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-[color:var(--muted)]">
              Start here to understand the flow of events, then jump into supporting documents or
              related participants.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events, dates, or participants"
              className="min-w-0 flex-1 rounded-xl border border-[color:var(--line)] bg-white px-3 py-2 text-sm"
            />
            <span className="rounded-full border border-[color:var(--line)] bg-white px-3 py-1 text-xs text-[color:var(--muted)]">
              {filteredEvents.length} of {events.length} events
            </span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              { key: "all", label: "All events" },
              { key: "linked_conflicts", label: "Linked conflicts" },
              { key: "multi_source", label: "Multi-source" },
            ] as Array<{ key: TimelineFilter; label: string }>
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTimelineFilter(key)}
              className={
                timelineFilter === key
                  ? "rounded-full border border-[color:var(--text)] bg-[color:var(--text)] px-3 py-1.5 text-xs text-white"
                  : "rounded-full border border-[color:var(--line)] bg-white px-3 py-1.5 text-xs text-[color:var(--muted)] hover:bg-white/80"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[330px_1fr]">
        <div className="overflow-y-auto border-b border-[color:var(--line)] bg-[#f7efe4] xl:border-b-0 xl:border-r">
          {filteredEvents.length === 0 ? (
            <div className="p-5 text-sm text-[color:var(--muted)]">No events match this filter.</div>
          ) : (
            <ul className="divide-y divide-[color:var(--line)]">
              {filteredEvents.map((event) => {
                const selected = event.id === selectedEventId;
                const eventConflictCount = conflictIndex[event.id]?.totalLinkedContradictions ?? 0;
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEventId(event.id);
                        onEventSelect(event);
                      }}
                      className={
                        selected
                          ? "w-full bg-[linear-gradient(135deg,#2d2520,#1f1a16)] px-4 py-4 text-left text-white"
                          : "w-full px-4 py-4 text-left hover:bg-white/70"
                      }
                    >
                      <div className="text-[11px] uppercase tracking-[0.18em] opacity-70">
                        {formatEventDate(event.occurred_at)}
                      </div>
                      <div className="mt-2 text-sm font-medium leading-6">{event.description}</div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {eventConflictCount > 0 && (
                          <span
                            className={
                              selected
                                ? "rounded-full border border-white/20 px-2.5 py-1 text-[11px]"
                                : "rounded-full border border-[#d8a36b] bg-[#fff4e6] px-2.5 py-1 text-[11px] text-[#7f4c12]"
                            }
                          >
                            {eventConflictCount} linked conflict{eventConflictCount === 1 ? "" : "s"}
                          </span>
                        )}
                        {event.provenance.length > 1 && (
                          <span
                            className={
                              selected
                                ? "rounded-full border border-white/20 px-2.5 py-1 text-[11px]"
                                : "rounded-full border border-[color:var(--line)] bg-white px-2.5 py-1 text-[11px] text-[color:var(--muted)]"
                            }
                          >
                            {event.provenance.length} excerpts
                          </span>
                        )}
                      </div>
                      {event.participants.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {event.participants.map((participant) => (
                            <span
                              key={participant.id}
                              className={
                                selected
                                  ? "rounded-full border border-white/20 px-2.5 py-1 text-[11px]"
                                  : "rounded-full border border-[color:var(--line)] bg-white px-2.5 py-1 text-[11px] text-[color:var(--muted)]"
                              }
                            >
                              {participant.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex flex-col">
          <div ref={containerRef} className="h-[420px] overflow-hidden px-3 py-2 sm:px-4" />
          <div className="border-t border-[color:var(--line)] bg-white/85 px-4 py-4">
            {selectedEventId ? (
              (() => {
                const event = events.find((candidate) => candidate.id === selectedEventId);
                if (!event) return null;
                const conflictSummary = conflictIndex[event.id] ?? {
                  totalLinkedContradictions: 0,
                  conflictingParticipants: [],
                };
                return (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="panel-title">Selected Event</div>
                        <div className="mt-2 text-base font-semibold">{event.description}</div>
                        <div className="mt-1 text-sm text-[color:var(--muted)]">
                          {formatEventDate(event.occurred_at)}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--bg-soft)] px-3 py-1.5 text-xs text-[color:var(--muted)]">
                            {event.provenance.length} supporting excerpt
                            {event.provenance.length === 1 ? "" : "s"}
                          </span>
                          {conflictSummary.totalLinkedContradictions > 0 && (
                            <span className="rounded-full border border-[#d8a36b] bg-[#fff4e6] px-3 py-1.5 text-xs text-[#7f4c12]">
                              {conflictSummary.totalLinkedContradictions} linked contradiction
                              {conflictSummary.totalLinkedContradictions === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {event.participants.map((participant) => (
                          <button
                            key={participant.id}
                            type="button"
                            onClick={() => onParticipantSelect(participant.id)}
                            className="rounded-full border border-[color:var(--line)] bg-[color:var(--bg-soft)] px-3 py-1.5 text-xs text-[color:var(--muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                          >
                            {participant.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    {onAnnotateEvent && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onAnnotateEvent({
                              id: event.id,
                              description: event.description,
                              occurred_at: event.occurred_at,
                            })
                          }
                          className="rounded-full border border-[color:var(--line)] bg-white px-3 py-1.5 text-xs text-[color:var(--muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                        >
                          Annotate event
                        </button>
                      </div>
                    )}
                    {conflictSummary.conflictingParticipants.length > 0 && (
                      <div className="rounded-2xl border border-[#edd2b4] bg-[#fff7ee] px-4 py-4">
                        <div className="panel-title">Review Queue</div>
                        <p className="mt-2 text-sm leading-6 text-[#7f4c12]">
                          These participants also appear in ranked contradictions. Use the buttons
                          below to pivot directly into the contradiction queue.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {conflictSummary.conflictingParticipants.map((participant) => (
                            <button
                              key={participant.id}
                              type="button"
                              onClick={() => onConflictFocus?.(participant.name)}
                              className="rounded-full border border-[#d8a36b] bg-white px-3 py-1.5 text-xs text-[#7f4c12] hover:bg-[#fff1df]"
                            >
                              {participant.name} · {participant.contradictionCount} conflict
                              {participant.contradictionCount === 1 ? "" : "s"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div className="text-sm text-[color:var(--muted)]">
                Select an event to inspect its evidence.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatEventDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
