"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getGraph,
  listContradictions,
  listDocuments,
  type ContradictionDetail,
} from "@/lib/api";

type SortKey = "rank" | "entity" | "sources";

interface Props {
  caseId: string;
  refreshToken?: number;
  onClaimSelect: (docId: string, start: number, end: number) => void;
}

export function ContradictionsPanel({
  caseId,
  refreshToken = 0,
  onClaimSelect,
}: Props) {
  const [contradictions, setContradictions] = useState<ContradictionDetail[]>([]);
  const [docNames, setDocNames] = useState<Record<string, string>>({});
  const [entityNames, setEntityNames] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rank");

  useEffect(() => {
    let cancelled = false;
    listContradictions(caseId)
      .then((c) => !cancelled && setContradictions(c))
      .catch((e) => !cancelled && setError(String(e)));
    // Resolve human-readable labels for claim cards (filenames, speaker names).
    listDocuments(caseId)
      .then((docs) => {
        if (!cancelled)
          setDocNames(Object.fromEntries(docs.map((d) => [d.id, d.filename])));
      })
      .catch(() => {});
    getGraph(caseId)
      .then((g) => {
        if (!cancelled)
          setEntityNames(Object.fromEntries(g.entities.map((e) => [e.id, e.name])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? contradictions.filter(
          (c) =>
            (c.subject_entity_name ?? c.subject_entity_id).toLowerCase().includes(q) ||
            c.predicate.toLowerCase().includes(q),
        )
      : contradictions;

    return [...filtered].sort((a, b) => {
      if (sortKey === "rank") return b.rank_score - a.rank_score;
      if (sortKey === "entity")
        return (a.subject_entity_name ?? a.subject_entity_id).localeCompare(
          b.subject_entity_name ?? b.subject_entity_id,
        );
      return b.claims.length - a.claims.length;
    });
  }, [contradictions, search, sortKey]);

  if (error) return <div className="p-5 text-sm text-red-600">Error: {error}</div>;
  if (contradictions.length === 0)
    return (
      <div className="flex h-full flex-col justify-between p-5">
        <div>
          <div className="panel-title">Contradictions</div>
          <h2 className="mt-2 text-lg font-semibold">No conflicts detected</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-[color:var(--muted)]">
            Extraction may still be running, or the current corpus may be internally consistent.
            Contradictions appear here ranked by relevance with direct jumps to supporting excerpts.
          </p>
        </div>
        <div className="rounded-2xl border border-dashed border-[color:var(--line-strong)] bg-[color:var(--bg-soft)] p-4 text-sm text-[color:var(--muted)]">
          Best demo setup: combine the memo, emails, and multiple deposition excerpts in one case.
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col overflow-auto bg-[linear-gradient(180deg,rgba(255,253,250,0.95),rgba(248,242,235,0.84))]">
      <div className="border-b border-[color:var(--line)] px-5 py-4">
        <div className="panel-title">Contradictions</div>
        <h2 className="mt-2 text-xl font-semibold">Flagged conflicts across documents</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[color:var(--muted)]">
          Expand a contradiction to compare the competing claims side by side, then jump directly to
          the underlying source text.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="search"
            placeholder="Filter by entity or predicate…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-[color:var(--line)] bg-white px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-[color:var(--muted)]">Sort:</span>
            {(
              [
                { key: "rank", label: "Rank" },
                { key: "entity", label: "Entity" },
                { key: "sources", label: "Sources" },
              ] as { key: SortKey; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                className={
                  "rounded-full border px-3 py-1.5 text-xs transition-colors " +
                  (sortKey === key
                    ? "border-[color:var(--text)] bg-[color:var(--text)] text-white"
                    : "border-[color:var(--line)] bg-white text-[color:var(--muted)] hover:bg-white/80")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {search && (
          <div className="mt-2 text-xs text-[color:var(--muted)]">
            {visible.length} of {contradictions.length} shown
          </div>
        )}
      </div>
      {visible.length === 0 ? (
        <div className="p-5 text-sm text-[color:var(--muted)]">
          No contradictions match &ldquo;{search}&rdquo;.
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--line)]">
          {visible.map((c) => (
            <li key={c.id} className="bg-white/50">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left hover:bg-white/70"
                onClick={() => setExpanded((prev) => (prev === c.id ? null : c.id))}
              >
                <div>
                  <div className="panel-title">Predicate conflict</div>
                  <div className="mt-2 text-base font-semibold">
                    {c.subject_entity_name ?? c.subject_entity_id} &nbsp;·&nbsp; {c.predicate}
                  </div>
                  <div className="mt-2 text-sm text-[color:var(--muted)]">
                    {c.claims.length} conflicting sources · rank {c.rank_score.toFixed(2)}
                  </div>
                </div>
                <span className="rounded-full border border-[color:var(--line)] bg-white px-2 py-1 text-xs text-[color:var(--muted)] shrink-0">
                  {expanded === c.id ? "Hide" : "Open"}
                </span>
              </button>
              {expanded === c.id && (
                <div className="border-t border-[color:var(--line)] bg-[#f8f1e8] p-4">
                  {c.explanation && (
                    <p className="mb-3 rounded-xl border border-[color:var(--line)] bg-white/70 px-4 py-3 text-sm leading-6 text-[color:var(--text)]">
                      {c.explanation}
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {c.claims.map((claim) => (
                      <button
                        key={claim.claim_id}
                        type="button"
                        onClick={() =>
                          onClaimSelect(claim.source_doc_id, claim.char_start, claim.char_end)
                        }
                        className="rounded-2xl border border-[color:var(--line)] bg-white p-4 text-left shadow-sm transition hover:border-[color:var(--accent)] hover:shadow-md"
                      >
                        <div className="panel-title">
                          {claim.speaker_entity_name ?? claim.speaker_entity_id ?? "—"} · {claim.source_doc_id.slice(0, 8)}…
                        </div>
                        <div className="mt-2 font-mono text-sm text-[color:var(--text)]">{claim.value}</div>
                        <div className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
                          …{claim.excerpt.trim()}…
                        </div>
                        <div className="mt-4 text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--accent)]">
                          Open source excerpt
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
