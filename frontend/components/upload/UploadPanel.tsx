"use client";

import { useState } from "react";

import { uploadDocument } from "@/lib/api";

interface Props {
  caseId: string;
  onUploaded: (docId: string | null) => void;
}

export function UploadPanel({ caseId, onUploaded }: Props) {
  const [status, setStatus] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>("");
  const [details, setDetails] = useState<string[]>([]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const allFiles = Array.from(files);
    setPending(true);
    setProgress(0);
    setDetails([]);
    try {
      let lastUploadedDocId: string | null = null;
      for (const [index, file] of allFiles.entries()) {
        const itemNo = index + 1;
        setPhase(`Uploading and extracting file ${itemNo} of ${allFiles.length}`);
        setStatus(file.name);
        const result = await uploadDocument(caseId, file);
        lastUploadedDocId = result.document.id;
        setProgress(Math.round((itemNo / allFiles.length) * 100));
        setDetails((prev) => [
          ...prev,
          `${result.document.filename}: ${result.pipeline.entity_clusters} entities, ${result.pipeline.events_extracted} events, ${result.pipeline.contradictions_found} contradictions`,
        ]);
      }
      setPhase("Processing complete");
      setStatus("All selected files were uploaded and the case was reprocessed.");
      onUploaded(lastUploadedDocId);
    } catch (e) {
      setPhase("Upload failed");
      setProgress(0);
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg.replace(/^Error:\s*/, "").slice(0, 200));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-b border-[color:var(--line)] bg-white/60 px-5 py-4 sm:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="panel-title">Ingestion</div>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            Add PDFs, emails, or text exhibits to this case. Each upload now triggers case
            reprocessing so timeline, graph, and contradiction views stay in sync.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[color:var(--line-strong)] bg-[color:var(--text)] px-4 py-2 text-sm font-medium text-white transition hover:translate-y-[-1px] hover:bg-black">
          {pending ? "Uploading…" : "Upload documents"}
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em]">
            .pdf .eml .txt
          </span>
          <input
            type="file"
            accept=".pdf,.eml,.txt,.md"
            multiple
            className="hidden"
            disabled={pending}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      </div>
      {(pending || status) && (
        <div className="mt-4 rounded-2xl border border-[color:var(--line)] bg-white/80 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-[color:var(--text)]">
                {phase || "Ready"}
              </div>
              <div className="text-sm text-[color:var(--muted)]">{status}</div>
            </div>
            <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--bg-soft)] px-3 py-1 text-xs text-[color:var(--muted)]">
              {pending ? "Working…" : `${progress}% complete`}
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eadfce]">
            <div
              className={`h-full rounded-full bg-[linear-gradient(90deg,#a54e2d,#365345)] transition-all duration-300 ${
                pending ? "animate-pulse" : ""
              }`}
              style={{ width: `${pending ? Math.max(progress, 40) : progress}%` }}
            />
          </div>
          {details.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-[color:var(--muted)]">
              {details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
