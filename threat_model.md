# Threat Model

## Project Overview

Analyst Workbench is a Python 3.12/FastAPI and React/TypeScript application that stores analyst questions, collected source material, incident reviews, and provisional ICD-203 support in PostgreSQL. The browser uses generated API clients; the API performs retrieval and analysis with deterministic NLP rules and metadata heuristics.

The repository is a public-network prototype, not an accredited classified system. Its current public adapters call Google News, Bing News, the Federal Register, Crossref, and public report URLs. Those adapters are not PKI integrations and are not approved high-side sources. `AUTH_MODE=pki` is intentionally unconfigured and fail-closed: it does not authenticate a certificate or grant application access. Classification labels are workflow metadata, not evidence that the environment may hold classified information. Heuristic vector and trend outputs remain provisional until validated against an approved rubric.

## Assets

- **Analyst identity and authorization context** — immutable issuer/subject identity, mapped application principal, roles, compartments, source entitlements, and session state. A false or stale mapping can expose another analyst's work or an unauthorized source.
- **PKI material and authenticators** — trust anchors, revocation data, certificate assertions, analyst tokens, and gateway signing/verification material. Analyst private keys and PINs must remain under approved token/workstation controls and must never be exported to, uploaded to, or stored by this application.
- **Analysis records** — prompts, classification markings, source content and URLs, provenance, exact evidence spans, judgments, archive state, and historic owner IDs. These records can reveal sensitive questions, holdings, methods, or assessments.
- **Source and collection controls** — connector allowlists, source entitlements, chosen collection topology, request metadata, and egress policy. Prompt or content leakage to a public provider is a primary risk.
- **Exports and transfer packages** — printable products and any future transfer archive, including manifests, markings, integrity metadata, and release decisions. An export can cross a security boundary even when the source session was properly authorized.
- **Audit evidence** — authenticated actor, authorization decision, source access, mutation, export/transfer attempt, administrative change, and revocation outcome. Audit records require integrity protection and controlled access.
- **Application and platform secrets** — database credentials, identity-provider/gateway verification configuration, audit-sink credentials, and service keys.
- **Availability and integrity of dependencies** — PostgreSQL, approved identity and revocation services, audit sink, offline package/browser assets, and analysis libraries. Failure must not silently weaken authentication, authorization, logging, or egress controls.

## Trust Boundaries

- **Analyst workstation/token to identity termination** — certificate use occurs at an approved workstation collector, broker, or mTLS-terminating gateway selected by target security and platform owners. The application must not collect a certificate upload, private key, or PIN, and must not trust raw browser identity headers.
- **Identity termination to FastAPI principal** — only a cryptographically verified, freshness-bounded assertion from the selected approved identity pattern may create `TrustedPrincipal`. Issuer, audience, subject, replay, lifetime, revocation, and trusted-hop checks cross this boundary.
- **Browser to API** — the browser and all of its role, classification, connector, object ID, and export inputs are untrusted. Authentication and authorization must be enforced by the API for every protected operation.
- **Principal to owner/role/compartment/source entitlement** — authentication alone is insufficient. Immutable identity mapping, migration of existing `owner_id` values, role checks, compartment membership, and source entitlements are separate server-side decisions.
- **API to PostgreSQL** — prompts, evidence, ownership, and assessment state cross into persistent storage. Queries and mutations must preserve owner and compartment predicates, transaction integrity, and retention controls.
- **Restricted processing to any network egress** — public source adapters, Clerk, fonts, telemetry, package registries, DNS, and other external services are outside the restricted boundary. A restricted profile requires deny-by-default egress and must not expose prompt, content, classification-sensitive metadata, or credentials.
- **API to approved source infrastructure** — if a source collector is authorized later, its protocol, endpoint, trust, source identity, and entitlement contract must be supplied by the target owner. A generic/public adapter must never be relabeled as approved.
- **Application to audit sink** — security events leave the application trust domain. Delivery, integrity, backpressure, redaction, retention, and fail-closed/fail-safe behavior require an approved contract.
- **Application to export/transfer destination** — generated products cross from application custody to removable media, a transfer service, or another domain. Release authorization, sanitization, integrity, receipt, and destination approval are independent gates.
- **Build environment to deployed restricted environment** — development plugins, public dependencies, Clerk mode, SQLite, and public-network assumptions must not leak into the restricted artifact. Offline dependency provenance and the exact deployed configuration must be reproducible.

## Scan Anchors

