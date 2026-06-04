"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createCase, listCases } from "@/lib/api";
import type { CaseSummary } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [caseName, setCaseName] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listCases()
      .then(setCases)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (dialogOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [dialogOpen]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = caseName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const id = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
      await createCase(id, name);
      router.push(`/case/${id}`);
    } catch (e) {
      setError(String(e));
      setCreating(false);
    }
  }

  return (
    <main className="workspace-shell">
      <div className="workspace-card flex min-h-[calc(100vh-36px)] flex-col overflow-hidden rounded-[28px]">
        <header className="border-b border-[color:var(--line)] bg-[linear-gradient(135deg,rgba(255,250,244,0.98),rgba(247,238,228,0.94))] px-5 py-4 sm:px-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="panel-title">Legal Discovery</div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Case Workspace
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--muted)]">
                Select a case to open its intelligence workspace, or create a new one to upload
                documents and begin extraction.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="shrink-0 rounded-full border border-[color:var(--text)] bg-[color:var(--text)] px-4 py-2 text-sm text-white hover:opacity-90"
            >
              New case
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 p-4 sm:p-5">
          {error && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="p-4 text-sm text-[color:var(--muted)]">Loading cases…</div>
          ) : cases.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-20 text-center">
              <p className="text-sm text-[color:var(--muted)]">No cases yet.</p>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm hover:bg-white/80"
              >
                Create your first case
              </button>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cases.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/case/${c.id}`)}
                    className="workspace-card-strong w-full rounded-[20px] p-5 text-left transition hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="panel-title">Case</div>
                        <div className="mt-1 truncate text-base font-semibold">{c.name}</div>
                      </div>
                      {c.id === "demo" && (
                        <span className="shrink-0 rounded-full border border-[color:var(--line)] bg-white/80 px-2 py-0.5 text-xs text-[color:var(--muted)]">
                          demo
                        </span>
                      )}
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <Stat label="Docs" value={c.document_count} />
                      <Stat label="Entities" value={c.entity_count} />
                      <Stat label="Conflicts" value={c.contradiction_count} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          onClick={() => setDialogOpen(false)}
        >
          <div
            className="workspace-card w-full max-w-sm rounded-[24px] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">New case</h2>
            <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3">
              <input
                ref={inputRef}
                type="text"
                placeholder="Case name"
                value={caseName}
                onChange={(e) => setCaseName(e.target.value)}
                className="rounded-xl border border-[color:var(--line)] bg-white px-3 py-2 text-sm"
                required
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="rounded-full border border-[color:var(--line)] bg-white px-4 py-2 text-sm text-[color:var(--muted)] hover:bg-white/80"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !caseName.trim()}
                  className="rounded-full border border-[color:var(--text)] bg-[color:var(--text)] px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[color:var(--line)] bg-white/60 px-2 py-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="mt-0.5 text-xs text-[color:var(--muted)]">{label}</div>
    </div>
  );
}
