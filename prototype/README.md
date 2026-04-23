# LexGraph Prototype

This prototype implements the minimum PRD-aligned workflow for the legal discovery product:

- document ingestion from seeded sample data or uploaded text-based files
- entity extraction with basic alias resolution
- relationship and knowledge-graph rendering
- timeline generation
- contradiction detection across documents
- session instrumentation and export for customer discovery interviews

## Run

From the repository root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/prototype/`.

## Demo Flow

1. Click `Load Sample Case`.
2. Open a few documents to show ingestion.
3. Click entities in the graph to show evidence linking.
4. Open contradiction cards to show side-by-side conflicts.
5. Record live user feedback in the instrumentation form.
6. Export the collected session JSON after the interview.

## Prototype Scope

This is intentionally lightweight. It is designed for customer discovery and early demos, not production use.
