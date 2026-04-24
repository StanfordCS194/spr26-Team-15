# spr26-Team-15 — AI-Powered Legal Discovery Prototype

Team: Josh Joseph, Alyssa Ong, Arjun Inamdar, Ganesh Venu, Nathan Elias

- Wiki: https://github.com/StanfordCS194/spr26-Team-15/wiki
- PRD: https://docs.google.com/document/d/1qcUGxG8V0NCjoZfFDlBGLKftN6Q7ye5ZOV37q1EMHa4/edit

## What this is

A prototype legal discovery workspace that ingests case documents, extracts a structured knowledge graph of entities, relationships, and claims, and surfaces cross-document contradictions with grounded source excerpts. Not a chatbot, not a RAG tool — the differentiator is structured cross-document reasoning.

## Architecture

- **Frontend:** Next.js 15 + TypeScript + Tailwind + shadcn/ui + React Flow + vis-timeline
- **Backend:** Python FastAPI
- **Graph DB:** Neo4j 5
- **Metadata DB:** Postgres 16
- **LLM:** Claude Sonnet 4.6 (with prompt caching); Haiku 4.5 for resolution adjudication

See `backend/` and `frontend/` for service-specific READMEs.

## Local setup

### 1. Prereqs
- Docker + Docker Compose
- Python 3.11+
- Node 20+ (use `pnpm` or `npm`)

### 2. Environment
```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY (never commit .env)
```

### 3. Bring up databases
```bash
./scripts/dev-up.sh
```
This starts Neo4j (http://localhost:7474, bolt://localhost:7687) and Postgres.

### 4. Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

### 5. Frontend
```bash
cd frontend
pnpm install
pnpm dev
```

### 6. Seed the Enron demo corpus
```bash
./scripts/seed-demo.sh
```

Open http://localhost:3000/case/demo.

## Testing

```bash
# Backend
cd backend && pytest                    # unit + integration (LLM mocked)
pytest -m live                          # live Claude API — costs money, runs eval harness

# Frontend
cd frontend && pnpm test                # vitest
pnpm test:e2e                           # Playwright
```

## Secrets policy

- `.env` and `.env.*` are gitignored (`.env.example` is the only exception).
- Pre-commit hook scans for `sk-ant-` prefixes and blocks any match.
- Deployed env secrets live in platform secret stores (Vercel / Railway / Aura / Neon) — never in the repo.

## Structure

```
spr26-Team-15/
├── frontend/                    # Next.js 15 app
├── backend/                     # FastAPI service
├── data/
│   ├── enron_seed/              # curated demo corpus + ground truth
│   └── schemas/
├── infra/                       # deployment configs
├── scripts/                     # dev + demo scripts
├── docker-compose.yml
└── .github/workflows/           # CI
```

## Contributing

Branch from `main`, open PRs. CI must be green. For any change to `backend/app/extraction/prompts.py`, include a before/after diff of `eval_report.md` in the PR description.
