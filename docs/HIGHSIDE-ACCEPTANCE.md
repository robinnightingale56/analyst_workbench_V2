# High-side acceptance readiness matrix

## Decision posture

This checklist is authorized as a planning and handoff artifact only. It is **not** an approval to process classified information, connect to a classified network, use a target PKI, or operate a high-side service. Target environment, identity, PKI, role, compartment, source, audit, transfer, network, and accreditation details have not been supplied. Consequently, no row below can establish operational authorization.

Current facts:

- The repository is a public-network Python/FastAPI and React prototype.
- `AUTH_MODE=pki` is unconfigured and fail-closed. It performs no certificate authentication and every protected API route returns `503 PKI_NOT_CONFIGURED`.
- The PKI React entry is provider-free setup guidance, not a sign-in implementation.
- Existing live connectors are public adapters, not PKI or approved high-side source adapters.
- The target team already has high-side integration code awaiting connection to the local seams. It is not reproduced in this repository and has not been exercised from this environment.
- Classification values are workflow metadata, not a security-domain enforcement mechanism.
- Vector ratings and trend recommendations are provisional heuristics pending approved-rubric validation.
- Restricted-profile zero-egress/readiness code, transfer tooling, and Linux deployment templates are present in the handoff workspace. They remain **pending verification** until reviewed and tested in the intended deployment process.

### Status meanings

- **Implemented / pending verification** — code or artifact is reported/present, but target acceptance evidence has not been completed.
- **Partial** — a useful control exists but does not satisfy the high-side requirement.
- **Pending** — design input, implementation, or test evidence is outstanding.
- **Blocked** — a named target-owner decision or external capability is required.
- **Not implemented** — the repository intentionally has no access-enabling implementation.

## Readiness matrix

