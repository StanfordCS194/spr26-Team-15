"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  createAnnotation,
  deleteAnnotation,
  getEvents,
  listAnnotations,
  listContradictions,
  listDocuments,
  parseProvenance,
  type ContradictionDetail,
  type AnnotationRecord,
  type AnnotationTargetType,
  type TimelineEventRecord,
} from "@/lib/api";
import type { DocumentSummary } from "@/lib/types";

const AUTHOR_STORAGE_KEY = "annotation-author";

type AnnotationFilter = "all" | AnnotationTargetType;

export interface AnnotationDraftTarget {
  targetType: AnnotationTargetType;
  targetId: string;
  targetLabel: string;
  suggestedTag?: string;
  suggestedTitle?: string;
}

interface Props {
  caseId: string;
  caseLabel: string;
  draftTarget: AnnotationDraftTarget | null;
  refreshToken?: number;
  onOpenDocument?: (docId: string) => void;
  onOpenEvidence?: (docId: string, start: number, end: number) => void;
}

interface FormState {
  author: string;
  targetType: AnnotationTargetType;
  targetId: string;
  targetLabel: string;
  tag: string;
  title: string;
  body: string;
}

interface EvidenceLink {
  id: string;
  docId: string;
  filename: string;
  label: string;
  detail: string;
  start: number | null;
  end: number | null;
}

