"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getGraph,
  getWitnessComparison,
  listDocuments,
  type ClaimCell,
  type ComparisonRow,
  type WitnessComparisonResponse,
} from "@/lib/api";
import type { DocumentSummary, GraphEntity } from "@/lib/types";

interface Props {
  caseId: string;
  refreshToken?: number;
  // Open the source doc and highlight this span.
  onJumpToProvenance?: (docId: string, start: number, end: number) => void;
}

const AGREEMENT_STYLES: Record<ComparisonRow["agreement"], string> = {
  agreement: "border-l-4 border-l-[color:#3f8a5a]",
  conflict: "border-l-4 border-l-[color:var(--accent)]",
  single_source: "border-l-4 border-l-[color:var(--line-strong)]",
};

const AGREEMENT_LABELS: Record<ComparisonRow["agreement"], string> = {
  agreement: "Agree",
  conflict: "Conflict",
  single_source: "Single source",
};

const AGREEMENT_BADGE_STYLES: Record<ComparisonRow["agreement"], string> = {
  agreement: "bg-[#e7f0ea] text-[#2e6a44]",
  conflict: "bg-[#fff3ec] text-[color:var(--accent)]",
  single_source: "bg-[color:var(--bg-soft)] text-[color:var(--muted)]",
};

// Grid that compares what each picked witness said about each topic.
// Rows = topics, columns = witnesses, cells = what they said.
// Green = they agree, orange = they conflict, gray = only one spoke.
export function WitnessComparison({
  caseId,
  refreshToken = 0,
  onJumpToProvenance,
}: Props) {
  const [people, setPeople] = useState<GraphEntity[]>([]);
  const [docsById, setDocsById] = useState<Map<string, DocumentSummary>>(
    () => new Map(),
  );
  // Used to turn entity id values like "person_skilling" into real names.
  const [entityNameById, setEntityNameById] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [graphLoading, setGraphLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<WitnessComparisonResponse | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load people for the picker and docs so we can show filenames.
  useEffect(() => {
    let cancelled = false;
    setGraphLoading(true);
    setError(null);
    Promise.all([getGraph(caseId), listDocuments(caseId)])
      .then(([g, docs]) => {
        if (cancelled) return;
        // Only Person entities can be witnesses.
        const persons = g.entities.filter((e) => e.type === "Person");
        setPeople(persons);
        setDocsById(new Map(docs.map((d) => [d.id, d])));
        setEntityNameById(new Map(g.entities.map((e) => [e.id, e.name])));
        // Pick the first two so the page isn't empty on first load.
        setSelected((current) => {
          if (current.length > 0) return current;
          return persons.slice(0, 2).map((p) => p.id);
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setGraphLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  // Re-fetch the matrix whenever the picked witnesses change.
  useEffect(() => {
    if (selected.length < 2) {
      // Backend needs at least 2, so don't even ask.
      setMatrix(null);
      return;
    }
    let cancelled = false;
    setMatrixLoading(true);
    setError(null);
    getWitnessComparison(caseId, selected)
      .then((m) => {
        if (!cancelled) setMatrix(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setMatrixLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken, selected]);

  const groupedRows = useMemo(() => {
    if (!matrix) return [];
    // Group rows by what the topic is so the matrix reads topic-by-topic.
    const bySubject = new Map<
      string,
      { label: string; rows: ComparisonRow[] }
    >();
    for (const row of matrix.rows) {
      const key = row.subject_entity_id;
      const label = row.subject_label ?? row.subject_entity_id.slice(0, 12);
      const bucket = bySubject.get(key) ?? { label, rows: [] };
      bucket.rows.push(row);
      bySubject.set(key, bucket);
    }
    return Array.from(bySubject.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [matrix]);

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (current.length >= 5) return current; // max 5 witnesses
      return [...current, id];
    });
  }

  if (graphLoading && people.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-5 text-sm text-[color:var(--muted)]">
        Loading witnesses…
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="flex h-full flex-col justify-between p-5">
        <div>
          <div className="panel-title">Compare Witnesses</div>
          <h2 className="mt-2 text-lg font-semibold">No people extracted yet</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-[color:var(--muted)]">
            The witness comparison matrix needs at least two Person entities in
            the case. Upload deposition transcripts or run extraction to
            populate this view.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[color:var(--line)] bg-white/80 px-5 py-4">
        <div className="panel-title">Compare Witnesses</div>
        <h2 className="mt-1 text-xl font-semibold">
          What did each witness say?
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[color:var(--muted)]">
          Pick 2–5 witnesses to see their extracted testimony pivoted into a
          comparison grid. Green rows = witnesses agree. Orange rows = they
          disagree. Neutral = only one witness spoke (you may want to depose
          the others on that topic).
        </p>
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
            Witnesses ({selected.length} selected)
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {people.map((p) => {
              const active = selected.includes(p.id);
              const disabled = !active && selected.length >= 5;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  disabled={disabled}
                  className={
                    "rounded-full border px-3 py-1 text-xs transition-colors " +
                    (active
                      ? "border-[color:var(--text)] bg-[color:var(--text)] text-white"
                      : disabled
                        ? "cursor-not-allowed border-[color:var(--line)] bg-[color:var(--bg-soft)] text-[color:var(--muted)] opacity-60"
                        : "border-[color:var(--line)] bg-white text-[color:var(--text)] hover:bg-white/90")
                  }
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {selected.length < 2 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--line-strong)] bg-[color:var(--bg-soft)] p-4 text-sm text-[color:var(--muted)]">
            Pick at least two witnesses above to build the matrix.
          </div>
        ) : matrixLoading && !matrix ? (
          <div className="text-sm text-[color:var(--muted)]">Building matrix…</div>
        ) : !matrix || matrix.rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--line-strong)] bg-[color:var(--bg-soft)] p-4 text-sm text-[color:var(--muted)]">
            The selected witnesses haven&rsquo;t made overlapping claims yet — there&rsquo;s
            nothing to compare. Try a different combination or upload more
            depositions.
          </div>
        ) : (
          <Matrix
            witnesses={matrix.witnesses}
            groupedRows={groupedRows}
            docsById={docsById}
            entityNameById={entityNameById}
            onJumpToProvenance={onJumpToProvenance}
          />
        )}
      </div>
    </div>
  );
}

// Collapse repeat values from the same witness into one row.
// LLM often extracts the same fact (like "$2.5M") many times.
function dedupeCells(cells: ClaimCell[]): Array<{
  value: string;
  sources: ClaimCell[];
}> {
  const groups = new Map<string, { value: string; sources: ClaimCell[] }>();
  for (const cell of cells) {
    const key = cell.value.trim().toLowerCase().replace(/\s+/g, " ");
    const existing = groups.get(key);
    if (existing) {
      existing.sources.push(cell);
    } else {
      groups.set(key, { value: cell.value, sources: [cell] });
    }
  }
  return Array.from(groups.values());
}

// Turn "wire_transfer_amount" into "Wire transfer amount".
function formatPredicate(p: string): string {
  const spaced = p.replace(/_/g, " ").trim();
  if (!spaced) return p;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// If a predicate matches this, treat plain numbers as dollar amounts.
const MONEY_PREDICATE_RE =
  /payment|amount|wire_transfer|money|paid|cost|price|fee|salary|compensation|transfer/i;

// Make a claim value readable:
//  - entity id -> real name ("person_skilling" -> "Jeffrey K. Skilling")
//  - ISO date -> "March 12, 2001"
//  - plain number + money predicate -> "$2,500,000"
function formatValue(
  value: string,
  predicate: string,
  entityNameById: Map<string, string>,
): string {
  const entityName = entityNameById.get(value);
  if (entityName) return entityName;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  }

  if (
    /^\d{4,}(\.\d+)?$/.test(value) &&
    MONEY_PREDICATE_RE.test(predicate)
  ) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);
    }
  }

  return value;
}

function Matrix({
  witnesses,
  groupedRows,
  docsById,
  entityNameById,
  onJumpToProvenance,
}: {
  witnesses: WitnessComparisonResponse["witnesses"];
  groupedRows: Array<{ label: string; rows: ComparisonRow[] }>;
  docsById: Map<string, DocumentSummary>;
  entityNameById: Map<string, string>;
  onJumpToProvenance?: (docId: string, start: number, end: number) => void;
}) {
  const filenameOf = (docId: string): string =>
    docsById.get(docId)?.filename ?? `${docId.slice(0, 8)}…`;
  return (
    <div className="flex flex-col gap-6">
      {groupedRows.map((group) => (
        <div key={group.label}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
            Topic — {group.label}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-[color:var(--line)] bg-white">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[color:var(--line)] bg-[color:var(--bg-soft)] text-left">
                  <th className="w-56 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--muted)]">
                    Predicate
                  </th>
                  {witnesses.map((w) => (
                    <th
                      key={w.id}
                      className="px-3 py-2 text-xs font-semibold tracking-[0.04em] text-[color:var(--text)]"
                    >
                      {w.name ?? w.id.slice(0, 10)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr
                    key={row.predicate + row.subject_entity_id}
                    className={`border-b border-[color:var(--line)] align-top last:border-b-0 ${AGREEMENT_STYLES[row.agreement]}`}
                  >
                    <td className="px-3 py-2.5">
                      <div
                        className="text-sm text-[color:var(--text)]"
                        title={row.predicate}
                      >
                        {formatPredicate(row.predicate)}
                      </div>
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${AGREEMENT_BADGE_STYLES[row.agreement]}`}
                      >
                        {AGREEMENT_LABELS[row.agreement]}
                      </span>
                    </td>
                    {witnesses.map((w) => {
                      const cells = row.cells[w.id] ?? [];
                      return (
                        <td
                          key={w.id}
                          className="px-3 py-2.5 align-top"
                        >
                          {cells.length === 0 ? (
                            <span className="text-[11px] italic text-[color:var(--muted)]">
                              — not asked —
                            </span>
                          ) : (
                            <ul className="space-y-2">
                              {dedupeCells(cells).map((group, i) => {
                                // Pick one span per source doc so each
                                // filename link below jumps to the right doc.
                                const docSources = new Map<
                                  string,
                                  ClaimCell
                                >();
                                for (const s of group.sources) {
                                  if (!docSources.has(s.source_doc_id)) {
                                    docSources.set(s.source_doc_id, s);
                                  }
                                }
                                const docEntries = Array.from(
                                  docSources.entries(),
                                );
                                const totalMentions = group.sources.length;
                                const displayValue = formatValue(
                                  group.value,
                                  row.predicate,
                                  entityNameById,
                                );
                                return (
                                  <li key={i}>
                                    <div
                                      className="text-sm font-medium text-[color:var(--text)]"
                                      title={
                                        displayValue !== group.value
                                          ? `Raw: ${group.value}`
                                          : undefined
                                      }
                                    >
                                      {displayValue}
                                    </div>
                                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-[11px] text-[color:var(--muted)]">
                                      <span>from</span>
                                      {docEntries.map(
                                        ([docId, cell], idx) => (
                                          <span key={docId}>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onJumpToProvenance?.(
                                                  cell.source_doc_id,
                                                  cell.char_start,
                                                  cell.char_end,
                                                )
                                              }
                                              disabled={!onJumpToProvenance}
                                              className="font-mono text-[color:var(--text)] hover:text-[color:var(--accent)] hover:underline disabled:cursor-default disabled:no-underline"
                                            >
                                              {filenameOf(docId)}
                                            </button>
                                            {idx < docEntries.length - 1 && (
                                              <span className="ml-1">·</span>
                                            )}
                                          </span>
                                        ),
                                      )}
                                      {totalMentions > docEntries.length && (
                                        <span
                                          title={`Same value extracted ${totalMentions} times across these source(s)`}
                                        >
                                          · {totalMentions}× mention
                                          {totalMentions === 1 ? "" : "s"}
                                        </span>
                                      )}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
