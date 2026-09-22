#!/usr/bin/env node
// Source-only transport. No dependency installation, builds, or database access.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

export const sha = (data) => createHash("sha256").update(data).digest("hex");
const roots = /^(artifacts\/(api-server|analyst-workbench|mockup-sandbox|test-utils)\/|lib\/|scripts\/|docs\/|deploy\/)/;
const rootFiles = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "pyproject.toml", "uv.lock", "tsconfig.json", "tsconfig.base.json", "vite-port-config.ts", "main.py", "README.md", "threat_model.md"]);
const forbidden = /(^|\/)(?:\.[^/]+|node_modules|dist|build|coverage|__pycache__|attached_assets|logs?|caches?|local[-_]data|data|uploads?|backups?|dumps?|test[-_]users?)(\/|$)|(?:^|\/)[^/]*(?:credentials|private[-_]?key|secrets?)[^/]*$|\.(?:pem|key|p12|pfx|crt|cer|db|sqlite\d*|dump|bak|log|pyc|tsbuildinfo|tgz|zip)$/i;
export function allowed(p) {
  if (p === "deploy/restricted.env.example" || p === ".npmrc") return true;
  if (/\.sql$/i.test(p) && !/(^|\/)(migrations?|schema)\//.test(p)) return false;
  return !forbidden.test(p) && !/(^|\/)(?:test[-_]users?|dump|backup)(?:[._-]|$)/i.test(p) && !/(^|\/).*\.env(?:\.|$)/i.test(p)
    && (rootFiles.has(p) || (roots.test(p) && /\.(?:[cm]?[jt]sx?|py|json|ya?ml|toml|lock|sql|md|sh|css|html|svg|txt|ini|cfg|conf|service)$/.test(p)));
}
export function scan(p, data) {
  const text = data.toString("utf8");
  if (p === ".npmrc" && /(?:_authToken|_auth|_password)\s*=\s*(?!\$\{)[^\s#;]+/i.test(text)) throw new Error(`${p}: registry-credential`);
  const rules = [
    ["private-key", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
    ["credential-url", /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i],
    ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ["provider-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk_live_[A-Za-z0-9]{16,})\b/],
    ["jwt", /\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/],
    ["literal-secret", /(?:password|api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{20,}["']/i],
  ];
  for (const [rule, pattern] of rules) if (pattern.test(text)) throw new Error(`${p}: ${rule}`);
}
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}
export function inventory(files) {
  const npm = files.get("pnpm-lock.yaml")?.toString() ?? "";
  const section = npm.split(/^packages:\s*$/m)[1]?.split(/^snapshots:\s*$/m)[0];
  if (!section) throw new Error("pnpm-lock.yaml: unsupported inventory format");
  const packages = [...section.matchAll(/^  (.+):\s*$/gm)].map((m) => ({
    ecosystem: "npm", lockedIdentifier: m[1].replace(/^['"]|['"]$/g, ""), license: "UNKNOWN",
  }));
  const uv = files.get("uv.lock")?.toString() ?? "";
  for (const block of uv.split("[[package]]").slice(1)) {
    const name = block.match(/^name = "([^"]+)"$/m)?.[1];
    const version = block.match(/^version = "([^"]+)"$/m)?.[1];
    if (!name || !version) throw new Error("uv.lock: unsupported inventory format");
    packages.push({ ecosystem: "python", name, version, license: "UNKNOWN" });
  }
  if (!packages.length) throw new Error("lockfiles: empty inventory");
  return { scope: "Lockfile inventory, including development and platform alternatives; not an installed SBOM, license clearance, vulnerability assessment, or offline dependency bundle.", packages };
}
function tar(files) {
  const chunks = [];
  for (const p of [...files.keys()].sort()) {
    const data = files.get(p);
    const h = Buffer.alloc(512);
    let name = p, prefix = "";
    if (Buffer.byteLength(name) > 100) {
      const split = p.lastIndexOf("/");
      prefix = p.slice(0, split); name = p.slice(split + 1);
    }
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`${p}: tar-name-length`);
    h.write(name, 0, 100); h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136); h.fill(32, 148, 156); h.write("0", 156);
    h.write("ustar\0", 257); h.write("00", 263); h.write(prefix, 345, 155);
    h.write([...h].reduce((a, b) => a + b, 0).toString(8).padStart(6, "0") + "\0 ", 148);
    chunks.push(h, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]), { level: 9 });
}
export function collect(root) {
  const files = new Map();
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter((p) => p && allowed(p));
  if (untracked.length) throw new Error(`${untracked.sort()[0]}: untracked-source-review-required`);
  const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const p of tracked.sort()) {
    if (!allowed(p)) continue;
    const abs = path.join(root, p);
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) throw new Error(`${p}: symlink-rejected`);
    const resolved = fs.realpathSync(abs);
    if (!resolved.startsWith(fs.realpathSync(root) + path.sep)) throw new Error(`${p}: escaping-path`);
    if (!stat.isFile()) throw new Error(`${p}: non-regular-file`);
    const data = fs.readFileSync(abs); scan(p, data); files.set(p, data);
  }
  for (const p of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "uv.lock", "pyproject.toml",
    "artifacts/mockup-sandbox/package.json", "artifacts/mockup-sandbox/src/App.tsx"]) {
    if (!files.has(p)) throw new Error(`${p}: required-source-missing`);
  }
  // Every lockfile workspace importer must remain present, including Canvas.
  const importers = files.get("pnpm-lock.yaml").toString().split(/^importers:\s*$/m)[1]?.split(/^packages:\s*$/m)[0];
  if (!importers) throw new Error("pnpm-lock.yaml: missing importers");
  for (const m of importers.matchAll(/^  ([^ ].*):\s*$/gm)) {
    const dir = m[1].replace(/^['"]|['"]$/g, "");
    const manifest = dir === "." ? "package.json" : `${dir}/package.json`;
    if (!files.has(manifest)) throw new Error(`${manifest}: workspace-importer-missing`);
  }
  files.set("TRANSFER-INVENTORY.json", json(inventory(files)));
  files.set("TRANSFER-PROVENANCE.json", json({
    format: 1, kind: "source-only", commit: git(root, ["rev-parse", "HEAD"]).trim(),
    dirty: Boolean(git(root, ["status", "--porcelain", "--untracked-files=normal"]).trim()),
    policy: "Tracked allowlisted working-tree files; normalized mode 0644 and timestamp 0; no frontend build or dependencies included.",
  }));
  files.set("TRANSFER-MANIFEST.json", json(Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([p, b]) => [p, sha(b)]))));
  return files;
}
export function create(root, output) {
  const data = tar(collect(root));
  fs.writeFileSync(output, data, { flag: "wx" });
  fs.writeFileSync(output + ".sha256", `${sha(data)}  ${path.basename(output)}\n`, { flag: "wx" });
  return sha(data);
}
export function verify(archive, expected) {
  const zipped = fs.readFileSync(archive);
  if (!/^[a-f0-9]{64}$/.test(expected) || sha(zipped) !== expected) throw new Error("archive: sha256-mismatch");
  const data = gunzipSync(zipped, { maxOutputLength: 512 * 1024 * 1024 });
  const files = new Map();
  let offset = 0, previous = "";
  const str = (b) => b.toString().replace(/\0.*$/s, "");
  while (offset + 512 <= data.length && data[offset] !== 0) {
    const h = data.subarray(offset, offset + 512);
    const name = str(h.subarray(0, 100)), prefix = str(h.subarray(345, 500));
    const p = prefix ? `${prefix}/${name}` : name;
    const checksum = parseInt(str(h.subarray(148, 156)).trim(), 8);
    const copy = Buffer.from(h); copy.fill(32, 148, 156);
    if ([...copy].reduce((a, b) => a + b, 0) !== checksum) throw new Error("archive: tar-checksum");
    if (h[156] !== 48 || !p || p.startsWith("/") || p.split("/").some((s) => !s || s === ".." || s === ".") || p <= previous || /[\\\x00-\x1f]/.test(p)) throw new Error("archive: unsafe-entry");
    if (!allowed(p) && !/^TRANSFER-(MANIFEST|PROVENANCE|INVENTORY)\.json$/.test(p)) throw new Error(`${p}: disallowed-entry`);
    const sizeText = str(h.subarray(124, 136));
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("archive: invalid-size");
    const size = parseInt(sizeText, 8);
    offset += 512;
    if (offset + size > data.length) throw new Error("archive: truncated-entry");
    const content = data.subarray(offset, offset + size);
    scan(p, content); files.set(p, content); previous = p;
    offset += Math.ceil(size / 512) * 512;
  }
  if (data.length - offset < 1024 || data.subarray(offset).some((v) => v !== 0)) throw new Error("archive: invalid-trailer");
  const manifest = JSON.parse(files.get("TRANSFER-MANIFEST.json")?.toString() ?? "null");
  if (!manifest || Object.keys(manifest).length !== files.size - 1) throw new Error("archive: manifest-count");
  for (const [p, bytes] of files) if (p !== "TRANSFER-MANIFEST.json" && manifest[p] !== sha(bytes)) throw new Error(`${p}: manifest-mismatch`);
  return files.size;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, arg, digest] = process.argv.slice(2);
    if (command === "check" && !arg) console.log(`Source checks passed: ${collect(process.cwd()).size} entries`);
    else if (command === "create" && arg && !digest) console.log(`SHA256 ${create(process.cwd(), path.resolve(arg))}`);
    else if (command === "verify" && arg && digest) console.log(`Verified ${verify(arg, digest)} entries`);
    else throw new Error("Usage: node scripts/transfer/package.mjs check | create OUTPUT.tar.gz | verify ARCHIVE SHA256");
  } catch (error) {
    // No content, environment values, or subprocess diagnostics are emitted.
    console.error(error instanceof SyntaxError ? "transfer: invalid-json" : error.message);
    process.exitCode = 1;
  }
}