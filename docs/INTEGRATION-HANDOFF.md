# High-side integration handoff

This is the local integration map for the existing high-side identity code. It does not reproduce target PKI implementation, credentials, network details, trust material, or policy data. Those remain in the target environment. Source transfer may proceed without on-network testing; activation remains subject to the target team's reviewed integration and runtime checks.

## Integration seams

| Concern | Local path/interface | Integration action |
|---|---|---|
| Verified identity boundary | `artifacts/api-server/src/api_server/auth.py` — `TrustedPrincipal`, `require_principal()` | Adapt the already-validated target identity result into `TrustedPrincipal(subject=<stable mapped owner ID>, provider=<reviewed provider name>)`. Construct it only after the target adapter has completed its reviewed cryptographic, issuer/gateway, freshness, replay, revocation, and trusted-hop validation. Never construct it directly from an arbitrary request header, certificate upload, email, or display name. |
| Existing route identity | `auth.py` — `require_user()`; `artifacts/api-server/src/api_server/main.py` — `Depends(require_user)` | Keep `require_user()` as the compatibility seam returning `principal.subject`; existing owner-scoped store calls depend on that stable value. Confirm the target `issuer + subject` mapping/migration before exposing historic rows. |
| PKI fail-closed gate | `auth.py` — `auth_readiness()`, `require_auth_ready()`, `require_principal()` | Replace the unconditional `PKI_NOT_CONFIGURED` result only as part of the reviewed adapter integration. PKI readiness must come from the adapter's non-secret readiness result; `require_principal()` should invoke the adapter only in `pki` mode. Invalid mode and adapter failure must remain closed. Do not add Clerk fallback. |
| Write-request protection | `auth.py` — `require_trusted_origin()` | Review this cookie-oriented origin control against the target assertion/session contract. Preserve a server-side anti-forgery/replay control appropriate to that contract; do not simply bypass the dependency for PKI writes. |
| Deployment policy | `artifacts/api-server/src/api_server/deployment.py` — `deployment_readiness()`, `require_collection_allowed()` | `DEPLOYMENT_PROFILE=restricted` already requires `AUTH_MODE=pki`; all collection is denied outside the development profile. Preserve this independent policy gate when integrating identity. Identity readiness must not enable collection. |
| Readiness | `artifacts/api-server/src/api_server/main.py` — `/api/readyz`; `artifacts/api-server/src/api_server/readiness.py` — `database_readiness()` | Add the adapter's non-secret readiness and the target policy dependencies to the readiness contract. Current checks cover deployment profile, authentication posture, and read-only database/schema access. Do not include credentials, hostnames, certificate details, subjects, claims, or network topology in responses. Liveness remains `/api/healthz`. |
| Public-source zero egress | `artifacts/api-server/src/api_server/sources.py` — calls to `require_collection_allowed()` | Guards precede public RSS, arbitrary report retrieval, DNS resolution, cache discovery, research, and demonstration generation. Keep these guards before every network/DNS/cache path. Restricted mode has no local approved-source adapter; do not repurpose a public adapter. |
| Connector visibility | `artifacts/api-server/src/api_server/main.py` — `/api/source-connectors`; `artifacts/api-server/src/api_server/sources.py` — `SOURCE_CONNECTORS` | Before enabling restricted users, apply the reviewed target policy so the public connector catalogue is not offered as usable. Register existing approved target sources through their own reviewed interface rather than changing a public connector's label. |
| Authorization policy | Route dependencies in `main.py`; owner predicates in `artifacts/api-server/src/api_server/store.py` | Insert the existing target role/compartment/source-entitlement decision after verified identity and before route/store/source action. Keep the current owner predicate as an additional constraint. The browser's role, classification, connector, and object inputs are untrusted. No generic target policy interface exists in this source baseline. |
| Safe audit metadata | `main.py` — `deployment_and_audit` middleware | Current local logging records authenticated route template, method, and status without subject, cookie, query, or object ID. Connect target audit through its reviewed sink/schema; do not add prompts, source content, tokens, certificate data, PINs, or private keys. |
| Browser PKI boundary | `artifacts/analyst-workbench/src/PkiApp.tsx`, `vite.config.ts`, `scripts/verify-pki-build.mjs` | The PKI build currently presents setup guidance and excludes Clerk/font identity paths. Integrate only the target-approved browser/session flow. Do not add certificate upload, private-key export, or PIN storage. Re-run the isolated PKI build-graph test. |

## Recommended adapter shape

Keep target-specific verification in a small server-side module owned and reviewed with the existing integration. Its public surface should be limited to:

1. a request-to-`TrustedPrincipal` operation that either returns a validated, mapped principal or raises a closed authentication error; and
2. a non-secret readiness operation consumed by `auth_readiness()` and `/api/readyz`.

The module must not return raw credentials, certificate chains, PINs, private keys, unrestricted claims, or browser-supplied identity. Authorization inputs should be normalized from the target's authoritative policy source and evaluated separately from identity. This document intentionally does not prescribe or reproduce the target protocol.

## Local tests to retain

- `artifacts/api-server/tests/test_auth.py` — auth-mode mismatch, PKI fail-closed behavior, origin checks, JWT validation, and owner isolation.
- `artifacts/api-server/tests/test_deployment_security.py` — restricted collection makes no HTTP/DNS attempt, readiness/liveness separation, read-only database readiness, unsafe-address rejection, and safe audit metadata.
- `artifacts/api-server/tests/test_contracts.py` and `test_current_events.py` — route dependency overrides and restricted/public behavior.
- `artifacts/analyst-workbench/scripts/verify-pki-build.mjs` plus the workbench auth-mode/readiness tests — PKI artifact excludes Clerk and conflicting modes fail.
- `scripts/transfer/package.test.mjs` — source archive allowlist, secret-pattern checks, deterministic metadata, and safe verification behavior.

Add focused adapter tests with synthetic non-secret fixtures for: valid identity, missing assertion, invalid signature/trust, wrong issuer/audience, expired/not-yet-valid assertion, replay, revoked/unknown status under the approved policy, untrusted hop/header spoofing, mapping miss/collision, and adapter outage. Add role/compartment/source-entitlement allow/deny cases at the route and object boundaries. Do not copy production credentials, certificates, subjects, endpoints, or network details into this repository.

## Target runtime checks

After transfer and reviewed integration, the target team should run its existing PKI validation suite and exercise `/api/readyz`, principal mapping, owner/role/compartment/source isolation, revocation, audit delivery, and network policy in that environment. These runtime checks govern activation, not source-package eligibility. Failure or inability to perform on-network testing here is not a source transfer blocker and is not evidence that the target integration failed.

## Current local evidence

The latest reported local run passed **109 focused runtime tests** and **7 transfer-package tests**. This demonstrates the tested source baseline only; it does not test the external adapter or target network.

Reported scans:

- Dependency scan: **0 critical, 0 high, 2 moderate** findings. Both moderate findings are the same `Vitest`/`@vitest/mocker` advisory, `GHSA-82fw-gwwq-j7x9`; the available fix requires the major line `>=4.1.11`.
- Static scan: **0 findings**.
- Dataflow scan: **0 findings**.

These are scoped scan results, not a claim of no vulnerabilities and not an exhaustive Python dependency or source audit. The Vitest major upgrade is deferred for the accelerated source transfer to avoid an unreviewed framework migration. Vitest and `@vitest/mocker` are development/test dependencies; do not expose Vite/Vitest test or development servers to untrusted networks, and perform the major upgrade plus regression review in the next normal hardening cycle.