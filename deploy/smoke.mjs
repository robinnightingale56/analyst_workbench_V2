#!/usr/bin/env node
// Deliberately unauthenticated fail-closed smoke check, not an acceptance test.
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) {
  console.error("Usage: node deploy/smoke.mjs https://approved-host");
  process.exit(1);
}
try {
  const modeResponse = await fetch(new URL("/api/auth-mode", base), { signal: AbortSignal.timeout(10000), redirect: "error" });
  const mode = await modeResponse.json();
  if (modeResponse.status !== 200 || mode.mode !== "pki" || mode.ready !== false) throw new Error("auth-mode: expected unready PKI");
  const health = await fetch(new URL("/api/healthz", base), { signal: AbortSignal.timeout(10000), redirect: "error" });
  if (health.status !== 200) throw new Error("healthz: liveness failed");
  const ready = await fetch(new URL("/api/readyz", base), { signal: AbortSignal.timeout(10000), redirect: "error" });
  if (ready.status !== 503) throw new Error("readyz: expected not-ready");
  console.log("PASS: live, intentionally unready PKI baseline. No authenticated workflow or database correctness certified.");
} catch {
  console.error("FAIL: restricted baseline smoke check; inspect endpoint status through approved operations tooling (response bodies suppressed).");
  process.exitCode = 1;
}