| Gate | Current status | Acceptance requirement | Required evidence | Acceptance owner |
|---|---|---|---|---|
| Operational authorization and boundary | **Blocked** | Define system boundary, data types/classification, hosting, connected networks, users, threat assumptions, control inheritance, and authorization path. | Approved architecture and data-flow diagrams; boundary inventory; authorization/accreditation decision. | Authorizing Official (AO), ISSM/security owner |
| PKI authentication | **External integration available; local seam remains fail-closed** | Connect the reviewed target adapter to `TrustedPrincipal`, `require_principal()`, and auth readiness without reproducing target PKI details or trusting generic request headers. | Target-side interface review; synthetic local boundary tests; target runtime validation; `503` until configured. | Identity/PKI owner, application security |
| Analyst token handling | **Target integration handoff pending** | Use the existing approved target token path. The application must have no private-key export, certificate-upload, or PIN-storage path. | Target-side token integration result; local inspection showing no private key/PIN path; failed upload/header-spoof tests. | PKI owner, endpoint engineering, security test |
| Identity termination topology | **Target-owned; local connection pending** | Connect the existing reviewed termination contract at the server-side identity boundary. The project must not invent a second adapter or assertion header. | Target-owned architecture/interface approval and local adapter review; details remain outside the source package. | Enterprise architecture, network security, identity owner |
| Trust and revocation | **Target-owned; runtime verification pending** | Preserve the existing target trust, revocation, freshness, renewal, rollover, and failure policy when adapting its validated identity result. | Target validation results for valid/expired/revoked/unknown/outage cases; local fail-closed boundary tests. | PKI owner, security operations |
| Principal mapping and migration | **Pending** | Map immutable `issuer + subject` to the stable application owner identity. Preserve historic owner predicates; never auto-link by email, display name, or browser input. | Reviewed migration/reconciliation plan; duplicate/collision and rollback tests; orphan report; row-level before/after evidence. | Identity data owner, DBA, application owner |
| Role authorization | **Not implemented in local baseline; target policy connection pending** | Connect approved roles and enforce route/action permissions server-side. Authentication alone must grant no analyst, administrator, or release authority. | Target-owned role contract; local allow/deny integration tests; target runtime evidence. | Mission/product owner, security owner |
| Compartment isolation | **Not implemented in local baseline; target policy connection pending** | Connect authoritative compartment membership and bind every relevant read, write, listing, cache, and export to it. | Target-owned compartment contract; two-principal/two-compartment isolation evidence. | Data owner, security owner, application security |
| Source entitlement isolation | **Not implemented in local baseline; target policy connection pending** | Connect source entitlements independently of role/compartment. An entitled principal may use only explicitly approved source adapters. | Target-owned entitlement contract; allowed/denied source tests; audit evidence. | Collection/source owners, mission owner |
| Restricted connector inventory | **No local approved-source adapter** | Connect existing target-approved sources through reviewed interfaces. Public Google/Bing/Federal Register/Crossref/report adapters must not be relabeled or exposed as restricted sources. | Target-owned connector approval; local adapter review; destination policy and end-to-end provenance test. | Collection manager, source owner, network security |
| Restricted zero data egress | **Implemented separately / pending verification** | Restricted mode must deny public providers, Clerk, external fonts, telemetry, arbitrary URLs, and other unapproved DNS/network destinations, including startup and error paths. | Code review; deployed network-policy/firewall evidence; DNS/packet capture under startup, use, and failure tests; prompt/content canary showing no egress. | Network security, platform owner, application security |
| Deployment readiness (`/readyz`) | **Implemented separately / pending verification** | Readiness must fail unless restricted profile, authentication/revocation, authorization policy, database, audit, approved-source dependencies, and egress controls satisfy the selected design. Liveness must remain distinct. | Endpoint contract; dependency-failure matrix; automated fail-closed tests; deployment probe configuration. | Platform/SRE, security owner |
| Database and owner isolation | **Partial; DB verification queued elsewhere** | Production PostgreSQL schema/migrations must be published; owner, role, compartment, entitlement, provenance, archive, and concurrency invariants must hold across replicas. SQLite is not production evidence. | Published migration; PostgreSQL integration/isolation tests; backup/restore and concurrency results. | DBA/platform owner, application owner |
| Audit sink | **Not implemented** | Send security-relevant events to an approved, integrity-protected sink with redaction, time sync, retention, access review, alerting, and defined delivery-failure behavior. | Event schema; sink configuration; sample allow/deny/revocation/export events; tamper/access tests; failure exercise. | SOC/audit owner, security owner |
| Secrets and key custody | **Pending** | Deliver service secrets, trust material, and gateway verification keys through approved controls; prohibit source, image, browser, logs, and transfer archives. | Secret inventory; custody/rotation procedure; image/repository/log scans; rollover test. | Platform secrets owner, PKI owner |
| Offline dependencies and artifact provenance | **Pending** | Build and run without public package, font, JWKS, model, telemetry, or update fetches except dependencies explicitly approved for the topology. Pin and verify all artifacts. | Offline build/start/use test; SBOM; checksums/signatures; internal repository inventory; network capture. | Supply-chain security, platform owner |
| Linux deployment templates | **Implemented separately / pending verification** | Templates must encode least privilege, filesystem ownership, service sandboxing, environment/secret injection, network policy, probes, logging, and rollback for the chosen Linux platform. | Template review; clean-host install; configuration scan; reboot/rollback and permission tests. | Linux platform owner, security engineering |
| Heuristic/rubric validity | **Provisional** | Do not present metadata stand-ins or synthetic history as validated analytic quality. Validate outputs against an owner-approved rubric and representative adjudicated corpus. | Versioned rubric; labelled evaluation set; accuracy/error analysis; acceptance thresholds; model/rule release decision. | Analytic standards owner, independent validation lead |
| Retention, archive, backup, and recovery | **Partial** | Approve classification-specific retention, legal hold, deletion, backup encryption, restore, media handling, and finalized-record policy. | Policy; configured values; purge/hold and backup/restore tests; audit trail. | Records/data owner, DBA, security owner |
| Export controls | **Pending / deny until approved** | Separate viewing from print, clipboard, download, API export, and release authority. Analyst authentication or token possession must not imply export authority. | Export inventory; release-role policy; browser/API negative tests; marking/sanitization and audit evidence. | Data/release authority, security owner |
| Transfer workflow | **Implemented separately / pending verification** | Meet the separate transfer requirements below; transfer tooling alone does not authorize a destination or movement. | Reviewed archive/manifests; destination approval; integrity and receipt tests; operator procedure. | Cross-domain/transfer authority, data owner |
| Security and acceptance testing | **Pending** | Execute the handoff suite below in the representative target environment and resolve findings. | Signed test plan/results, versions/config hashes, findings and dispositions, residual-risk acceptance. | Independent security assessor, AO delegate |

The queued database setup work is tracked elsewhere and is not duplicated by this document.

## Local verification status

The latest reported local run passed **109 focused runtime tests** and **7 transfer-package tests**. This is source-baseline evidence, not target-network or PKI acceptance.

- Dependency scan: **0 critical, 0 high, 2 moderate** findings. The two moderate results are the same `Vitest`/`@vitest/mocker` advisory, `GHSA-82fw-gwwq-j7x9`; remediation requires the major line `>=4.1.11`.
- Static scan: **0 findings**.
- Dataflow scan: **0 findings**.

