"use client";

import { useState } from "react";

import { getCase, getEvents, listContradictions, listDocuments } from "@/lib/api";

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

      const report = [
        `# Case Report: ${summary.name}`,
        "",
        `Generated: ${new Date().toLocaleString()}`,
        `Case ID: ${summary.id}`,
        "",
        "## Summary",
        `- Documents: ${summary.document_count}`,
        `- Entities: ${summary.entity_count}`,
        `- Contradictions: ${summary.contradiction_count}`,
        "",
        "## Documents",
        ...(documents.length > 0
          ? documents.map((doc) => `- ${doc.filename} (${doc.mime_type}, ${doc.char_length} chars)`)
          : ["- None"]),
        "",
        "## Timeline",
        ...(events.length > 0
          ? events.map((event, index) => `${index + 1}. ${event.occurred_at}: ${event.description}`)
          : ["No events available."]),
        "",
        "## Contradictions",
        ...(contradictions.length > 0
          ? contradictions.flatMap((contradiction) => [
              `### ${contradiction.subject_entity_id} · ${contradiction.predicate}`,
              `Rank: ${contradiction.rank_score.toFixed(2)}`,
              contradiction.explanation,
              ...contradiction.claims.map(
                (claim) =>
                  `- ${claim.value} (${claim.source_doc_id}, chars ${claim.char_start}-${claim.char_end})`,
              ),
              "",
            ])
          : ["No contradictions detected."]),
      ].join("\n");

      downloadText(`${caseId}-report.md`, report);
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
      className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Exporting…" : "Export report"}
    </button>
  );
}
