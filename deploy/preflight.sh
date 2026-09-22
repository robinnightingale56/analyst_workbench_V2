#!/bin/sh
# Read-only host capability check. Does not install, build, connect to DB, or start services.
set -eu
failed=0
need() {
  if command -v "$1" >/dev/null 2>&1; then printf 'OK command: %s\n' "$1"
  else printf 'MISSING command: %s\n' "$1"; failed=1; fi
}
for tool in node pnpm uv tar sha256sum curl psql pg_dump pg_restore nginx systemctl; do need "$tool"; done
printf 'Target: '; uname -sm
if command -v node >/dev/null 2>&1; then
  node -e 'const m=Number(process.versions.node.split(".")[0]); if(m<22){console.error("Node 22+ required by transfer baseline");process.exit(1)}' || failed=1
fi
if command -v pnpm >/dev/null 2>&1; then
  [ "$(pnpm --version)" = "10.26.1" ] || { echo 'MISMATCH pnpm: expected 10.26.1'; failed=1; }
fi
if command -v python3 >/dev/null 2>&1; then
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)' || { echo 'Python 3.12+ required'; failed=1; }
else echo 'MISSING command: python3'; failed=1; fi
echo 'MANUAL GATES: OS/architecture/libc, package staging, PostgreSQL version/extensions, backup restore, TLS/PKI, DNS, egress policy and operator approvals remain unverified.'
echo 'Workspace overrides currently target Linux x64 glibc; other platforms require reviewed lockfile changes and restaging.'
exit "$failed"