"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { getCase, parseProvenance } from "@/lib/api";
import type { CaseSummary, Entity } from "@/lib/types";
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
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    getCase(caseId).then(setSummary).catch((e) => setError(String(e)));
  }, [caseId, refreshKey]);

  const handleEntitySelect = useCallback((id: string, entity: Entity | null) => {
    setSelectedEntityId(id);
    // If the graph reader returned any provenance strings on the entity, jump to the first one.
    const rawProv = (entity as unknown as { provenance?: string[] } | null)?.provenance?.[0];
    if (rawProv) {
      const parsed = parseProvenance(rawProv);
      if (parsed) setHighlight({ docId: parsed.docId, start: parsed.start, end: parsed.end });
    }
  }, []);

  const handleClaimSelect = useCallback((docId: string, start: number, end: number) => {
    setHighlight({ docId, start, end });
    setTab("workspace");
  }, []);

  const handleEventSelect = useCallback(() => {
    // For v1, selecting an event just switches focus to the workspace; full-grounded jump comes later.
    setTab("workspace");
  }, []);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">{summary?.name ?? `Case ${caseId}`}</h1>
          {summary && (
            <p className="text-xs text-neutral-500">
              {summary.document_count} documents · {summary.entity_count} entities ·{" "}
              {summary.contradiction_count} contradictions
            </p>
          )}
        </div>
        <nav className="flex gap-1 text-xs">
          <TabButton active={tab === "workspace"} onClick={() => setTab("workspace")}>
            Workspace
          </TabButton>
          <TabButton active={tab === "contradictions"} onClick={() => setTab("contradictions")}>
            Contradictions {summary ? `(${summary.contradiction_count})` : null}
          </TabButton>
        </nav>
      </header>

      <UploadPanel caseId={caseId} onUploaded={() => setRefreshKey((k) => k + 1)} />

      {error && <div className="bg-red-50 px-4 py-2 text-sm text-red-600">Error: {error}</div>}

      {tab === "workspace" ? (
        <div className="grid flex-1 grid-cols-[1fr_minmax(320px,420px)] grid-rows-[1fr_220px] overflow-hidden">
          <div className="row-span-1 border-r border-neutral-200">
            <GraphView
              caseId={caseId}
              selectedId={selectedEntityId}
              onSelect={handleEntitySelect}
            />
          </div>
          <div className="row-span-2 border-l border-neutral-200">
            <DocPane caseId={caseId} highlight={highlight} />
          </div>
          <div className="col-start-1 row-start-2 border-t border-neutral-200">
            <Timeline caseId={caseId} onEventSelect={handleEventSelect} />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <ContradictionsPanel caseId={caseId} onClaimSelect={handleClaimSelect} />
        </div>
      )}
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
          ? "rounded-md bg-ink px-3 py-1 text-white"
          : "rounded-md px-3 py-1 text-neutral-600 hover:bg-neutral-100"
      }
    >
      {children}
    </button>
  );
}
