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
}

// Source evidence panel: filename list on the left, doc text on the right.
// Replaced the old dropdown so all docs are always visible.
export function DocPane({
  caseId,
  highlight,
  preferredDocId = null,
  refreshToken = 0,
  onManualSelect,
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
    let cancelled = false;
    setError(null);
    getDocument(caseId, activeDocId)
      .then((doc) => {
        if (!cancelled) setActiveDoc(doc);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = String(e);
        // 404 = doc was removed. Just clear it instead of showing an error.
        if (msg.includes("404")) {
          setActiveDoc(null);
          setActiveDocId(null);
          return;
        }
        setError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, activeDocId]);

  if (error) return <div className="p-5 text-sm text-red-600">Document error: {error}</div>;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)]">
      <DocumentList
        docs={docs}
        activeDocId={activeDoc?.id ?? null}
        onSelect={(id) => {
          setActiveDocId(id);
          onManualSelect?.();
        }}
      />
      <div className="flex min-h-0 flex-col">
        {!activeDoc ? (
          <div className="flex h-full flex-col justify-between p-5">
            <div>
              <div className="panel-title">Source Document</div>
              <h2 className="mt-2 text-lg font-semibold">No document selected</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-[color:var(--muted)]">
                Pick a document from the list on the left, or jump in via the timeline or a
                contradiction to land on the supporting evidence.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-[color:var(--line)] bg-white/80 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {activeDoc.filename}
                </div>
                <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--bg-soft)] px-3 py-1 text-xs text-[color:var(--muted)]">
                  {activeDoc.char_length} chars
                </span>
              </div>
              <div className="mt-1 text-[11px] text-[color:var(--muted)]">
                Highlighted text supports the selected event or contradiction.
              </div>
            </div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap bg-[linear-gradient(180deg,rgba(255,253,250,0.92),rgba(249,244,238,0.86))] p-5 font-mono text-[14px] leading-7 text-[color:var(--text)]">
              {renderHighlighted(activeDoc.text, highlight, activeDoc.id)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

// Left-side list of every doc in the case. Click one to open it on the right.
function DocumentList({
  docs,
  activeDocId,
  onSelect,
}: {
  docs: DocumentSummary[];
  activeDocId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col border-b border-[color:var(--line)] bg-[#f7efe4] xl:border-b-0 xl:border-r">
      <div className="border-b border-[color:var(--line)] bg-white/80 px-4 py-3">
        <div className="panel-title">Documents ({docs.length})</div>
      </div>
      {docs.length === 0 ? (
        <div className="p-4 text-xs text-[color:var(--muted)]">
          No documents in this case yet.
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-[color:var(--line)]">
          {docs.map((doc) => {
            const active = doc.id === activeDocId;
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => onSelect(doc.id)}
                  title={doc.filename}
                  className={
                    active
                      ? "block w-full truncate bg-[linear-gradient(135deg,#fff3ec,#fde6d8)] px-4 py-3 text-left text-sm font-medium text-[color:var(--text)]"
                      : "block w-full truncate bg-white/60 px-4 py-3 text-left text-sm text-[color:var(--text)] hover:bg-white/90"
                  }
                >
                  {doc.filename}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function renderHighlighted(
  text: string,
  highlight: Highlight | null,
  activeDocId: string,
): React.ReactNode {
  if (!highlight || highlight.docId !== activeDocId || highlight.end <= highlight.start) {
    return text;
  }
  const hlStart = Math.max(0, highlight.start);
  const hlEnd = Math.min(text.length, highlight.end);
  return (
    <>
      {text.slice(0, hlStart)}
      <mark className="rounded-lg bg-[color:var(--accent-soft)] px-1 py-0.5 text-[color:var(--text)]">
        {text.slice(hlStart, hlEnd)}
      </mark>
      {text.slice(hlEnd)}
    </>
  );
}