export function AnnotationsBoard({
  caseId,
  caseLabel,
  draftTarget,
  refreshToken = 0,
  onOpenDocument,
  onOpenEvidence,
}: Props) {
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [events, setEvents] = useState<TimelineEventRecord[]>([]);
  const [contradictions, setContradictions] = useState<ContradictionDetail[]>([]);
  const [filter, setFilter] = useState<AnnotationFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    createInitialForm(caseId, caseLabel, draftTarget),
  );

  useEffect(() => {
    const savedAuthor = window.localStorage.getItem(AUTHOR_STORAGE_KEY);
    if (!savedAuthor) return;
    setForm((current) => (current.author ? current : { ...current, author: savedAuthor }));
  }, []);

  useEffect(() => {
    const author = form.author.trim();
    if (!author) return;
    window.localStorage.setItem(AUTHOR_STORAGE_KEY, author);
  }, [form.author]);

  useEffect(() => {
    const target = draftTarget ?? createCaseDraft(caseId, caseLabel);
    setForm((current) => ({
      ...current,
      targetType: target.targetType,
      targetId: target.targetId,
      targetLabel: target.targetLabel,
      tag: current.tag || target.suggestedTag || "",
      title: current.title || target.suggestedTitle || "",
    }));
  }, [caseId, caseLabel, draftTarget]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      listAnnotations(caseId),
      listDocuments(caseId).catch(() => [] as DocumentSummary[]),
      getEvents(caseId).catch(() => [] as TimelineEventRecord[]),
      listContradictions(caseId).catch(() => [] as ContradictionDetail[]),
    ])
      .then(([rows, docs, eventRows, contradictionRows]) => {
        if (cancelled) return;
        setAnnotations(rows);
        setDocuments(docs);
        setEvents(eventRows);
        setContradictions(contradictionRows);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  const documentById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  );
  const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const contradictionById = useMemo(
    () => new Map(contradictions.map((contradiction) => [contradiction.id, contradiction])),
    [contradictions],
  );

  const visibleAnnotations = useMemo(() => {
    const query = search.trim().toLowerCase();

    return annotations.filter((annotation) => {
      if (filter !== "all" && annotation.target_type !== filter) return false;
      if (!query) return true;

      const haystack = [
        annotation.target_label,
        annotation.title,
        annotation.body,
        annotation.tag,
        annotation.author,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [annotations, filter, search]);

  const draftEvidence = useMemo(() => {
    const target = draftTarget ?? createCaseDraft(caseId, caseLabel);
    return resolveEvidenceLinks(target.targetType, target.targetId, {
      documentById,
      eventById,
      contradictionById,
    });
  }, [caseId, caseLabel, contradictionById, documentById, draftTarget, eventById]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const author = form.author.trim();
    const body = form.body.trim();
    const tag = form.tag.trim();
    const title = form.title.trim();

    if (!author || !body) {
      setError("Author and note text are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const created = await createAnnotation(caseId, {
        target_type: form.targetType,
        target_id: form.targetId,
        target_label: form.targetLabel,
        tag,
        title,
        body,
        author,
      });

      setAnnotations((current) => [created, ...current]);
      setForm((current) => ({
        ...current,
        author,
        tag,
        title: "",
        body: "",
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(annotationId: string) {
    setError(null);

    try {
      await deleteAnnotation(caseId, annotationId);
      setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function retargetToCaseNote() {
    const target = createCaseDraft(caseId, caseLabel);
    setForm((current) => ({
      ...current,
      targetType: target.targetType,
      targetId: target.targetId,
      targetLabel: target.targetLabel,
    }));
  }

  return (
    <div className="grid min-h-[680px] gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section className="workspace-card-strong overflow-hidden rounded-[24px]">
        <div className="border-b border-[color:var(--line)] bg-[linear-gradient(135deg,rgba(255,250,244,0.98),rgba(247,238,228,0.9))] px-5 py-4">
          <div className="panel-title">Collaborative Annotations</div>
          <h2 className="mt-2 text-xl font-semibold">Capture context without leaving the case</h2>
          <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">
            Notes stay linked to case evidence, contradictions, and timeline events so review context
            does not disappear into Slack or memory.
          </p>
        </div>
        <form className="space-y-4 p-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="panel-title">Author</span>
            <input
              value={form.author}
              onChange={(event) =>
                setForm((current) => ({ ...current, author: event.target.value }))
              }
              placeholder="Your handle or name"
              className="mt-2 w-full rounded-xl border border-[color:var(--line)] bg-white px-3 py-2 text-sm"
            />
          </label>

          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--bg-soft)] p-4">
            <div className="panel-title">Linked target</div>
            <div className="mt-2 text-sm font-medium text-[color:var(--text)]">
              {form.targetLabel}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[color:var(--line)] bg-white px-3 py-1 text-xs text-[color:var(--muted)]">
                {targetTypeLabel(form.targetType)}
              </span>
              {form.targetType !== "case" && (
                <button
                  type="button"
                  onClick={retargetToCaseNote}
                  className="rounded-full border border-[color:var(--line)] bg-white px-3 py-1 text-xs text-[color:var(--muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                >
                  Convert to case note
                </button>
              )}
            </div>
            {draftEvidence.length > 0 && (
              <div className="mt-4 rounded-2xl border border-[color:var(--line)] bg-white/80 p-3">
                <div className="panel-title">Source Evidence</div>
                <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">
                  This note will stay connected to the supporting source material below.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {draftEvidence.map((evidence) => (
                    <EvidenceButton
                      key={evidence.id}
                      evidence={evidence}
                      onOpenDocument={onOpenDocument}
                      onOpenEvidence={onOpenEvidence}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <label className="block">
            <span className="panel-title">Tag</span>
            <input
              value={form.tag}
              onChange={(event) => setForm((current) => ({ ...current, tag: event.target.value }))}
              placeholder="timeline, conflict, witness, follow-up"
              className="mt-2 w-full rounded-xl border border-[color:var(--line)] bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="panel-title">Title</span>
            <input
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Short headline for the note"
              className="mt-2 w-full rounded-xl border border-[color:var(--line)] bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="panel-title">Note</span>
            <textarea
              value={form.body}
              onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
              placeholder="Capture what matters here, why it matters, and what to follow up on."
              rows={7}
              className="mt-2 w-full rounded-2xl border border-[color:var(--line)] bg-white px-3 py-3 text-sm leading-6"
            />
          </label>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-[color:var(--text)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving ? "Saving note…" : "Save annotation"}
          </button>
        </form>
      </section>

      <section className="workspace-card-strong overflow-hidden rounded-[24px]">
        <div className="border-b border-[color:var(--line)] px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="panel-title">Annotation Feed</div>
              <h2 className="mt-2 text-xl font-semibold">Shared working notes</h2>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search notes, tags, targets, or authors"
                className="min-w-0 flex-1 rounded-xl border border-[color:var(--line)] bg-white px-3 py-2 text-sm"
              />
              <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--bg-soft)] px-3 py-1 text-xs text-[color:var(--muted)]">
                {visibleAnnotations.length} notes
              </span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["all", "case", "document", "event", "contradiction"] as AnnotationFilter[]).map(
              (option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  className={
                    filter === option
                      ? "rounded-full border border-[color:var(--text)] bg-[color:var(--text)] px-3 py-1.5 text-xs text-white"
                      : "rounded-full border border-[color:var(--line)] bg-white px-3 py-1.5 text-xs text-[color:var(--muted)] hover:bg-white/80"
                  }
                >
                  {option === "all" ? "All notes" : `${targetTypeLabel(option)} notes`}
                </button>
              ),
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-5 text-sm text-[color:var(--muted)]">Loading annotations…</div>
        ) : visibleAnnotations.length === 0 ? (
          <div className="flex h-full min-h-[420px] flex-col justify-between p-5">
            <div>
              <div className="panel-title">No annotations yet</div>
              <h3 className="mt-2 text-lg font-semibold">Start with a case note or annotate live evidence</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[color:var(--muted)]">
                Add a note here, or jump back into the workspace and use the annotation buttons on
                the timeline, document, and contradiction views.
              </p>
            </div>
            <div className="rounded-2xl border border-dashed border-[color:var(--line-strong)] bg-[color:var(--bg-soft)] p-4 text-sm text-[color:var(--muted)]">
              Suggested pattern: tag notes as <code>timeline</code>, <code>conflict</code>, or
              <code> follow-up</code> so reviewers can scan them quickly.
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--line)]">
            {visibleAnnotations.map((annotation) => (
              <li key={annotation.id} className="bg-white/60 px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--bg-soft)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted)]">
                        {targetTypeLabel(annotation.target_type)}
                      </span>
                      {annotation.tag && (
                        <span className="rounded-full border border-[color:var(--line)] bg-white px-3 py-1 text-xs text-[color:var(--accent)]">
                          #{annotation.tag}
                        </span>
                      )}
                      <span className="text-xs text-[color:var(--muted)]">
                        {annotation.author} · {formatTimestamp(annotation.created_at)}
                      </span>
                    </div>
                    <div className="mt-3 text-sm font-semibold text-[color:var(--text)]">
                      {annotation.title || annotation.target_label}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[color:var(--muted)]">
                      {annotation.target_label}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[color:var(--text)]">
                      {annotation.body}
                    </p>
                    <AnnotationEvidencePanel
                      evidence={resolveEvidenceLinks(annotation.target_type, annotation.target_id, {
                        documentById,
                        eventById,
                        contradictionById,
                      })}
                      onOpenDocument={onOpenDocument}
                      onOpenEvidence={onOpenEvidence}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(annotation.id)}
                    className="rounded-full border border-[color:var(--line)] bg-white px-3 py-1.5 text-xs text-[color:var(--muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AnnotationEvidencePanel({
  evidence,
  onOpenDocument,
  onOpenEvidence,
}: {
  evidence: EvidenceLink[];
  onOpenDocument?: (docId: string) => void;
  onOpenEvidence?: (docId: string, start: number, end: number) => void;
}) {
  if (evidence.length === 0) return null;

  return (
    <div className="mt-4 rounded-2xl border border-[color:var(--line)] bg-[linear-gradient(180deg,rgba(255,253,250,0.95),rgba(249,244,238,0.92))] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="panel-title">Source Evidence</div>
          <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">
            Open the linked source directly from this note.
          </p>
        </div>
        <span className="rounded-full border border-[color:var(--line)] bg-white px-3 py-1 text-[11px] text-[color:var(--muted)]">
          {evidence.length} source{evidence.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {evidence.map((item) => (
          <EvidenceButton
            key={item.id}
            evidence={item}
            onOpenDocument={onOpenDocument}
            onOpenEvidence={onOpenEvidence}
          />
        ))}
      </div>
    </div>
  );
}

function EvidenceButton({
  evidence,
  onOpenDocument,
  onOpenEvidence,
}: {
  evidence: EvidenceLink;
  onOpenDocument?: (docId: string) => void;
  onOpenEvidence?: (docId: string, start: number, end: number) => void;
}) {
  const opensExcerpt = evidence.start !== null && evidence.end !== null;

  return (
    <button
      type="button"
      onClick={() => {
        if (opensExcerpt && onOpenEvidence) {
          onOpenEvidence(evidence.docId, evidence.start, evidence.end);
          return;
        }
        onOpenDocument?.(evidence.docId);
      }}
      className="rounded-2xl border border-[color:var(--line)] bg-white px-3 py-2 text-left transition hover:border-[color:var(--accent)] hover:shadow-sm"
    >
      <div className="text-sm font-medium text-[color:var(--text)]">{evidence.label}</div>
      <div className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{evidence.detail}</div>
    </button>
  );
}

function createCaseDraft(caseId: string, caseLabel: string): AnnotationDraftTarget {
  return {
    targetType: "case",
    targetId: caseId,
    targetLabel: caseLabel,
    suggestedTag: "case-note",
  };
}

function createInitialForm(
  caseId: string,
  caseLabel: string,
  draftTarget: AnnotationDraftTarget | null,
): FormState {
  const target = draftTarget ?? createCaseDraft(caseId, caseLabel);
  return {
    author: "",
    targetType: target.targetType,
    targetId: target.targetId,
    targetLabel: target.targetLabel,
    tag: target.suggestedTag ?? "",
    title: target.suggestedTitle ?? "",
    body: "",
  };
}

function targetTypeLabel(targetType: AnnotationFilter): string {
  switch (targetType) {
    case "document":
      return "Document";
    case "event":
      return "Timeline";
    case "contradiction":
      return "Contradiction";
    case "case":
      return "Case";
    default:
      return "All";
  }
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function resolveEvidenceLinks(
  targetType: AnnotationTargetType,
  targetId: string,
  sources: {
    documentById: Map<string, DocumentSummary>;
    eventById: Map<string, TimelineEventRecord>;
    contradictionById: Map<string, ContradictionDetail>;
  },
): EvidenceLink[] {
  if (targetType === "document") {
    const document = sources.documentById.get(targetId);
    if (!document) return [];
    return [
      {
        id: `document:${document.id}`,
        docId: document.id,
        filename: document.filename,
        label: document.filename,
        detail: "Open the linked source document",
        start: null,
        end: null,
      },
    ];
  }

  if (targetType === "event") {
    const event = sources.eventById.get(targetId);
    if (!event) return [];
    return dedupeEvidenceLinks(
      event.provenance
        .map((raw, index) => {
          const parsed = parseProvenance(raw);
          if (!parsed) return null;
          const document = sources.documentById.get(parsed.docId);
          return {
            id: `event:${targetId}:${index}`,
            docId: parsed.docId,
            filename: document?.filename ?? parsed.docId.slice(0, 8),
            label: document?.filename ?? parsed.docId.slice(0, 8),
            detail: "Timeline source excerpt",
            start: parsed.start,
            end: parsed.end,
          } satisfies EvidenceLink;
        })
        .filter((value): value is EvidenceLink => value !== null),
    );
  }

  if (targetType === "contradiction") {
    const contradiction = sources.contradictionById.get(targetId);
    if (!contradiction) return [];
    return dedupeEvidenceLinks(
      contradiction.claims.map((claim) => ({
        id: `contradiction:${targetId}:${claim.claim_id}`,
        docId: claim.source_doc_id,
        filename:
          claim.source_doc_filename ??
          sources.documentById.get(claim.source_doc_id)?.filename ??
          claim.source_doc_id.slice(0, 8),
        label:
          claim.source_doc_filename ??
          sources.documentById.get(claim.source_doc_id)?.filename ??
          claim.source_doc_id.slice(0, 8),
        detail: `${claim.speaker_entity_name ?? claim.speaker_entity_id ?? "Unknown speaker"} · ${claim.value}`,
        start: claim.char_start,
        end: claim.char_end,
      })),
    );
  }

  return [];
}

function dedupeEvidenceLinks(evidence: EvidenceLink[]): EvidenceLink[] {
  const seen = new Set<string>();
  const deduped: EvidenceLink[] = [];
  for (const item of evidence) {
    const key = `${item.docId}:${item.start ?? "doc"}:${item.end ?? "doc"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}