The scan statements are scoped results, not a claim of no vulnerabilities or an exhaustive Python audit. The Vitest major upgrade is deferred for this accelerated source transfer to avoid an unreviewed test-framework migration. Vitest and `@vitest/mocker` are development/test dependencies; Vite/Vitest development or test servers must never be exposed to untrusted networks. Upgrade and regression review remain a post-transfer hardening action.

Source packaging does not require this environment to reproduce the existing target PKI or perform on-network tests. Those checks gate target activation after reviewed integration; they are not source-transfer blockers. See `docs/INTEGRATION-HANDOFF.md`.

## Mandatory handoff tests

All tests require exact build/configuration identifiers and retained evidence. A passing prototype unit test is not a target-environment approval.

1. **Analyst token and authenticator custody**
   - Authenticate with the target-approved analyst token through the selected topology.
   - Verify the browser/application has no certificate-upload, private-key import/export, or PIN persistence path.
   - Inspect process memory handling, browser storage, logs, network traces, and transfer/export artifacts for PIN/private-key material.
   - Reject forged browser identity headers, an untrusted terminating host, a replayed assertion, and direct bypass of the selected termination component.

2. **Topology and adapter contract**
   - Record whether the approved choice is a workstation collector, identity broker, or approved mTLS gateway.
   - Verify every trusted hop, assertion signature, issuer, audience, lifetime, replay control, and transport binding.
   - Demonstrate that no generic header, public connector, or invented adapter can create a principal or source entitlement.

3. **Principal mapping migration**
   - Reconcile each intended legacy `owner_id` to immutable `issuer + subject` under dual review.
   - Test duplicate subjects, changed email/display name, orphaned records, rollback, retry/idempotency, and a malicious collision.
   - Verify unmapped records remain inaccessible and historic ownership/audit references are preserved.

4. **Role, compartment, and source entitlement isolation**
   - Use at least two principals, two roles, two compartments, and two differently entitled sources.
   - Exercise list, get, create, mutate, assess, archive, cache, current-event, connector-discovery, print/export, and transfer paths.
   - Verify every cross-role, cross-compartment, cross-owner, and unentitled-source attempt is denied and audited without leaking object existence or content.

5. **Revocation and lifecycle**
   - Test valid, expired, not-yet-valid, revoked, unknown-status, malformed-chain, wrong-policy, and wrong-issuer certificates/assertions.
   - Measure propagation after user disablement, role/compartment/source removal, certificate revocation, key rollover, and session termination.
   - Exercise OCSP/CRL/identity-service outage and stale-cache cases against the approved fail behavior.

6. **Audit sink**
   - Correlate authentication, authorization allow/deny, mapping administration, source use, record mutation, export/transfer, and revocation events.
   - Confirm redaction of prompts, source content, credentials, private material, and unnecessary sensitive metadata.
   - Test sink outage/backpressure, clock skew, duplicate delivery, tamper resistance, retention, alerting, and reviewer access.

7. **Restricted egress and approved sources**
   - Start, authenticate, browse, research, assess, fail dependencies, and shut down while capturing DNS and network traffic.
   - Use canaries in prompt/content and verify none reaches Clerk, public adapters, fonts, telemetry, package services, arbitrary URLs, or any unapproved destination.
   - Verify only named, owner-approved source adapters appear and operate; do not substitute demonstration or public adapters.

8. **Readiness and offline dependencies**
   - Remove each required dependency individually: database, identity termination, revocation, policy/entitlement data, audit sink, approved source service, DNS/network policy evidence, and offline asset/package source.
   - Confirm `/readyz` fails closed with non-secret diagnostics while liveness remains semantically distinct.
   - Build, install, start, authenticate, and execute core workflows with public internet unavailable.

9. **Heuristic and rubric validation**
   - Freeze the approved rubric and representative adjudicated corpus.
   - Compare incident extraction, exact citations, provisional vectors, and trend language to human adjudication; report false positives/negatives and subgroup/source effects.
   - Verify provisional and synthetic values cannot be mistaken for validated historical ratings or release-authoritative judgments.

10. **Export and transfer denial**
    - Give an analyst valid authentication, record access, and normal analytic permissions but no export/release entitlement.
    - Verify print, clipboard, browser save, download, API/export endpoints, generated archive, and transfer initiation are denied or controlled as approved and each attempt is audited.

## Transfer requirements

These requirements are separate from application readiness and PKI authentication. No transfer may occur until the cross-domain/transfer authority approves the source domain, destination domain, data type, classification, and method.

