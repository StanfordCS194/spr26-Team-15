"use client";

import { useEffect, useState } from "react";

import { listContradictions, type ContradictionDetail } from "@/lib/api";

interface Props {
  caseId: string;
  onClaimSelect: (docId: string, start: number, end: number) => void;
}

export function ContradictionsPanel({ caseId, onClaimSelect }: Props) {
  const [contradictions, setContradictions] = useState<ContradictionDetail[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listContradictions(caseId)
      .then((c) => !cancelled && setContradictions(c))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  if (error) return <div className="p-4 text-sm text-red-600">Error: {error}</div>;
  if (contradictions.length === 0)
    return (
      <div className="p-4 text-sm text-neutral-500">
        No contradictions detected. Extraction may still be running, or the corpus may be consistent.
      </div>
    );

  return (
    <div className="flex h-full flex-col overflow-auto">
      <ul className="divide-y divide-neutral-200">
        {contradictions.map((c) => (
          <li key={c.id} className="bg-white">
            <button
              type="button"
              className="flex w-full items-start justify-between gap-4 p-3 text-left hover:bg-neutral-50"
              onClick={() => setExpanded((prev) => (prev === c.id ? null : c.id))}
            >
              <div>
                <div className="text-sm font-medium">
                  {c.subject_entity_id.slice(0, 12)}… &nbsp;·&nbsp; {c.predicate}
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {c.claims.length} conflicting sources · rank {c.rank_score.toFixed(2)}
                </div>
              </div>
              <span className="text-xs text-neutral-400">{expanded === c.id ? "▾" : "▸"}</span>
            </button>
            {expanded === c.id && (
              <div className="grid grid-cols-1 gap-2 border-t border-neutral-100 bg-neutral-50 p-3 md:grid-cols-2">
                {c.claims.map((claim) => (
                  <button
                    key={claim.claim_id}
                    type="button"
                    onClick={() =>
                      onClaimSelect(claim.source_doc_id, claim.char_start, claim.char_end)
                    }
                    className="rounded border border-neutral-200 bg-white p-3 text-left shadow-sm hover:border-accent"
                  >
                    <div className="text-xs uppercase text-neutral-400">
                      {claim.speaker_entity_id ?? "—"} · {claim.source_doc_id.slice(0, 8)}…
                    </div>
                    <div className="mt-1 font-mono text-sm">{claim.value}</div>
                    <div className="mt-2 text-xs text-neutral-600">
                      …{claim.excerpt.trim()}…
                    </div>
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
