# Analyst Workbench

Analyst Workbench is a source-backed research and assessment application. It lets an analyst create a research session, collect material from configured source adapters, select evidence, and review an assessment against ICD-203 analytic tradecraft standards.

This repository is one pnpm monorepo containing the web application, API server, shared API contracts, database schema, and the component-preview tooling used during development.

## Repository structure

```text
artifacts/
  analyst-workbench/  React and Vite analyst interface
  api-server/         FastAPI server and analytical engine
  mockup-sandbox/     Canvas component-preview server
lib/
  api-spec/           OpenAPI source of truth and code generation
  api-client-react/   Generated React API client
  api-zod/            Generated Zod API schemas
  db/                 Drizzle-managed PostgreSQL schema
scripts/              Shared validation and maintenance scripts
```

## Technology

- Node.js 24 and pnpm workspaces
- React, TypeScript, and Vite
- Python 3.12, FastAPI, and Uvicorn
- PostgreSQL with SQLAlchemy/psycopg at runtime and Drizzle for schema ownership
- spaCy, scikit-learn, pandas, NumPy, Trafilatura, Beautiful Soup, and lxml

## Configuration

The API requires:

```text
DATABASE_URL
```

Optional archive-cleanup settings:

```text
ARCHIVED_SESSION_RETENTION_DAYS
ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES
```

Authentication defaults to `AUTH_MODE=clerk`, preserving the current Clerk
development login. Replit provisions
`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and
`VITE_CLERK_PUBLISHABLE_KEY`; do not add them to an environment file. The API
derives its trusted Clerk issuer/JWKS URL from the provisioned publishable key,
so no additional issuer secret is required. `CLERK_JWT_ISSUER` is an optional
HTTPS override for a custom instance and `CLERK_JWT_AUDIENCE` is optional when
the instance issues an audience claim. Browser requests use the same-origin
Clerk `__session` cookie — never add a browser bearer-token bridge.

For cookie-authenticated writes, configure `ALLOWED_ORIGINS` with a
comma-separated list of complete trusted browser origins when self-hosting
(for example, `https://workbench.example`). Replit deployments automatically
use the provisioned `REPLIT_DOMAINS` origin list. The same trusted-origin set
validates Clerk's `azp` claim, browser `Origin` on mutations, CORS when needed,
and the public host used by the Clerk proxy. The production platform injects
`VITE_CLERK_PROXY_URL` during Clerk web builds; keep the canonical `proxyUrl`
wiring in the legacy Clerk client and do not hardcode or replace it.

`AUTH_MODE=pki` is an intentionally blocked PKI-readiness posture, not
certificate authentication: protected routes return `503 PKI_NOT_CONFIGURED`
and the browser shows deployment guidance only. It never falls back to Clerk
cookies or identity headers. The Vite build derives `VITE_AUTH_MODE` from the
same `AUTH_MODE` and rejects a conflict. See
[PKI deployment requirements](docs/PKI-DEPLOYMENT.md) before considering a PKI
deployment.

### Analysis-session ownership migration

`analysis_sessions.owner_id` is added idempotently at API initialization.
New user-created rows require a nonblank trusted-principal ID (the current
Clerk user ID) and are queried and updated with that owner ID. Existing rows
are preserved but remain unassigned:
on PostgreSQL they are marked `LEGACY_UNASSIGNED`; on SQLite their null
`owner_id` makes them invisible to every user. They are deliberately not
claimed by the first person to sign in. The migration creates the
owner/archive index without dropping data. Back up production databases before
any schema migration as part of normal operational practice.

Do not commit environment files, credentials, provider tokens, or database connection strings. Supply them through your local environment, GitHub Actions secrets, or Replit Secrets.

## Install

Install JavaScript dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

Install Python 3.12 dependencies from `pyproject.toml` and `uv.lock` with your preferred locked Python environment manager. On Replit, the workspace environment is provisioned automatically.

For example, with uv:

```bash
uv sync --frozen
```

## Run locally

Start PostgreSQL and provide `DATABASE_URL`, then run the API and web app in separate terminals:

```bash
pnpm --filter @workspace/api-server run dev
```

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/analyst-workbench run dev
```

The API defaults to port `8080` when `PORT` is not set. The web application expects API routes under `/api`; production and Replit use the repository's path router for this.

## Validate

Run the GitHub CI-equivalent validation from the repository root:

```bash
pnpm run validate
```

Run the full type check:

```bash
pnpm run typecheck
```

Run the API tests:

```bash
pnpm --filter @workspace/api-server test
```

Run the Analyst Workbench tests:

```bash
pnpm --filter @workspace/analyst-workbench test
```

Run the Canvas port contract:

```bash
pnpm --filter @workspace/mockup-sandbox run validate:port
```

Build all workspace packages:

```bash
pnpm run build
```

The PostgreSQL compatibility contract is destructive by design but executes in an isolated temporary schema:

```bash
pnpm --filter @workspace/api-server run test:postgres
```

That database-specific contract requires a running PostgreSQL instance and a valid `DATABASE_URL`, so it is maintained as a separate validation from the database-independent GitHub workflow.

## API contract changes

`lib/api-spec/openapi.yaml` is the source of truth. After changing it, regenerate clients and schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Commit the regenerated outputs with the contract change.

## Product status

This is an MVP-oriented analyst-support tool, not an approved classified system or an automated release authority.

- Public source adapters are proof-of-concept integrations and may be incomplete, rate-limited, biased, or unavailable.
- Restricted prompts must never be sent to public providers.
- Classification markings are workflow controls only; this environment is not approved to hold classified information.
- Vector scores and trend recommendations are provisional until validated against an approved rubric and full source content.
- Analysts remain responsible for reviewing evidence, sourcing, assumptions, and judgments.

## Replit

Replit workflow and deployment configuration lives in `.replit`, while each artifact's service and path routing are registered under its `.replit-artifact/` directory. Use the **Project** workflow to run the registered validation set.