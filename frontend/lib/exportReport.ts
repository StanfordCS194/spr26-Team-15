import type { ContradictionDetail, TimelineEventRecord } from "./api";
import type { CaseSummary, DocumentSummary } from "./types";

interface FormatCaseReportInput {
  summary: CaseSummary;
  documents: DocumentSummary[];
  events: TimelineEventRecord[];
  contradictions: ContradictionDetail[];
  generatedAt?: Date;
}

function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function normalizeInline(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatDocumentLabel(docId: string, documentsById: Map<string, DocumentSummary>): string {
  return documentsById.get(docId)?.filename ?? docId;
}

export function createReportFilename(caseId: string): string {
  const slug = caseId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${slug || "case"}-report.md`;
}

export function formatCaseReport({
  summary,
  documents,
  events,
  contradictions,
  generatedAt = new Date(),
}: FormatCaseReportInput): string {
  const documentsById = new Map(documents.map((doc) => [doc.id, doc]));
  const highlightedEvents = events.filter(
    (event) => event.participants.length > 0 || event.provenance.length > 1,
  );

  return [
    `# Case Report: ${summary.name}`,
    "",
    `Generated: ${formatTimestamp(generatedAt)}`,
    `Case ID: ${summary.id}`,
    "",
    "## Summary",
    `- Documents: ${summary.document_count}`,
    `- Entities: ${summary.entity_count}`,
    `- Contradictions: ${summary.contradiction_count}`,
    `- Timeline Events: ${events.length}`,
    "",
    "## Documents",
    ...(documents.length > 0
      ? documents.map(
          (doc) =>
            `- ${doc.filename} (${doc.mime_type}, ${doc.char_length.toLocaleString()} chars)`,
        )
      : ["- None"]),
    "",
    "## Timeline Highlights",
    ...(highlightedEvents.length > 0
      ? highlightedEvents.flatMap((event, index) => {
          const participants = event.participants.map((participant) => participant.name).join(", ");
          const evidenceCount = event.provenance.length;
          const lines = [
            `${index + 1}. ${event.occurred_at || "Undated"}: ${normalizeInline(event.description)}`,
          ];

          if (participants) {
            lines.push(`Participants: ${participants}`);
          }
          lines.push(`Supporting excerpts: ${evidenceCount}`);
          lines.push("");
          return lines;
        })
      : ["No timeline highlights available."]),
    "",
    "## Full Timeline",
    ...(events.length > 0
      ? events.flatMap((event, index) => {
          const participants = event.participants.map((participant) => participant.name).join(", ");
          const lines = [
            `${index + 1}. ${event.occurred_at || "Undated"}: ${normalizeInline(event.description)}`,
          ];

          if (participants) {
            lines.push(`Participants: ${participants}`);
          }

          lines.push("");
          return lines;
        })
      : ["No events available."]),
    "",
    "## Contradictions",
    ...(contradictions.length > 0
      ? contradictions.flatMap((contradiction, index) => [
          `### ${index + 1}. ${contradiction.subject_entity_name ?? contradiction.subject_entity_id} · ${contradiction.predicate}`,
          `Rank score: ${contradiction.rank_score.toFixed(2)}`,
          normalizeInline(contradiction.explanation),
          "",
          ...contradiction.claims.map((claim) => {
            const source = formatDocumentLabel(claim.source_doc_id, documentsById);
            const excerpt = normalizeInline(claim.excerpt);
            const excerptSuffix = excerpt ? ` | Excerpt: "${excerpt}"` : "";
            return `- ${normalizeInline(claim.value)} | ${source} | chars ${claim.char_start}-${claim.char_end}${excerptSuffix}`;
          }),
          "",
        ])
      : ["No contradictions detected."]),
  ].join("\n");
}
