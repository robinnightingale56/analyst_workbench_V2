# Target preparation, installation and recovery runbook

## Required approvals and target facts

This Linux/systemd/nginx deployment is a **review template**, not an applied
host change. No Docker path is supplied. The source release is not a full
offline dependency bundle. Resolve OS/version, CPU, libc, Python, Node, pnpm,
PostgreSQL and extensions, DNS/TLS, storage, service identity, logging,
retention, internal registries, egress policy and backup ownership first.
See `PKI-DEPLOYMENT.md` and the acceptance documentation shipped with the
reviewed source. Unknown PKI cannot be replaced by trusting browser headers.

Run the read-only capability check as a normal user:

```sh
sh deploy/preflight.sh
```

Baseline: Node 22+, pnpm 10.26.1, Python 3.12+, an approved uv version, Linux
with systemd/nginx and PostgreSQL client tools. A version presence check is
not a compatibility or security certification. Current workspace overrides
exclude many native packages except Linux x64 glibc. ARM, musl and other
targets require reviewed manifest/lockfile changes on a matching staging
host; do not assume copying a developer's `node_modules` will work.

## Dependency staging by administrators

On an approved connected staging host matching target OS/CPU/libc/runtime,
verify the source first. Provision approved internal npm/Python registries,
CA trust and registry authentication **outside** source and without shell
history containing credentials. Lockfile integrity does not establish trust.
Inventory native wheels, npm optional platform packages, lifecycle-script
requirements, compiler/system libraries and any separately approved NLP
model/data resources. No model download or public source connector is
authorized merely by installing the app.

Administrators may use `pnpm fetch --frozen-lockfile` against an approved
registry and `uv sync --frozen` to populate managed caches on that matching
host, then validate complete installation in a clean isolated target-like
machine. Include build/test dependencies, not only production dependencies:
Vite and workspace toolchains are needed for the PKI build. Registry URLs in
lockfiles may need a reviewed mirror strategy. Preserve pnpm's release-age
and lifecycle-script policy; do not disable protections to make staging pass.
Provision uv/Node/Python/pnpm themselves as approved tools, not implicit
downloads from the target.

An internal registry installation may use normal frozen installs under its
approved network policy. An offline cache installation may use:

```sh
pnpm install --offline --frozen-lockfile
UV_OFFLINE=1 UV_PYTHON_DOWNLOADS=never uv sync --frozen --offline
```

These commands are conditional on fully staged caches, platform artifacts,
system libraries and interpreters. They **fail** when anything is missing;
do not retry on public internet from the target. A populated cache on this
workspace is not evidence of a complete air-gapped install. Record cache/
registry provenance, licenses, checksums and isolated-install results as a
separate transfer deliverable. Never copy credentials with those caches.

## Build and install (administrator-executed, after approval)

1. Verify/extract using `TRANSFER-SOURCE.md` into a versioned release path.
   Install dependencies using the approved staging strategy.
2. Build and verify the PKI-only frontend, never reuse an old Clerk build:

   ```sh
   pnpm run typecheck:libs
   pnpm --filter @workspace/analyst-workbench run test:pki-build
   AUTH_MODE=pki DEPLOYMENT_PROFILE=restricted pnpm --filter @workspace/analyst-workbench run build:pki
   ```

   `test:pki-build` verifies a separate temporary PKI build; it does not
   authenticate the deployed build. Review the actual production output,
   record its checksum manifest/build environment, and serve only that
   reviewed `artifacts/analyst-workbench/dist/public` directory.
3. Provision a least-privileged `analyst` service account and approved
   `/var/lib/analyst` storage. Review `deploy/analyst-api.service` paths.
   Provision `/etc/analyst/runtime.env` with administrator-controlled owner/
   permissions from the non-secret `deploy/restricted.env.example`.
   Supply the production database connection separately; never put it in a
   release archive or command line. Configure approved archive-storage paths
   and policies using the backend configuration documentation.
4. Obtain a **verified restorable backup before the first process start**.
   Review backend startup schema behavior and all schema changes with the
   DBA. Startup may initialize or alter schema. No transfer script applies
   a database migration. Do not run `drizzle-kit push --force`, infer a
   migration plan from source files, or point tests at production.
5. Configure the reviewed versioned release and `current` link. The service
   uses that release's `.venv`, binds only loopback, and is read-only except
   `/var/lib/analyst`. Validate storage compatibility rather than loosening
   sandboxing without review. Apply service files with the host team's
   approved change procedure; these files are never automatically installed.
6. Review `deploy/nginx.conf`, replace the invalid example hostname, and
   provision approved TLS files out of band. Run `nginx -t` before the
   approved reload. Restrict direct API access at host/network boundaries.
   Gateway identity forwarding is not implemented by this TLS template.
   Review sensitive URL/query logging and retention before enabling access
   logs; no request body, token or certificate content should be logged.
7. After the approved service start, run:

   ```sh
   node deploy/smoke.mjs https://YOUR_APPROVED_HOST
   ```

   Expect live `/api/healthz`, `mode=pki, ready=false` from `/api/auth-mode`,
   and HTTP 503 from `/api/readyz`. This is an intentionally **unready**
   baseline, not a successful authenticated deployment. Review the readyz
   checks privately: unavailable DB/invalid schema must not be mistaken for
   the expected PKI blocker. The script suppresses response bodies.
   Confirm the browser displays the PKI setup boundary and makes no Clerk/
   public-font requests. Test blocked protected requests and denied public
   egress under the target's approved test plan. Do not enable real users
   until approved identity integration and acceptance are complete.

## Backup, restore rehearsal and rollback

DBA/operator actions below are a plan, not commands executed by transfer
tooling. Use named PostgreSQL services and a protected passfile/secret
manager; never embed a database password in a shell argument.

1. Stop writes/background workers using the approved maintenance procedure.
   Record release digest, schema version/state, PostgreSQL version, storage
   layout and ownership. Capture a consistent DB snapshot plus archive/data
   storage snapshot; record their relationship and timestamp.
2. With an approved `PGSERVICE` and private output directory, a DBA may use
   `pg_dump --format=custom --file=/protected/backup/database.dump`.
   Capture required roles/permissions/extensions separately under DBA
   policy. Back up non-source retained files and deployment configuration
   through the approved encrypted backup system. Private keys/secrets must
   follow their own controls. No backup enters a source transfer archive.
3. Verify backup checksums and encryption, retention, access controls,
   off-host availability and `pg_restore --list` output. A readable listing
   alone is not proof of recoverability.
4. Rehearse restore into a **new isolated nonproduction database**, with a
   separately reviewed `PGSERVICE` pointing only to that target. A DBA can
   use `pg_restore --exit-on-error --no-owner --dbname=service=APPROVED_RESTORE_SERVICE /protected/backup/database.dump`.
   Do not use `--clean` against a live database. Restore required roles/
   privileges and retained files according to the approved plan.
5. Validate row counts, ownership separation, indexes/constraints, retained
   documents and representative approved workflows. Record achieved RPO/
   RTO and operator signoff. PKI-unready smoke cannot validate historical
   owner mapping; approved identity migration remains a separate gate.
6. Rollback is not merely switching the `current` source link. Stop writes,
   assess schema compatibility, select the matching release/environment/
   data snapshot, and have the DBA approve the rollback/restore path.
   Restore only when authorized, validate in isolation first, then perform
   reviewed switchover and smoke checks. Preserve failed-release evidence
   without retaining secrets in logs.