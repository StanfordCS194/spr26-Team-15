"use client";

import { useState } from "react";

import { getCase, getEvents, listContradictions, listDocuments } from "@/lib/api";
import { createReportFilename, formatCaseReport } from "@/lib/exportReport";

interface Props {
  caseId: string;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ExportReportButton({ caseId }: Props) {
  const [pending, setPending] = useState(false);

  async function handleExport() {
    setPending(true);
    try {
      const [summary, documents, events, contradictions] = await Promise.all([
        getCase(caseId),
        listDocuments(caseId),
        getEvents(caseId),
        listContradictions(caseId),
      ]);

      const report = formatCaseReport({
        summary,
        documents,
        events,
        contradictions,
      });

      downloadText(createReportFilename(summary.id || caseId), report);
    } catch (error) {
      window.alert(`Export failed: ${String(error)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={pending}
      className="rounded-full border border-[color:var(--line-strong)] bg-white/80 px-4 py-2 text-sm text-[color:var(--text)] transition hover:translate-y-[-1px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Exporting…" : "Export report"}
    </button>
  );
}
