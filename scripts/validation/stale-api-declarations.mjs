import assert from "node:assert/strict";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const apiDeclarationPath = path.join(
  workspaceRoot,
  "lib/api-client-react/dist/generated/api.d.ts",
);
const schemaDeclarationPath = path.join(
  workspaceRoot,
  "lib/api-client-react/dist/generated/api.schemas.d.ts",
);
const validationDeclarationPath = path.join(
  workspaceRoot,
  "lib/api-zod/dist/generated/api.d.ts",
);

const runPnpm = (...args) => {
  const result = spawnSync("pnpm", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`pnpm ${args.join(" ")} failed with exit code ${result.status}`);
  }
};

const removeRequiredText = (contents, pattern, description) => {
  const staleContents = contents.replace(pattern, "");
  assert.notEqual(
    staleContents,
    contents,
    `Could not create stale fixture: ${description} was absent from fresh declarations`,
  );
  return staleContents;
};

// First align build metadata with the current generated source. Replacing only
// ignored declaration output after this reproduces the stale-cache failure:
// an ordinary incremental build trusts the metadata and leaves the old output.
runPnpm("run", "typecheck:libs");

const freshApiDeclaration = await readFile(apiDeclarationPath, "utf8");
const freshSchemaDeclaration = await readFile(schemaDeclarationPath, "utf8");
const freshValidationDeclaration = await readFile(
  validationDeclarationPath,
  "utf8",
);

const staleApiDeclaration = removeRequiredText(
  freshApiDeclaration,
  /\/\*\*\s*\* @summary Review candidate incidents and finalize the provisional count\s*\*\/\s*export declare const useUpdateIncidentReview:[\s\S]*?;\n/,
  "incident-review hook",
);

let staleSchemaDeclaration = removeRequiredText(
  freshSchemaDeclaration,
  /^\s*countAnswer: CountAnswer \| null;\n/m,
  "count-answer response field",
);
staleSchemaDeclaration = removeRequiredText(
  staleSchemaDeclaration,
  /^\s*\/\*\* @minimum 1 \*\/\n\s*version: number;\n/m,
  "session version field",
);
let staleValidationDeclaration = removeRequiredText(
  freshValidationDeclaration,
  "export declare const UpdateIncidentReviewBody:",
  "incident-review request schema",
);
staleValidationDeclaration = removeRequiredText(
  staleValidationDeclaration,
  "export declare const UpdateIncidentReviewResponse:",
  "incident-review response schema",
);

try {
  await Promise.all([
    writeFile(apiDeclarationPath, staleApiDeclaration),
    writeFile(schemaDeclarationPath, staleSchemaDeclaration),
    writeFile(validationDeclarationPath, staleValidationDeclaration),
  ]);

  // Keep the stale declarations newer than their inputs. The canonical command
  // must regenerate because it is forced, not because timestamps happen to help.
  const future = new Date(Date.now() + 60_000);
  await Promise.all([
    utimes(apiDeclarationPath, future, future),
    utimes(schemaDeclarationPath, future, future),
    utimes(validationDeclarationPath, future, future),
  ]);

  runPnpm("run", "typecheck");

  const regeneratedApiDeclaration = await readFile(apiDeclarationPath, "utf8");
  const regeneratedSchemaDeclaration = await readFile(schemaDeclarationPath, "utf8");
  const regeneratedValidationDeclaration = await readFile(
    validationDeclarationPath,
    "utf8",
  );

  assert.match(
    regeneratedApiDeclaration,
    /export declare const useUpdateIncidentReview:/,
    "Canonical typecheck did not restore the incident-review hook before checking the workbench",
  );
  assert.match(
    regeneratedSchemaDeclaration,
    /^\s*countAnswer: CountAnswer \| null;$/m,
    "Canonical typecheck did not restore the count-answer response field",
  );
  assert.match(
    regeneratedSchemaDeclaration,
    /^\s*version: number;$/m,
    "Canonical typecheck did not restore the session version field",
  );
  assert.match(
    regeneratedValidationDeclaration,
    /export declare const UpdateIncidentReviewBody:/,
    "Canonical typecheck did not restore the incident-review request schema before checking the API server",
  );
  assert.match(
    regeneratedValidationDeclaration,
    /export declare const UpdateIncidentReviewResponse:/,
    "Canonical typecheck did not restore the incident-review response schema before checking the API server",
  );
} finally {
  // A failing regression must not leave the ignored local output corrupted.
  await Promise.all([
    writeFile(apiDeclarationPath, freshApiDeclaration),
    writeFile(schemaDeclarationPath, freshSchemaDeclaration),
    writeFile(validationDeclarationPath, freshValidationDeclaration),
  ]);
}

console.log("Canonical typecheck regenerated stale API declarations.");