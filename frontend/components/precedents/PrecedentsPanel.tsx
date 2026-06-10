"use client";

import { useEffect, useState } from "react";

import { listPrecedents, type Precedent } from "@/lib/api";

interface Props {
  caseId: string;
  refreshToken?: number;
}

export function PrecedentsPanel({ caseId, refreshToken = 0 }: Props) {
  const [precedents, setPrecedents] = useState<Precedent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listPrecedents(caseId)
      .then((data) => {
        if (!cancelled) {
          setPrecedents(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[color:var(--line)] px-5 py-4">
        <div className="panel-title">Precedent Suggestions</div>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Relevant case law identified from the facts and contradictions in this case.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-[color:var(--line-strong)] border-t-[color:var(--accent)]" />
            <p className="mt-3 text-sm text-[color:var(--muted)]">
              Analyzing case facts…
            </p>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && precedents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-[color:var(--muted)]">
              No precedents found. Upload and process documents first.
            </p>
          </div>
        )}

        {!loading && !error && precedents.length > 0 && (
          <ul className="flex flex-col gap-4">
            {precedents.map((p, i) => (
              <PrecedentCard key={i} precedent={p} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PrecedentCard({ precedent }: { precedent: Precedent }) {
  return (
    <li className="workspace-card-strong rounded-[20px] p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold leading-snug text-[color:var(--text)]">
            {precedent.title}
          </p>
          <p className="mt-0.5 text-sm text-[color:var(--muted)]">
            {precedent.citation}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--muted)]">
          {precedent.area_of_law}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[color:var(--text)]">
        {precedent.relevance}
      </p>
    </li>
  );
}
