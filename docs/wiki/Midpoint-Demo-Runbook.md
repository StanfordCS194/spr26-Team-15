# Midpoint Demo Runbook

This runbook is the stable midpoint-review path for the legal discovery product.

## Demo Mode

Use offline mode for the midpoint review:

- `DEMO_OFFLINE_MODE=true`

Reason:

- avoids dependency on live LLM extraction
- avoids rate limits and provider instability
- preserves the legal Enron case workflow needed for testing

## Pre-Demo Setup

1. Confirm `.env` or `backend/.env` exists.
   The canonical `demo` case now runs offline by default even if that flag is missing, but keeping
   `DEMO_OFFLINE_MODE=true` in local env is still a good explicit demo setting.
2. Start infrastructure:

```bash
./scripts/dev-up.sh
```

3. Start backend:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

4. Start frontend in a separate terminal:

```bash
cd frontend
npm run dev
```

5. Seed the demo case:

```bash
./scripts/seed-demo.sh demo
```

6. Open:

- `http://localhost:3000/case/demo`

## Pre-Flight Verification

Verify these before testers arrive:

- the case page loads without API errors
- document, entity, and contradiction counts are non-zero
- timeline events appear
- graph nodes render
- contradictions open and jump to evidence

## Recommended Demo Narrative

1. Start on the demo workspace.
2. Point out that the case is already populated with legal materials.
3. Show the timeline as the first review surface.
4. Jump from one event into the underlying document excerpt.
5. Select an entity from the graph to show cross-document linkage.
6. Open the contradictions tab and compare competing claims.
7. Explain that this is the current core value: structured cross-document legal review grounded in source text.

## Backup Plan

If live upload fails during the demo:

- stay in the seeded `demo` case
- continue with timeline, graph, contradiction, and source-evidence flows

If counts are unexpectedly zero:

```bash
./scripts/reset-demo.sh --seed
```

## Demo Success Criteria

- app opens quickly and stays navigable
- at least one contradiction is visible
- at least one event links back to source evidence
- the user can explain the case value proposition after a short exploration
