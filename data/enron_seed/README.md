# Enron seed corpus

This directory contains a curated subset of the Enron email corpus + a handful of synthetic
depositions/memos designed to stress contradiction detection.

- `emails/` — 30 Enron emails selected for cross-document connectivity (shared people, orgs, events).
- `depositions/` — 3 synthetic deposition excerpts with planted date/amount/counterparty conflicts.
- `memos/` — 2 synthetic internal memos that corroborate or contradict email timelines.
- `manifest.json` — index of every file with filename, type, and expected-entity notes (for eval).
- `ground_truth.json` — hand-labeled entities, relations, and contradictions. Used by the accuracy harness.

## Sourcing the real Enron emails

The raw Enron corpus is ~1.3GB and not committed. Fetch it once:
```bash
./scripts/fetch-enron.sh
```
This downloads the CMU Enron release and picks the 30 seed files by filename from `manifest.json`.

## Synthetic docs

Everything under `depositions/` and `memos/` is **synthetic** — hand-authored to produce
specific cross-document contradictions that are hard to find by keyword search. Files are
plain text and under version control.
