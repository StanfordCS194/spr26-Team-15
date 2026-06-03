"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { createCase, getCase, parseProvenance } from "@/lib/api";
import type { CaseSummary, GraphEntity } from "@/lib/types";
import { ContradictionsPanel } from "@/components/contradictions/ContradictionsPanel";
import { DocPane } from "@/components/document/DocPane";
import { GraphView } from "@/components/graph/GraphView";
import { Timeline } from "@/components/timeline/Timeline";
import { UploadPanel } from "@/components/upload/UploadPanel";

type Tab = "workspace" | "contradictions";

export default function CaseWorkspacePage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;

  const [summary, setSummary] = useState<CaseSummary | null>(null);
  const [tab, setTab] = useState<Tab>("workspace");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<{
    docId: string;
    start: number;
    end: number;
  } | null>(null);
  const [preferredDocId, setPreferredDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);

    (async () => {
      try {
        try {
          const data = await getCase(caseId);
          if (!cancelled) setSummary(data);
          return;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (!message.includes("404")) {
            if (!cancelled) setError(message);
            return;
          }
        }

        try {
          const created = await createCase(caseId);
          if (!cancelled) setSummary(created);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [caseId, refreshKey]);

  const handleEntitySelect = useCallback((id: string, entity: GraphEntity | null) => {
    setSelectedEntityId(id);
    const rawProv = entity?.provenance?.[0];
    if (rawProv) {
      const parsed = parseProvenance(rawProv);
      if (parsed) {
        setPreferredDocId(parsed.docId);
        setHighlight({ docId: parsed.docId, start: parsed.start, end: parsed.end });
      }
    }
  }, []);

  const handleClaimSelect = useCallback((docId: string, start: number, end: number) => {
    setPreferredDocId(docId);
    setHighlight({ docId, start, end });
    setTab("workspace");
  }, []);

  const handleEventSelect = useCallback((event: {
    provenance: string[];
    participant_ids: string[];
  }) => {
    const parsed = event.provenance
      .map((raw) => parseProvenance(raw))
      .find((value): value is NonNullable<ReturnType<typeof parseProvenance>> => value !== null);
    if (parsed) {
      setPreferredDocId(parsed.docId);
      setHighlight({ docId: parsed.docId, start: parsed.start, end: parsed.end });
    }
    if (event.participant_ids[0]) {
      setSelectedEntityId(event.participant_ids[0]);
    }
    setTab("workspace");
  }, []);

  const handleUploadComplete = useCallback((docId: string | null) => {
    setTab("workspace");
    setSelectedEntityId(null);
    setPreferredDocId(docId);
    setHighlight(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleManualDocSelect = useCallback(() => {
    setPreferredDocId(null);
    setHighlight(null);
  }, []);

  if (loading && !summary && !error) {
    return (
      <main className="workspace-shell">
        <div className="workspace-card flex min-h-[calc(100vh-36px)] flex-col items-center justify-center rounded-[28px]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--line-strong)] border-t-[color:var(--accent)]" />
          <p className="mt-4 text-sm text-[color:var(--muted)]">Loading case…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="workspace-shell">
      <div className="workspace-card flex min-h-[calc(100vh-36px)] flex-col overflow-hidden rounded-[28px]">
        <header className="border-b border-[color:var(--line)] bg-[linear-gradient(135deg,rgba(255,250,244,0.98),rgba(247,238,228,0.94))] px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="panel-title">Case Intelligence Workspace</div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {summary?.name ?? `Case ${caseId}`}
                </h1>
                <span className="rounded-full border border-[color:var(--line)] bg-white/80 px-3 py-1 text-xs text-[color:var(--muted)]">
                  Timeline-first review
                </span>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--muted)]">
                Trace events, inspect source documents, and pivot into related people and organizations
                without leaving the case workspace.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm">
              <TabButton active={tab === "workspace"} onClick={() => setTab("workspace")}>
                Workspace
              </TabButton>
              <TabButton active={tab === "contradictions"} onClick={() => setTab("contradictions")}>
                Contradictions {summary ? `(${summary.contradiction_count})` : null}
              </TabButton>
            </nav>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MetricCard label="Documents" value={summary?.document_count ?? 0} tone="sand" />
            <MetricCard label="Entities" value={summary?.entity_count ?? 0} tone="clay" />
            <MetricCard
              label="Contradictions"
              value={summary?.contradiction_count ?? 0}
              tone="forest"
            />
          </div>
        </header>

        <UploadPanel caseId={caseId} onUploaded={handleUploadComplete} />

        {error && (
          <div className="mx-5 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">
            Error: {error}
          </div>
        )}

        <div className="min-h-0 flex-1 p-4 sm:p-5">
          {tab === "workspace" ? (
            <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-rows-[minmax(320px,0.88fr)_minmax(360px,1fr)]">
              <section className="workspace-card-strong min-h-[320px] overflow-hidden rounded-[24px] xl:col-span-2">
                <Timeline
                  caseId={caseId}
                  refreshToken={refreshKey}
                  onEventSelect={handleEventSelect}
                  onParticipantSelect={setSelectedEntityId}
                />
              </section>
              <section className="workspace-card-strong min-h-[320px] overflow-hidden rounded-[24px]">
                <DocPane
                  caseId={caseId}
                  highlight={highlight}
                  preferredDocId={preferredDocId}
                  refreshToken={refreshKey}
                  onManualSelect={handleManualDocSelect}
                />
              </section>
              <section className="workspace-card-strong min-h-[320px] overflow-hidden rounded-[24px]">
                <GraphView
                  caseId={caseId}
                  selectedId={selectedEntityId}
                  refreshToken={refreshKey}
                  onSelect={handleEntitySelect}
                />
              </section>
            </div>
          ) : (
            <section className="workspace-card-strong h-full overflow-hidden rounded-[24px]">
              <ContradictionsPanel
                caseId={caseId}
                refreshToken={refreshKey}
                onClaimSelect={handleClaimSelect}
              />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full border border-[color:var(--line-strong)] bg-[color:var(--text)] px-4 py-2 text-white shadow-sm"
          : "rounded-full border border-[color:var(--line)] bg-white/70 px-4 py-2 text-[color:var(--muted)] hover:bg-white"
      }
    >
      {children}
    </button>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "sand" | "clay" | "forest";
}) {
  const tones = {
    sand: "from-[#fffaf1] to-[#f6ebda] text-[#5b4937]",
    clay: "from-[#fff5ef] to-[#f3dacd] text-[#6d351f]",
    forest: "from-[#eef5f1] to-[#dae8df] text-[#274235]",
  };

  return (
    <div className={`rounded-2xl border border-[color:var(--line)] bg-gradient-to-br px-4 py-3 ${tones[tone]}`}>
      <div className="panel-title">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
