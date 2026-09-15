# Analyst Workbench

A secure research and assessment workspace that turns analyst questions into source-backed BLUF cards and reviews selected evidence against ICD-203 tradecraft standards.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the FastAPI server on the workflow-provided port
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `ARCHIVED_SESSION_RETENTION_DAYS` — positive number of days to retain non-finalized archived sessions (default: `30`)
- Optional env: `ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES` — positive number of minutes between cleanup runs (default: `360`, maximum: `35791.39411666667`)

## Stack

- Python 3.12 for the API and analytical core
- React, TypeScript 5.9, Vite, and pnpm workspaces for the analyst interface and generated client
- API: FastAPI + Pydantic
- DB: PostgreSQL + SQLAlchemy/psycopg; Drizzle retains schema-migration ownership
- Analysis packages: spaCy, scikit-learn, pandas, NumPy, Trafilatura, Beautiful Soup, and lxml
- API codegen: Orval (from OpenAPI spec)
- API runtime: Uvicorn

## Where things live

- `artifacts/analyst-workbench` — analyst-facing React application
- `artifacts/api-server/src/api_server/sources.py` — Python source adapter registry and retrieval
- `artifacts/api-server/src/api_server/engine.py` — Python incident extraction and nine-standard assessment engine
- `artifacts/api-server/src/api_server/store.py` — Python persistence, cleanup, and concurrency controls
- `lib/api-spec/openapi.yaml` — source of truth for API contracts

## Architecture decisions

- External retrieval is isolated behind server-side source adapters; browser code never handles provider credentials.
- Public web adapters are hard-blocked for sessions above UNCLASSIFIED; restricted prompts must never be sent to public providers.
- Demonstration research is labeled as such and must not be represented as live-source reporting.
- Classification markings are metadata and workflow controls only; this development environment is not approved to hold classified information.
- The ICD-203 assessment provides structured analyst support, not an automated substitute for analytic review or release authority.
- Python is authoritative for backend and analytical behavior; TypeScript remains the browser UI and generated API-client language.

## Product

- Create an analysis session from an intelligence question.
- Select approved source adapters and run a research request.
- Query live proof-of-concept sources through Google News RSS, the Federal Register API, and Crossref.
- Review source provenance, reliability, relevance, key points, and BLUF cards.
- Select evidence and assess it against nine ICD-203 analytic tradecraft standards.
- Grade against six stand-in vectors and compare with placeholder historical ratings to produce a provisional up/same/down trend signal.
- Review session history, standards guidance, connector readiness, and API health.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Current retrieval output is demonstration data until an approved live source connector is configured.
- Live proof-of-concept sources are public and may be unavailable, rate-limited, incomplete, biased, or unsuitable for final judgments.
- Vector scores and trend recommendations are provisional metadata heuristics until full report content is evaluated against an approved rubric.
- Live HTTP/HTTPS reports use bounded, SSRF-protected Trafilatura/Beautiful Soup extraction. spaCy token/span rules and TF-IDF similarity support candidate incidents while deterministic date, assertion, and exact-citation checks remain authoritative.
- The spaCy pipeline uses deterministic English token and phrase rules rather than a separately downloaded statistical language model; a trained model requires its own evaluated release.
- Never log prompt text, source content, credentials, or classification-sensitive metadata in production.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
