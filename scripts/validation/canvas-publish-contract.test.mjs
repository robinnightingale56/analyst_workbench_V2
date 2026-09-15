import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const replItPath = path.join(workspaceRoot, ".replit");
const packageJsonPath = path.join(
  workspaceRoot,
  "artifacts/mockup-sandbox/package.json",
);

const replIt = await readFile(replItPath, "utf8");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

const expectedWorkflows = [
  {
    name: "canvas-production-bundle",
    command:
      "pnpm --filter @workspace/mockup-sandbox run validate:bundle:production",
  },
  {
    name: "canvas-preview-bundle",
    command:
      "pnpm --filter @workspace/mockup-sandbox run validate:bundle:preview",
  },
  {
    name: "canvas-port-behavior",
    command: "pnpm --filter @workspace/mockup-sandbox run validate:port",
  },
];

function workflowBlock(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = replIt.match(
    new RegExp(
      `\\[\\[workflows\\.workflow\\]\\]\\s*\\nname = "${escapedName}"([\\s\\S]*?)(?=\\n\\[\\[workflows\\.workflow\\]\\]|$)`,
    ),
  );

  assert.ok(
    match,
    `Canvas workflow "${name}" is missing its diagnostic label in .replit`,
  );
  return match[0];
}

for (const { name, command } of expectedWorkflows) {
  const block = workflowBlock(name);
  assert.match(
    block,
    new RegExp(`args = "${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    `Canvas workflow "${name}" is missing package check "${command}" in .replit`,
  );
}

const expectedRerunHints = [
  {
    script: "validate:bundle",
    hint: "Canvas bundle validation failed. Re-run: pnpm --filter @workspace/mockup-sandbox run validate:bundle",
    label: "bundle",
  },
  {
    script: "validate:port",
    hint: "Canvas port behavior validation failed. Re-run: pnpm --filter @workspace/mockup-sandbox run validate:port",
    label: "port behavior",
  },
];

for (const { script, hint, label } of expectedRerunHints) {
  assert.equal(
    typeof packageJson.scripts?.[script],
    "string",
    `Canvas ${label} package check "${script}" is missing`,
  );
  assert.match(
    packageJson.scripts[script],
    new RegExp(hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `Canvas ${label} package check "${script}" lost its direct rerun hint`,
  );
}

console.log(
  "Canvas publish workflows and rerun diagnostics are present and aligned.",
);
