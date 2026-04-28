"use client";

import { useState } from "react";

import { uploadDocument } from "@/lib/api";

interface Props {
  caseId: string;
  onUploaded: () => void;
}

export function UploadPanel({ caseId, onUploaded }: Props) {
  const [status, setStatus] = useState<string>("");
  const [pending, setPending] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPending(true);
    try {
      for (const file of Array.from(files)) {
        setStatus(`Uploading ${file.name}…`);
        await uploadDocument(caseId, file);
      }
      setStatus("Upload complete — extraction may take a minute.");
      onUploaded();
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 text-xs">
      <label className="cursor-pointer rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-50">
        Upload docs
        <input
          type="file"
          accept=".pdf,.eml,.txt,.md"
          multiple
          className="hidden"
          disabled={pending}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>
      {status && <span className="text-neutral-600">{status}</span>}
    </div>
  );
}
