import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { allowed, create, verify, sha, scan } from "./package.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (p, content = "{}\n") => {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), content);
  };
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  put("package.json"); put("pyproject.toml");
  put("pnpm-workspace.yaml", "packages:\n  - artifacts/*\n");
  put("pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  artifacts/mockup-sandbox:\n    dependencies: {}\npackages:\n  example@1.0.0:\n    resolution: {}\nsnapshots:\n");
  put("uv.lock", '[[package]]\nname = "example"\nversion = "1.0.0"\n');
  put("artifacts/mockup-sandbox/package.json");
  put("artifacts/mockup-sandbox/src/App.tsx", "export default function App() { return null; }\n");
  git("init", "-q"); git("add", ".");
  git("-c", "user.name=Transfer Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
  return { root, put, git };
}
test("deterministic archives, working-tree provenance, independent verification and exclusions", (t) => {
  const { root, put, git } = fixture(t);
  for (const p of [".env", "lib/db/credentials.json", "artifacts/api-server/data/user.json", "artifacts/api-server/test-users.json", "artifacts/analyst-workbench/dist/public/app.js", "attached_assets/file.txt", ".git-extra/file.txt", "lib/db/backup.dump", "lib/db/src/token.key", "node_modules/local.js", "scripts/local.log"]) put(p, "excluded\n");
  git("add", "-f", ".");
  const first = path.join(root, "first.tar.gz"), second = path.join(root, "second.tar.gz");
  const hash = create(root, first);
  fs.utimesSync(path.join(root, "package.json"), new Date(0), new Date(0));
  assert.equal(create(root, second), hash);
  assert.ok(verify(first, hash) > 5);
  const content = gunzipSync(fs.readFileSync(first)).toString();
  assert.ok(content.includes('"dirty": true'));
  assert.ok(content.includes("artifacts/mockup-sandbox/src/App.tsx"));
  assert.ok(!content.includes("excluded"));
  assert.ok(content.includes('"license": "UNKNOWN"'));
});
test("likely secret rules disclose path and rule only", () => {
  const secrets = [
    ["private-key", "-----BEGIN " + "PRIVATE KEY-----"],
    ["credential-url", "postgresql://" + "alice:longpassword@example.invalid/db"],
    ["aws-access-key", "AKIA" + "A".repeat(16)],
    ["provider-token", "ghp_" + "x".repeat(35)],
    ["jwt", "eyJ" + "a".repeat(15) + ".eyJ" + "b".repeat(15) + "." + "c".repeat(20)],
    ["literal-secret", 'api_key = "' + "a".repeat(25) + '"'],
  ];
  for (const [rule, value] of secrets) {
    assert.throws(() => scan("scripts/fixture.ts", Buffer.from(value)), { message: `scripts/fixture.ts: ${rule}` });
  }
});
test("packaging fails on tracked secrets and symlinks", (t) => {
  const { root, put, git } = fixture(t);
  put("scripts/unsafe.ts", "ghp_" + "q".repeat(35)); git("add", ".");
  assert.throws(() => create(root, path.join(root, "bad.tar.gz")), /provider-token/);
  fs.unlinkSync(path.join(root, "scripts/unsafe.ts"));
  fs.symlinkSync("/etc/passwd", path.join(root, "scripts/unsafe.ts"));
  assert.throws(() => create(root, path.join(root, "bad.tar.gz")), /symlink-rejected/);
});
test("reject missing Canvas importer manifest", (t) => {
  const { root, git } = fixture(t);
  git("rm", "artifacts/mockup-sandbox/package.json");
  assert.throws(() => create(root, path.join(root, "bad.tar.gz")), /required-source-missing/);
});
test("untracked product changes cannot silently disappear from release", (t) => {
  const { root, put } = fixture(t);
  put("artifacts/api-server/src/new-security-module.py", "# reviewed first\n");
  assert.throws(() => create(root, path.join(root, "bad.tar.gz")), /untracked-source-review-required/);
});
test("transport digest and internal manifest catch tampering", (t) => {
  const { root } = fixture(t);
  const archive = path.join(root, "source.tar.gz");
  const original = create(root, archive);
  const data = gunzipSync(fs.readFileSync(archive));
  const index = data.indexOf("export default function App");
  assert.ok(index > 0); data[index] = 69;
  fs.writeFileSync(archive, gzipSync(data));
  assert.throws(() => verify(archive, original), /sha256-mismatch/);
  assert.throws(() => verify(archive, sha(fs.readFileSync(archive))), /manifest-mismatch/);
});
test("allowlist retains migration SQL but not dumps or environment files", () => {
  assert.ok(allowed("lib/db/migrations/001.sql"));
  assert.ok(allowed("deploy/restricted.env.example"));
  for (const p of ["lib/db/dumps/001.sql", "lib/db/database.sql", "lib/db/.env.production", "lib/db/.cache/index.ts", "artifacts/api-server/__pycache__/x.py", "personal-notes.txt"]) assert.equal(allowed(p), false, p);
});