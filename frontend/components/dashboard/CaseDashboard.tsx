"use client";

import { useEffect, useMemo, useState } from "react";

import { getCaseDashboard, type CaseDashboard as CaseDashboardData } from "@/lib/api";

interface Props {
  caseId: string;
  refreshToken?: number;
  onOpenWorkspace: () => void;
  onOpenContradictions: () => void;
  onOpenDocument: (docId: string) => void;
}

export function CaseDashboard({
  caseId,
  refreshToken = 0,
  onOpenWorkspace,
  onOpenContradictions,
  onOpenDocument,
}: Props) {
  const [dashboard, setDashboard] = useState<CaseDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    getCaseDashboard(caseId)
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  const topEntityLabel = useMemo(() => {
    if (!dashboard?.entity_breakdown.length) return "No entity mix yet";
    const leader = dashboard.entity_breakdown[0];
    return `${leader.type} leads the graph`;
  }, [dashboard]);

  if (error) {
    return <div className="p-5 text-sm text-red-600">Dashboard error: {error}</div>;
  }

  if (!dashboard) {
    return <div className="p-5 text-sm text-[color:var(--muted)]">Loading overview…</div>;
  }

  return (
    <div className="grid gap-4">
      <section className="workspace-card-strong rounded-[24px] overflow-hidden">
        <div className="bg-[linear-gradient(135deg,rgba(255,250,244,0.98),rgba(247,238,228,0.94))] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="panel-title">Case Dashboard</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                Start with the case overview, then drop into the timeline.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--muted)]">
                This overview highlights the evidence volume, the case chronology, and the highest
                risk contradictions so you can orient yourself before reviewing source documents.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenWorkspace}
                className="rounded-full border border-[color:var(--text)] bg-[color:var(--text)] px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Open timeline workspace
              </button>
              <button
                type="button"
                onClick={onOpenContradictions}
                className="rounded-full border border-[color:var(--line-strong)] bg-white/80 px-4 py-2 text-sm text-[color:var(--text)] hover:bg-white"
              >
                Review contradictions
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-[color:var(--muted)]">
            <span className="rounded-full border border-[color:var(--line)] bg-white/75 px-3 py-1">
              {formatDateRange(dashboard.date_range.start, dashboard.date_range.end)}
            </span>
            <span className="rounded-full border border-[color:var(--line)] bg-white/75 px-3 py-1">
              {topEntityLabel}
            </span>
          </div>
        </div>
        <div className="grid gap-3 border-t border-[color:var(--line)] bg-white/80 px-5 py-5 sm:grid-cols-2 xl:grid-cols-4 sm:px-6">
          <MetricCard
            label="Documents"
            value={dashboard.summary.document_count}
            tone="sand"
            caption="Uploaded source files"
          />
          <MetricCard
            label="Entities"
            value={dashboard.summary.entity_count}
            tone="clay"
            caption="Resolved people, orgs, dates"
          />
          <MetricCard
            label="Contradictions"
            value={dashboard.summary.contradiction_count}
            tone="forest"
            caption="Ranked conflicts to review"
          />
          <MetricCard
            label="Timeline Events"
            value={dashboard.event_count}
            tone="ink"
            caption="Chronological checkpoints"
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="workspace-card-strong rounded-[24px] overflow-hidden">
          <SectionHeader
            title="Timeline Highlights"
            subtitle="The first and latest checkpoints that frame the story of the case."
            actionLabel="Open workspace"
            onAction={onOpenWorkspace}
          />
          <div className="divide-y divide-[color:var(--line)] bg-white/60">
            {dashboard.timeline_highlights.length === 0 ? (
              <EmptyState copy="No extracted events yet. Upload or seed more material to build the chronology." />
            ) : (
              dashboard.timeline_highlights.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={onOpenWorkspace}
                  className="w-full px-5 py-4 text-left transition hover:bg-white/80"
                >
                  <div className="panel-title">{formatDate(event.occurred_at)}</div>
                  <div className="mt-2 text-sm font-medium leading-6 text-[color:var(--text)]">
                    {event.description}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {event.participants.slice(0, 4).map((participant) => (
                      <span
                        key={`${event.id}-${participant}`}
                        className="rounded-full border border-[color:var(--line)] bg-[#fbf6ef] px-2.5 py-1 text-[11px] text-[color:var(--muted)]"
                      >
                        {participant}
                      </span>
                    ))}
                    <span className="rounded-full border border-[color:var(--line)] bg-white px-2.5 py-1 text-[11px] text-[color:var(--muted)]">
                      {event.participant_count} participants
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="workspace-card-strong rounded-[24px] overflow-hidden">
          <SectionHeader
            title="Contradiction Hotspots"
            subtitle="Highest-ranked conflicts to investigate before drafting strategy."
            actionLabel="Open contradictions"
            onAction={onOpenContradictions}
          />
          <div className="divide-y divide-[color:var(--line)] bg-white/60">
            {dashboard.top_contradictions.length === 0 ? (
              <EmptyState copy="No contradictions are currently ranked for this case." />
            ) : (
              dashboard.top_contradictions.map((contradiction) => (
                <button
                  key={contradiction.id}
                  type="button"
                  onClick={onOpenContradictions}
                  className="w-full px-5 py-4 text-left transition hover:bg-white/80"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="panel-title">Rank {contradiction.rank_score.toFixed(2)}</div>
                      <div className="mt-2 text-sm font-medium text-[color:var(--text)]">
                        {contradiction.subject_entity_name ?? contradiction.subject_entity_id}
                        {" · "}
                        {contradiction.predicate}
                      </div>
                    </div>
                    <span className="rounded-full border border-[color:var(--line)] bg-white px-2.5 py-1 text-[11px] text-[color:var(--muted)]">
                      {contradiction.claim_count} claims
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[color:var(--muted)] line-clamp-3">
                    {contradiction.explanation || "Conflicting claims are available for review."}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <section className="workspace-card-strong rounded-[24px] overflow-hidden">
          <SectionHeader
            title="Recent Documents"
            subtitle="The latest source files added to the case workspace."
          />
          <div className="divide-y divide-[color:var(--line)] bg-white/60">
            {dashboard.recent_documents.length === 0 ? (
              <EmptyState copy="No source documents have been uploaded yet." />
            ) : (
              dashboard.recent_documents.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onOpenDocument(doc.id)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/80"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[color:var(--text)] truncate">
                      {doc.filename}
                    </div>
                    <div className="mt-1 text-xs text-[color:var(--muted)]">
                      {doc.mime_type} · {doc.char_length.toLocaleString()} chars
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-[color:var(--line)] bg-white px-2.5 py-1 text-[11px] text-[color:var(--muted)]">
                    Open doc
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="workspace-card-strong rounded-[24px] overflow-hidden">
          <SectionHeader
            title="Entity Mix"
            subtitle="How the extracted graph is distributed across entity types."
          />
          <div className="grid gap-3 bg-white/60 px-5 py-5 sm:grid-cols-2">
            {dashboard.entity_breakdown.length === 0 ? (
              <div className="sm:col-span-2">
                <EmptyState copy="Entity resolution has not produced a graph yet." />
              </div>
            ) : (
              dashboard.entity_breakdown.map((entityGroup) => (
                <div
                  key={entityGroup.type}
                  className="rounded-2xl border border-[color:var(--line)] bg-white px-4 py-4"
                >
                  <div className="panel-title">{entityGroup.type}</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight">
                    {entityGroup.count}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="border-b border-[color:var(--line)] bg-[linear-gradient(180deg,rgba(255,254,252,0.92),rgba(249,243,236,0.72))] px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="panel-title">{title}</div>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[color:var(--muted)]">{subtitle}</p>
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="shrink-0 rounded-full border border-[color:var(--line)] bg-white px-3 py-1.5 text-xs text-[color:var(--muted)] hover:bg-white/80"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  caption,
}: {
  label: string;
  value: number;
  tone: "sand" | "clay" | "forest" | "ink";
  caption: string;
}) {
  const tones = {
    sand: "from-[#fffaf1] to-[#f6ebda] text-[#5b4937]",
    clay: "from-[#fff5ef] to-[#f3dacd] text-[#6d351f]",
    forest: "from-[#eef5f1] to-[#dae8df] text-[#274235]",
    ink: "from-[#f4f3f8] to-[#e3e0ee] text-[#342c4e]",
  };

  return (
    <div
      className={`rounded-2xl border border-[color:var(--line)] bg-gradient-to-br px-4 py-4 ${tones[tone]}`}
    >
      <div className="panel-title">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-xs leading-5 opacity-75">{caption}</div>
    </div>
  );
}

function EmptyState({ copy }: { copy: string }) {
  return <div className="px-5 py-5 text-sm leading-6 text-[color:var(--muted)]">{copy}</div>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "No event dates extracted yet";
  if (start && end) {
    return `${formatDate(start)} to ${formatDate(end)}`;
  }
  return formatDate(start ?? end ?? "");
}