- **Authority and destination** — identify the releasing official, transfer operator, approved destination/system, receiving custodian, permitted classification/compartments, and case/ticket authorization.
- **Content minimization and review** — include only approved records and dependencies; exclude application secrets, credentials, private keys, PINs, database dumps, caches, logs, temporary files, and unrelated source content. Apply required human release/sanitization review.
- **Archive format** — use the approved deterministic archive format and naming convention; prevent path traversal, links/device files, ambiguous encodings, and executable surprises. State size/file-count limits.
- **Manifest and markings** — enumerate every file with path, size, cryptographic digest, classification/handling markings, source session/version, tool version, creation time, and approving identities as policy permits.
- **Integrity and authenticity** — generate and verify approved digests/signatures outside mutable archive content; protect signing keys separately; verify before movement and after receipt.
- **Media and transport** — use approved media, encryption, custody, malware/content inspection, write protection, labeling, inventory, transport, storage, sanitization, and destruction procedures.
- **Import safety** — quarantine and validate manifests, signatures, paths, types, sizes, markings, malware results, schema versions, and duplicate/conflict behavior before ingestion. Never auto-execute imported content.
- **Receipt and reconciliation** — require destination receipt, digest reconciliation, import result, exception handling, and dual-control evidence where mandated.
- **Audit and retention** — record authorization, exporter, release reviewer, operator, source/destination, manifest identity, timestamps, result, and receipt without duplicating sensitive content into the audit sink.
- **Failure behavior** — incomplete review, unknown destination, invalid signature/digest, marking mismatch, scan failure, partial copy, or missing receipt must block completion and preserve evidence for incident handling.

Transfer scripts or archive generation can demonstrate mechanics only. They cannot select a destination, authorize release, or certify cross-domain compliance.

## Target activation evidence (not source-transfer blockers)

| Activation item | Owner needed | Acceptance evidence / exit criterion |
|---|---|---|
| Target security domain and accreditation basis are unspecified. | AO, ISSM, system owner | Approved boundary, data classification/handling profile, inherited controls, assessment and authorization plan. |
| Existing identity termination code is not connected to the local `TrustedPrincipal` seam. | Enterprise architecture, PKI/identity owner, application security | Reviewed adapter connection and target-owned interface/runtime evidence; no target secrets or topology details need enter this repository. |
| Target PKI trust/revocation behavior cannot be exercised from this environment. | PKI owner | Target-side valid/expired/revoked/unknown/outage and rollover results under the existing approved policy. |
| Target claims, roles, compartments, source entitlements, and lifecycle authorities are not connected to the local baseline. | Mission/data owner, identity governance, collection owners | Reviewed local connection to the target-owned authorization contract plus provisioning/deprovisioning tests. |
| Legacy owner-to-principal reconciliation is not represented in the local baseline. | Identity data owner, DBA, application owner | Dual-reviewed target mapping process, collision/orphan disposition, rollback and signed migration results. |
| Target-approved restricted source contracts are not connected to the local baseline. | Collection manager, source owners, network security | Reviewed adapter connection, source authorization, entitlement behavior, destination policy and provenance results. |
| Target audit sink and failure policy are not connected to the local baseline. | SOC/audit owner, security owner | Reviewed sink connection, event/redaction/retention behavior, and successful delivery-failure exercise. |
| Zero-egress implementation lacks target network verification. | Network security, platform owner | Deployed deny-by-default policy plus DNS/packet-capture evidence covering startup, normal use, and failures. |
| Restricted `/readyz` implementation lacks accepted dependency contract and tests. | Platform/SRE, security owner | Approved readiness dependency list, probe configuration, per-dependency failure results, non-secret output review. |
| Offline build/runtime supply chain is not approved. | Supply-chain security, platform owner | Internal repositories/media, SBOM, pinned hashes/signatures, vulnerability disposition, internet-disconnected build/run evidence. |
| Linux hardening target is unspecified. | Linux platform owner, security engineering | Approved OS/baseline, service account and filesystem/network controls, clean-host install and configuration-scan evidence. |
| Export/release authorities and browser controls are undefined. | Data owner, release authority, endpoint security | Export policy and entitlement, print/clipboard/download controls, negative analyst-token tests, audit evidence. |
| Transfer route, destination, media, and release process are unspecified. | Cross-domain/transfer authority, data owner | Approved transfer plan satisfying the separate requirements, representative end-to-end receipt and reconciliation. |
| Heuristic acceptance rubric and adjudicated corpus are absent. | Analytic standards owner, independent validation lead | Versioned rubric/corpus, thresholds, validation report, limitations, and signed release decision. |
| PostgreSQL setup needed for current verification is queued in the existing database task. | Existing database-task owner, DBA/platform | Published schema/setup and successful PostgreSQL verification evidence; no duplicate implementation task from this checklist. |

Until every applicable blocking gate has accepted evidence and the AO grants authorization, the deployment remains unapproved and must not process classified information.