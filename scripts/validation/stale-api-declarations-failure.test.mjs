import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const declarationPaths = [
  "lib/api-client-react/dist/generated/api.d.ts",
  "lib/api-client-react/dist/generated/api.schemas.d.ts",
  "lib/api-zod/dist/generated/api.d.ts",
].map((relativePath) => path.join(workspaceRoot, relativePath));
const intentionalFailureMessage =
  "Intentional canonical typecheck failure for cleanup verification";

const before = await Promise.all(declarationPaths.map((file) => readFile(file)));
const result = spawnSync(
  process.execPath,
  ["scripts/validation/stale-api-declarations.mjs"],
  {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      STALE_API_DECLARATIONS_FORCE_TYPECHECK_FAILURE: "1",
    },
  },
);

assert.notEqual(
  result.status,
  0,
  "Controlled stale-declaration validation unexpectedly succeeded",
);
assert.match(
  result.stderr,
  new RegExp(intentionalFailureMessage),
  "Controlled validation did not report the intentional typecheck failure",
);
assert.doesNotMatch(
  result.stderr,
  /Failed to restore generated declarations/,
  "Declaration cleanup failed while handling the intentional typecheck failure",
);

const after = await Promise.all(declarationPaths.map((file) => readFile(file)));
for (const [index, file] of declarationPaths.entries()) {
  assert.deepEqual(
    after[index],
    before[index],
    `Cleanup verification failed: ${path.relative(workspaceRoot, file)} was not restored byte-for-byte`,
  );
}

console.log(
  "Generated declarations were restored after the intentional typecheck failure.",
);