- Production API entry and route authorization: `artifacts/api-server/src/api_server/main.py`, `auth.py`, `store.py`, and `db.py`.
- Highest-risk network code: `artifacts/api-server/src/api_server/sources.py` and `feed_coordination.py`; public adapters are unsuitable for restricted collection.
- Browser/auth build boundary: `artifacts/analyst-workbench/vite.config.ts`, `src/ClerkEntry.tsx`, `src/PkiApp.tsx`, and `scripts/verify-pki-build.mjs`.
- Contracts and deployment constraints: `lib/api-spec/openapi.yaml` and `docs/PKI-DEPLOYMENT.md`.
- Public surface currently includes liveness and auth-mode posture; analysis, connector, and heuristic routes are authenticated. There is no implemented PKI/admin/role/compartment adapter.
- Dev-only or non-authoritative surfaces include SQLite, Vite development plugins, synthetic demonstration records, contract fixtures, and provisional heuristic ratings.

## Threat Categories

### Spoofing

An attacker could forge an identity header, replay a gateway assertion, exploit a stale certificate after revocation, or cause an old Clerk artifact to contact its public identity service. The current PKI mode appropriately rejects every protected request, but it is not authentication.

Only the target-approved identity termination pattern may construct `TrustedPrincipal`, after cryptographic verification of issuer/gateway, audience, subject, lifetime, replay defenses, and trusted transport/hops. Revocation behavior and outage policy must be explicit and tested. Open signup, email/display-name auto-linking, certificate upload, raw forwarded identity headers, and fallback to Clerk are prohibited. The browser must never receive or retain a private key or PIN.

### Tampering

Client-supplied owner IDs, roles, compartments, source IDs, classification labels, evidence selections, export flags, or connector status could be changed to expand access or alter an assessment. Transfer packages and audit events could also be modified after creation.

The API must derive identity and authorization context server-side, validate all object relationships, preserve optimistic-concurrency checks, and bind every read/write to owner plus applicable compartment and source entitlement. Existing exact-citation/finalization checks must remain server-authoritative. Transfer artifacts require canonical manifests, integrity verification, markings, and destination receipt; audit storage must be append-only or equivalently integrity protected.

### Repudiation

The current application does not provide an approved security audit sink. Application logs alone cannot prove who accessed a source, changed a record, attempted an export, or was denied after revocation.

Sensitive reads, mutations, authorization decisions, connector use, administrative mapping changes, exports, and transfer lifecycle events must emit an authenticated actor, stable principal, timestamp, request/correlation ID, action, object, decision, and policy basis without logging prompt text, source content, credentials, private material, or unnecessary classification-sensitive metadata. Delivery failure behavior, retention, review, time synchronization, and incident ownership must be approved and exercised.

### Information Disclosure

Restricted prompts or source content could leave through a public adapter, Clerk, fonts, telemetry, DNS, errors, logs, browser storage, exports, or cross-user/cross-compartment queries. Marking a session `SECRET` or `TS` does not itself establish a protected boundary. Printable HTML is an export surface even if no download API exists.

A restricted profile must enforce zero unauthorized data egress at the network layer and in application policy, expose no public connector as usable, use only explicitly entitled approved sources, and fail readiness when those invariants are absent. Responses and database queries must be owner/role/compartment/source scoped. Secrets and sensitive content must not appear in logs or readiness output. Export/print/clipboard/transfer paths require independent authorization, marking, sanitization, and audit; analyst tokens must have no export capability.

### Denial of Service

External fetches, large reports, NLP work, database contention, revocation checks, audit backpressure, and dependency outages can exhaust workers or make authorization state unverifiable. Offline deployments can also fail when an artifact attempts to fetch a package, font, key, or model.

Requests and documents must remain bounded by size, count, redirect, and timeout limits. Restricted readiness must cover database, identity/revocation, authorization policy, audit sink, approved source infrastructure, and offline dependencies rather than report liveness alone. Loss of identity, revocation, entitlement, or required audit assurance must not degrade to permissive access. Capacity, retry, queue, and recovery behavior require target-environment tests.

### Elevation of Privilege

The current owner predicate separates users, but it does not implement target roles, compartments, source entitlements, administrative separation, or release authority. A principal-mapping error, omitted predicate, stale entitlement, or generic connector could let an analyst read another compartment, collect from an unapproved source, or export without authority.

Authorization must be deny-by-default and server-side at route, object, source, and action levels. Immutable `issuer + subject` mapping must be migrated and reconciled without auto-linking; legacy records must remain inaccessible until explicitly mapped. Role, compartment, source entitlement, administrative mapping, analyst token, and release/export authorities must be distinct and tested with negative cases. No implementation may invent an adapter, claim, role, compartment, source, or accreditation decision that the target owners have not supplied.