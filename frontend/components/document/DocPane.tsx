"use client";

import { useEffect, useState } from "react";

import { getDocument, listDocuments } from "@/lib/api";
import type { DocumentDetail, DocumentSummary } from "@/lib/types";

interface Highlight {
  docId: string;
  start: number;
  end: number;
}

interface Props {
  caseId: string;
  highlight: Highlight | null;
  preferredDocId?: string | null;
  refreshToken?: number;
  onManualSelect?: () => void;
  onAnnotateDocument?: (document: { id: string; filename: string }) => void;
}

export function DocPane({
  caseId,
  highlight,
  preferredDocId = null,
  refreshToken = 0,
  onManualSelect,
  onAnnotateDocument,
}: Props) {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocumentDetail | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listDocuments(caseId)
      .then((ds) => {
        if (cancelled) return;
        setDocs(ds);
        const preferredId = highlight?.docId ?? preferredDocId ?? ds.at(-1)?.id ?? null;
        setActiveDocId((current) => {
          if (refreshToken > 0) return preferredId ?? current;
          if (current && ds.some((doc) => doc.id === current)) return current;
          return preferredId ?? current;
        });
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken, highlight?.docId, preferredDocId]);

  useEffect(() => {
    if (!highlight?.docId) return;
    setActiveDocId(highlight.docId);
  }, [highlight?.docId]);

  useEffect(() => {
    if (!activeDocId) return;
    setError(null);
    getDocument(caseId, activeDocId)
      .then(setActiveDoc)
      .catch((e) => setError(String(e)));
  }, [caseId, activeDocId]);

  if (error) return <div className="p-5 text-sm text-red-600">Document error: {error}</div>;
  if (!activeDoc)
    return (
      <div className="flex h-full flex-col justify-between p-5">
        <div>
          <div className="panel-title">Source Document</div>
          <h2 className="mt-2 text-lg font-semibold">No document selected</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-[color:var(--muted)]">
            Pick an event from the timeline, open a contradiction, or choose a file from the document
            list to inspect the original evidence.
          </p>
        </div>
      </div>
    );

  const text = activeDoc.text;
  const [hlStart, hlEnd] = highlight && highlight.docId === activeDoc.id && highlight.end > highlight.start
    ? [Math.max(0, highlight.start), Math.min(text.length, highlight.end)]
    : [-1, -1];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[color:var(--line)] bg-white/80 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="panel-title">Source Evidence</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <label className="min-w-0">
                <span className="sr-only">Choose source document</span>
                <select
                  value={activeDoc.id}
                  onChange={(e) => {
                    setActiveDocId(e.target.value);
                    onManualSelect?.();
                  }}
                  className="w-full rounded-xl border border-[color:var(--line)] bg-white px-3 py-2 text-sm"
                >
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.filename}
                    </option>
                  ))}
                </select>
              </label>
              <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--bg-soft)] px-3 py-1 text-xs text-[color:var(--muted)]">
                {docs.length} docs
              </span>
              <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--bg-soft)] px-3 py-1 text-xs text-[color:var(--muted)]">
                {activeDoc.char_length} chars
              </span>
            </div>
          </div>
          <div className="max-w-xs text-xs leading-5 text-[color:var(--muted)]">
            <div>Highlighted text shows the span used to support the selected event or contradiction.</div>
            <button
              type="button"
              onClick={() =>
                onAnnotateDocument?.({
                  id: activeDoc.id,
                  filename: activeDoc.filename,
                })
              }
              className="mt-3 rounded-full border border-[color:var(--line)] bg-white px-3 py-1.5 text-xs text-[color:var(--muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
            >
              Add note
            </button>
          </div>
        </div>
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap bg-[linear-gradient(180deg,rgba(255,253,250,0.92),rgba(249,244,238,0.86))] p-5 font-mono text-[14px] leading-7 text-[color:var(--text)]">
        {hlStart < 0 ? (
          text
        ) : (
          <>
            {text.slice(0, hlStart)}
            <mark className="rounded-lg bg-[color:var(--accent-soft)] px-1 py-0.5 text-[color:var(--text)]">
              {text.slice(hlStart, hlEnd)}
            </mark>
            {text.slice(hlEnd)}
          </>
        )}
      </pre>
    </div>
  );
}
