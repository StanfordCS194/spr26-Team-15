"use client";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="workspace-shell">
          <div className="workspace-card flex min-h-[calc(100vh-36px)] flex-col items-center justify-center gap-4 rounded-[28px] p-8 text-center">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="max-w-md text-sm text-[color:var(--muted)]">
              {error.message || "An unexpected error occurred while rendering this view."}
            </p>
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-[color:var(--line-strong)] bg-[color:var(--text)] px-4 py-2 text-sm font-medium text-white hover:bg-black"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
