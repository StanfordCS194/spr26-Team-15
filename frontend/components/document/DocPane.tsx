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
}

export function DocPane({ caseId, highlight }: Props) {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocumentDetail | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDocuments(caseId)
      .then((ds) => {
        setDocs(ds);
        if (ds[0] && !activeDocId) setActiveDocId(ds[0].id);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  useEffect(() => {
    const targetId = highlight?.docId ?? activeDocId;
    if (!targetId) return;
    if (highlight?.docId && highlight.docId !== activeDocId) {
      setActiveDocId(highlight.docId);
    }
    getDocument(caseId, targetId)
      .then(setActiveDoc)
      .catch((e) => setError(String(e)));
  }, [caseId, highlight, activeDocId]);

  if (error) return <div className="p-4 text-sm text-red-600">Document error: {error}</div>;
  if (!activeDoc)
    return <div className="p-4 text-sm text-neutral-500">Select an entity or event to view source.</div>;

  const text = activeDoc.text;
  const [hlStart, hlEnd] = highlight && highlight.docId === activeDoc.id
    ? [Math.max(0, highlight.start), Math.min(text.length, highlight.end)]
    : [-1, -1];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white p-2 text-xs">
        <select
          value={activeDoc.id}
          onChange={(e) => setActiveDocId(e.target.value)}
          className="flex-1 rounded border px-2 py-1"
        >
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.filename}
            </option>
          ))}
        </select>
        <span className="text-neutral-500">{activeDoc.char_length} chars</span>
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-sm">
        {hlStart < 0 ? (
          text
        ) : (
          <>
            {text.slice(0, hlStart)}
            <mark className="rounded bg-yellow-200 px-0.5">{text.slice(hlStart, hlEnd)}</mark>
            {text.slice(hlEnd)}
          </>
        )}
      </pre>
    </div>
  );
}
