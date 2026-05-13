"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getEvents,
  getGraph,
  listContradictions,
  listDocuments,
  parseProvenance,
  type ContradictionDetail,
} from "@/lib/api";
import type {
  DocumentSummary,
  GraphEntity,
  GraphRelation,
  GraphResponse,
} from "@/lib/types";

interface TimelineEvent {
  id: string;
  description: string;
  occurred_at: string;
  participant_ids: string[];
  participants?: Array<{ id: string; name: string }>;
  provenance?: string[];
}

const TYPE_COLORS: Record<string, string> = {
  Person: "#c65d3a",
  Organization: "#1a5c8a",
  Date: "#4b7c4a",
  Location: "#7a5c9b",
  Money: "#a08a2e",
  Document: "#555555",
  Event: "#b4644d",
};

interface Props {
  caseId: string;
  entityId: string | null;
  refreshToken?: number;
  onClose: () => void;
  onJumpToProvenance: (docId: string, start: number, end: number) => void;
  onEntityNavigate: (entityId: string) => void;
}

interface ParsedMention {
  raw: string;
  docId: string;
  chunkId: string;
  start: number;
  end: number;
}

export function EntityProfileDrawer({
  caseId,
  entityId,
  refreshToken = 0,
  onClose,
  onJumpToProvenance,
  onEntityNavigate,
}: Props) {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [contradictions, setContradictions] = useState<ContradictionDetail[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch the case-wide data whenever the drawer opens for a new entity or refresh.
  // The /graph endpoint only returns entities + relations; events live at /events.
  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getGraph(caseId),
      getEvents(caseId),
      listContradictions(caseId),
      listDocuments(caseId),
    ])
      .then(([g, ev, c, d]) => {
        if (cancelled) return;
        setGraph(g);
        setTimelineEvents(ev);
        setContradictions(c);
        setDocuments(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, entityId, refreshToken]);

  // Close on Escape — only while a drawer is open.
  useEffect(() => {
    if (!entityId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [entityId, onClose]);

  const entity = useMemo<GraphEntity | null>(() => {
    if (!graph || !entityId) return null;
    return graph.entities.find((e) => e.id === entityId) ?? null;
  }, [graph, entityId]);

  const docsById = useMemo(() => {
    return new Map(documents.map((d) => [d.id, d]));
  }, [documents]);

  const entitiesById = useMemo(() => {
    if (!graph) return new Map<string, GraphEntity>();
    return new Map(graph.entities.map((e) => [e.id, e]));
  }, [graph]);

  // Parse the entity's provenance[] strings and group them by source doc.
  const mentionsByDoc = useMemo<Map<string, ParsedMention[]>>(() => {
    const map = new Map<string, ParsedMention[]>();
    if (!entity) return map;
    for (const raw of entity.provenance) {
      const parsed = parseProvenance(raw);
      if (!parsed) continue;
      const mention: ParsedMention = { raw, ...parsed };
      const existing = map.get(parsed.docId) ?? [];
      existing.push(mention);
      map.set(parsed.docId, existing);
    }
    return map;
  }, [entity]);

  // Relations involving the entity (either side).
  const relations = useMemo<GraphRelation[]>(() => {
    if (!entity || !graph) return [];
    return graph.relations.filter(
      (r) => r.subject_id === entity.id || r.object_id === entity.id,
    );
  }, [entity, graph]);

  // Events the entity participated in.
  const events = useMemo<TimelineEvent[]>(() => {
    if (!entity) return [];
    return timelineEvents.filter((ev) =>
      ev.participant_ids.includes(entity.id),
    );
  }, [entity, timelineEvents]);

  // Contradictions where this entity is the subject OR a speaker in any conflicting claim.
  const involvedContradictions = useMemo<ContradictionDetail[]>(() => {
    if (!entity) return [];
    return contradictions.filter(
      (c) =>
        c.subject_entity_id === entity.id ||
        c.claims.some((cl) => cl.speaker_entity_id === entity.id),
    );
  }, [entity, contradictions]);

  if (!entityId) return null;

  const color = entity ? TYPE_COLORS[entity.type] ?? "#333" : "#333";

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
        data-testid="entity-drawer-backdrop"
      />
      <aside
        role="dialog"
        aria-label={entity ? `Entity profile for ${entity.name}` : "Entity profile"}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col overflow-hidden border-l-4 bg-[linear-gradient(180deg,rgba(255,253,250,0.99),rgba(248,242,235,0.94))] shadow-2xl"
        style={{ borderLeftColor: color }}
      >
        <header className="border-b border-[color:var(--line)] bg-white/80 px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              {entity?.type ?? "Entity"}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close entity profile"
              className="rounded-full border border-[color:var(--line)] bg-white px-3 py-1 text-xs text-[color:var(--muted)] hover:bg-neutral-50"
            >
              Close
            </button>
          </div>
          <h2 className="mt-3 truncate text-2xl font-bold tracking-tight">
            {entity?.name ?? (loading ? "Loading…" : "Entity not found")}
          </h2>
          {entity && (
            <div className="mt-2 text-sm text-[color:var(--muted)]">
              {entity.mention_texts.length} mention
              {entity.mention_texts.length === 1 ? "" : "s"} across{" "}
              {mentionsByDoc.size} document{mentionsByDoc.size === 1 ? "" : "s"}
            </div>
          )}
        </header>

        {error && (
          <div className="mx-5 mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!entity && !loading && !error && (
            <div className="rounded-2xl border border-dashed border-[color:var(--line)] bg-white/70 p-4 text-sm text-[color:var(--muted)]">
              This entity ID could not be found in the current case graph. It may have been
              removed during a recent re-extraction.
            </div>
          )}

          {entity && (
            <div className="flex flex-col gap-5">
              {entity.mention_texts.length > 1 && (
                <Section title="Aliases" accentColor={color}>
                  <ul className="flex flex-wrap gap-1.5">
                    {entity.mention_texts.map((m, i) => (
                      <li
                        key={`${m}-${i}`}
                        className="rounded-full border border-[color:var(--line)] bg-white/80 px-2.5 py-1 text-xs text-[color:var(--text)]"
                      >
                        {m}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-[color:var(--muted)]">
                    Different ways this entity is referred to across documents. The resolver
                    merged them into one node.
                  </p>
                </Section>
              )}

              <Section title={`Mentions across documents (${mentionsByDoc.size})`} accentColor={color}>
                {mentionsByDoc.size === 0 ? (
                  <EmptyLine>No grounded mentions on this entity yet.</EmptyLine>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {Array.from(mentionsByDoc.entries()).map(([docId, mentions]) => {
                      const doc = docsById.get(docId);
                      return (
                        <li
                          key={docId}
                          className="rounded-2xl border border-[color:var(--line)] bg-white/80 p-3"
                        >
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <div className="min-w-0 truncate font-medium">
                              {doc?.filename ?? docId.slice(0, 12)}
                            </div>
                            <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--bg-soft)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
                              {mentions.length} mention{mentions.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {mentions.map((m, i) => (
                              <button
                                key={`${m.raw}-${i}`}
                                type="button"
                                onClick={() => onJumpToProvenance(m.docId, m.start, m.end)}
                                className="rounded-full border border-[color:var(--line)] bg-white px-2 py-1 text-xs text-[color:var(--muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                              >
                                chars {m.start}–{m.end}
                              </button>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>

              {relations.length > 0 && (
                <Section title={`Relations (${relations.length})`} accentColor={color}>
                  <ul className="flex flex-col gap-2">
                    {relations.map((r, i) => {
                      const isSubject = r.subject_id === entity.id;
                      const otherId = isSubject ? r.object_id : r.subject_id;
                      const other = entitiesById.get(otherId);
                      const otherName = other?.name ?? otherId.slice(0, 12);
                      const phrase = describeRelation(r.type, isSubject);
                      const [prefix, suffix] = phrase.split("{other}");
                      return (
                        <li
                          key={`${r.subject_id}-${r.type}-${r.object_id}-${i}`}
                          className="rounded-2xl border border-[color:var(--line)] bg-white/80 p-3 text-sm"
                        >
                          <div className="text-[color:var(--text)]">
                            {prefix}
                            <button
                              type="button"
                              onClick={() => onEntityNavigate(otherId)}
                              disabled={!other}
                              className="font-semibold underline-offset-2 hover:text-[color:var(--accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {otherName}
                            </button>
                            {other && (
                              <span className="ml-1 text-xs text-[color:var(--muted)]">
                                ({other.type})
                              </span>
                            )}
                            {suffix}
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-[color:var(--muted)]">
                            {r.type}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {events.length > 0 && (
                <Section title={`Events (${events.length})`} accentColor={color}>
                  <ul className="flex flex-col gap-2">
                    {events.map((ev) => (
                      <li
                        key={ev.id}
                        className="rounded-2xl border border-[color:var(--line)] bg-white/80 p-3 text-sm"
                      >
                        <div className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted)]">
                          {ev.occurred_at}
                        </div>
                        <div className="mt-1 font-medium">{ev.description}</div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {involvedContradictions.length > 0 && (
                <Section title={`Contradictions involving this entity (${involvedContradictions.length})`} accentColor={color}>
                  <ul className="flex flex-col gap-2">
                    {involvedContradictions.map((c) => {
                      const summary = summarizeContradiction(c);
                      return (
                        <li
                          key={c.id}
                          className="rounded-2xl border border-[color:var(--line)] bg-white/80 p-3 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs text-[color:var(--muted)]">
                            <span className="font-mono">{c.predicate}</span>
                            <span title="Higher rank = more cross-source disagreement and higher-confidence signals">
                              rank {c.rank_score.toFixed(2)}
                            </span>
                          </div>
                          {summary.majorityValue !== null && (
                            <div className="mt-2 rounded-xl bg-[color:var(--bg-soft)] px-3 py-1.5 text-xs text-[color:var(--muted)]">
                              <span className="font-medium text-[color:var(--text)]">
                                {summary.majorityCount}
                              </span>{" "}
                              source{summary.majorityCount === 1 ? "" : "s"} agree on{" "}
                              <span className="font-mono text-[color:var(--text)]">
                                {summary.majorityValue}
                              </span>
                              ;{" "}
                              <span className="font-medium text-[color:var(--accent)]">
                                {summary.outlierCount}
                              </span>{" "}
                              disagree
                            </div>
                          )}
                          <ul className="mt-2 flex flex-col gap-1">
                            {c.claims.map((cl) => {
                              const outlier = summary.outlierValues.has(cl.value);
                              return (
                                <li key={cl.claim_id}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onJumpToProvenance(
                                        cl.source_doc_id,
                                        cl.char_start,
                                        cl.char_end,
                                      )
                                    }
                                    data-outlier={outlier ? "true" : "false"}
                                    className={
                                      "block w-full rounded-xl border px-3 py-2 text-left text-xs transition-colors hover:border-[color:var(--accent)] " +
                                      (outlier
                                        ? "border-[color:var(--accent)] bg-[#fff3ec]"
                                        : "border-[color:var(--line)] bg-white")
                                    }
                                  >
                                    <div className="flex items-baseline gap-2">
                                      <span
                                        className={
                                          outlier
                                            ? "font-mono font-semibold text-[color:var(--accent)]"
                                            : "font-mono text-[color:var(--text)]"
                                        }
                                      >
                                        {cl.value}
                                      </span>
                                      <span className="text-[color:var(--muted)]">
                                        ({docsById.get(cl.source_doc_id)?.filename ??
                                          cl.source_doc_id.slice(0, 8)})
                                      </span>
                                    </div>
                                    {cl.excerpt && (
                                      <div className="mt-1 text-[color:var(--muted)]">
                                        …{cl.excerpt.trim()}…
                                      </div>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/**
 * Build a natural-language phrase describing a relation from the perspective of the
 * currently-focused entity. The other end of the relation is left as a placeholder
 * "{other}" so the caller can substitute a clickable button.
 *
 * Example: viewing Raptor II's profile, a `signed` relation where Smith is the subject
 * reads "Signed by {other}" (incoming voice). The same `signed` relation viewed from
 * Smith's profile reads "Signed {other}" (active voice).
 */
function describeRelation(relationType: string, isSubject: boolean): string {
  const t = relationType.toLowerCase();
  if (isSubject) {
    switch (t) {
      case "employs":           return "Employs {other}";
      case "party_to":          return "Party to {other}";
      case "communicated_with": return "Communicated with {other}";
      case "paid":              return "Paid {other}";
      case "signed":            return "Signed {other}";
      case "attended":          return "Attended {other}";
      case "alleged":           return "Alleged claims about {other}";
      case "sourced_from":      return "Sourced from {other}";
      case "occurred_on":       return "Occurred on {other}";
      case "located_at":        return "Located at {other}";
      default:                  return `${t} {other}`;
    }
  }
  // Incoming — this entity is the object of the relation.
  switch (t) {
    case "employs":           return "Employed by {other}";
    case "party_to":          return "Has {other} as counter-party";
    case "communicated_with": return "Contacted by {other}";
    case "paid":              return "Paid by {other}";
    case "signed":            return "Signed by {other}";
    case "attended":          return "Attended by {other}";
    case "alleged":           return "Alleged by {other}";
    case "sourced_from":      return "Source for {other}";
    case "occurred_on":       return "Date of {other}";
    case "located_at":        return "Location of {other}";
    default:                  return `{other} ${t} this`;
  }
}

/**
 * Group a contradiction's claims by value and identify the outlier(s).
 *
 * If one value has more sources than any other ("clear majority"), the rest are flagged
 * as outliers. If counts are tied at the top (e.g. two claims each), no outlier is marked
 * — the conflict is genuinely two-sided and shouldn't visually pick a winner.
 */
function summarizeContradiction(c: ContradictionDetail): {
  majorityValue: string | null;
  majorityCount: number;
  outlierValues: Set<string>;
  outlierCount: number;
} {
  const valueCounts = new Map<string, number>();
  for (const claim of c.claims) {
    valueCounts.set(claim.value, (valueCounts.get(claim.value) ?? 0) + 1);
  }
  if (valueCounts.size === 0) {
    return { majorityValue: null, majorityCount: 0, outlierValues: new Set(), outlierCount: 0 };
  }
  const maxCount = Math.max(...valueCounts.values());
  const topValues = [...valueCounts.entries()].filter(([, n]) => n === maxCount);
  if (topValues.length !== 1 || maxCount < 2) {
    return { majorityValue: null, majorityCount: 0, outlierValues: new Set(), outlierCount: 0 };
  }
  const [majorityValue] = topValues[0];
  const outlierValues = new Set<string>();
  let outlierCount = 0;
  for (const [value, count] of valueCounts) {
    if (value !== majorityValue) {
      outlierValues.add(value);
      outlierCount += count;
    }
  }
  return { majorityValue, majorityCount: maxCount, outlierValues, outlierCount };
}

function Section({
  title,
  accentColor = "var(--accent)",
  children,
}: {
  title: string;
  accentColor?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-4 w-1 rounded-full"
          style={{ backgroundColor: accentColor }}
        />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text)]">
          {title}
        </h3>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[color:var(--line)] bg-white/70 p-3 text-xs text-[color:var(--muted)]">
      {children}
    </div>
  );
}
