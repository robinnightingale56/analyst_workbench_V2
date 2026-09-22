# Local transfer verification

This records checks performed for the source-transfer preparation. It does
not cover execution of the existing target-side integration code.

## Completed locally

- Python API suite: 133 passed; 5 PostgreSQL integration tests were not enabled.
  The API suite used an isolated temporary SQLite database.
- Frontend suite: 41 passed.
- Transfer archive tests: 7 passed, including exclusions, reproducibility,
  secret-detection fixtures, symlink rejection, and tamper detection.
- Full workspace type checks and production builds passed.
- PKI-only production bundle contract passed, including exclusion of Clerk
  and invalid/conflicting authentication configuration rejection.
- Live development API liveness, authentication configuration, and readiness
  endpoints returned HTTP 200. Readiness included successful database checks.
  This is not evidence of a PostgreSQL integration test or target deployment.
- Application service port conflicts were cleared and managed API/web
  services restarted with current code.
- Source-transfer allowlist and content checks passed.

## Scanner results and known caveat

The dependency scanner reported zero critical/high findings and two moderate
findings for the same advisory, `GHSA-82fw-gwwq-j7x9`, affecting the development
dependencies `vitest` and `@vitest/mocker` at 3.2.7. The reported fix is
Vitest 4.1.11 or later and requires a reviewed major-version upgrade.
Do not expose test servers. This test-tool upgrade is deferred, not resolved.

The static-code and dataflow scanners returned no findings in their completed
scans. These results are not proof of vulnerability absence, exhaustive Python
dependency coverage, approval of licenses, or an operational authorization.

## Target-side continuation

Use `INTEGRATION-HANDOFF.md` to attach the identity and collection code already
available on the target network. Stage dependencies for its actual runtime
and architecture. The archive contains source and a lockfile inventory, not
dependency binaries, certificate material, user data, or Git history.

The restricted profile intentionally remains unready until the target
authentication integration is implemented. Keep that boundary intact while
adapting the approved connectors and authorization rules.