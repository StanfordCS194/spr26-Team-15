"use client";

import { useEffect, useRef, useState } from "react";
import type { Timeline as VisTimeline } from "vis-timeline/standalone";
import { DataSet } from "vis-data";

import { getEvents } from "@/lib/api";

interface TimelineEvent {
  id: string;
  description: string;
  occurred_at: string;
  participant_ids: string[];
}

interface Props {
  caseId: string;
  onEventSelect: (eventId: string) => void;
}

export function Timeline({ caseId, onEventSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<VisTimeline | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEvents(caseId)
      .then((es) => {
        if (!cancelled) {
          setEvents(
            es.map((e) => ({
              id: e.id,
              description: e.description,
              occurred_at: e.occurred_at,
              participant_ids: e.participant_ids,
            })),
          );
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  useEffect(() => {
    if (!containerRef.current || events.length === 0) return;

    let cancelled = false;
    (async () => {
      // Dynamic import so vis-timeline only loads in the browser.
      const { Timeline } = await import("vis-timeline/standalone");
      if (cancelled || !containerRef.current) return;

      const items = new DataSet(
        events.map((e) => ({
          id: e.id,
          content: e.description,
          start: e.occurred_at,
        })),
      );

      timelineRef.current?.destroy();
      timelineRef.current = new Timeline(containerRef.current, items, {
        stack: true,
        zoomable: true,
        selectable: true,
        margin: { item: 8 },
      });
      timelineRef.current.on("select", (evt: { items: string[] }) => {
        if (evt.items.length > 0) onEventSelect(evt.items[0]);
      });
    })();

    return () => {
      cancelled = true;
      timelineRef.current?.destroy();
      timelineRef.current = null;
    };
  }, [events, onEventSelect]);

  if (error) return <div className="p-4 text-sm text-red-600">Timeline error: {error}</div>;
  if (events.length === 0)
    return <div className="p-4 text-sm text-neutral-500">No events yet.</div>;

  return <div ref={containerRef} className="h-full w-full bg-white" />;
}
