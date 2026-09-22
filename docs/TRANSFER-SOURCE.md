# Reviewed source transfer — accelerated preparation, not certification

This package is **source only**. It is not an installable binary, full offline
bundle, accreditation, SBOM certification, license clearance, vulnerability
assessment, or proof of target readiness. Target OS, architecture, package
store, network policy, PostgreSQL configuration and PKI remain administrator
decisions. PKI mode intentionally blocks authenticated access.

## Prepare and review

Run from the repository root using Node 22+ and Git. No additional packages
are used by these tools. They do not run builds, download dependencies,
change the host, start services, or connect to a database.

1. Review the exact source changes with the owning teams. Add **only reviewed
   files** to Git's index; untracked allowlisted source blocks packaging
   until reviewed and staged (or removed from the release workspace).
   This includes new deployment/backend security files and transfer tooling.
   Prefer a reviewed commit. Do not use a blanket `git add .` on a sensitive
   workstation. Existing tracked files are read from the working tree, not
   the index. Stop concurrent edits while checking/packaging.
2. Run:

   ```sh
   node --test scripts/transfer/package.test.mjs
   node scripts/transfer/package.mjs check
   ```

3. Review the policy in `scripts/transfer/package.mjs` and source inventory.
   Relevant source, workspace manifests, lockfiles, tests, SQL migrations,
   scripts and documentation are allowlisted. Canvas source remains in the
   workspace: deleting its manifest breaks frozen workspace installation.
   All lockfile workspace importer manifests must be included.
4. Only after explicit release approval, create a **new** output path outside
   the repository (parent directory must exist):

   ```sh
   node scripts/transfer/package.mjs create /approved/export/analyst-source.tar.gz
   ```

No final release archive is created by preparation or tests. Tests create and
remove synthetic fixture archives in temporary directories.

## Package boundaries

Dot directories, environment files (except the credential-free restricted
template), credentials/private keys/certificates, DB/local data, dumps,
backups, user-upload and test-user files, attached assets, logs, dependency
trees, caches and all build outputs are excluded. `.npmrc` is the single
explicit dotfile exception: its non-secret workspace settings are scanned.
Unknown root files and file types are not copied. Review tracked source for
personal data: a filename allowlist cannot establish data provenance.
All selected symlinks are rejected, including otherwise safe symlinks;
resolved paths must stay within the repository. The archive only has regular
files; no links, device nodes or executable permissions.

Content scanning rejects common private-key delimiters, credential-bearing
URLs, provider tokens, AWS access keys, JWTs and long literal secrets.
Failures report path and rule, never the matched value. It is heuristic,
not proof of absence. Do not waive findings because they occur in tests;
rewrite synthetic fixtures to construct token-shaped test strings at runtime.
Review unsupported credential formats, encoded secrets and sensitive content
separately. Keep secrets outside the package through approved provisioning.

The archive has sorted paths, fixed timestamp/ownership/mode, deterministic
gzip and SHA-256 for each payload in `TRANSFER-MANIFEST.json`. Provenance
records the Git commit and dirty indicator, not the developer identity or
host paths. Identical selected bytes, commit and dirty state produce identical
hashes on the same Node/zlib implementation. Untracked changes contribute to
dirty state even when they are outside the allowlist and omitted. Cross-runtime compressed
byte identity is not asserted. `TRANSFER-INVENTORY.json` lists lockfile npm
identifiers and Python versions, including development/platform alternatives;
licenses are honestly `UNKNOWN`. Administrators must obtain actual package
licenses, provenance, advisory results and approvals from staged packages.

**No frontend outputs are accepted by this source packager.** Build the PKI
frontend on an approved build host after verification, as described in the
install guide. If a separate reviewed binary transfer is later required,
create a separate provenance/manifest process tied to its reviewed PKI build
and `test:pki-build` evidence; do not broaden this source allowlist to `dist`.

## Verify before extraction

Transfer the `.tar.gz` and `.sha256`. Deliver the expected SHA-256 through an
independently authenticated channel. A sidecar delivered with an archive is
corruption detection, **not authenticity**. Likewise the commit label is not
a signature. Use an independently trusted copy of the verifier:

```sh
node scripts/transfer/package.mjs verify /approved/import/analyst-source.tar.gz EXPECTED_SHA256
```

The verifier requires the external digest and checks safe names, regular-file
type, tar checksums/order, the allowlist, content rules and the complete
internal manifest; it does not extract anything. It limits decompressed input
to 512 MiB. Then list the verified archive for review and extract into a
new empty nonprivileged release directory, never over a live deployment:

```sh
tar -tzf /approved/import/analyst-source.tar.gz
tar --no-same-owner --no-same-permissions -xzf /approved/import/analyst-source.tar.gz -C /approved/empty-release
```

The extracted manifest can support later drift checks, but never use a changed
archive or untrusted verifier in place of the independently pinned digest.