import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(
  await readFile(path.join(workspaceRoot, "package.json"), "utf8"),
);
const coordinatorName = "test:web-port-contracts";
const coordinator = packageJson.scripts?.[coordinatorName];

assert.equal(
  typeof coordinator,
  "string",
  `Root package script "${coordinatorName}" is missing`,
);

const expectedCommands = [
  {
    artifact: "Analyst Workbench",
    command: "--filter @workspace/analyst-workbench run test:port",
  },
  {
    artifact: "Canvas",
    command: "--filter @workspace/mockup-sandbox run validate:port",
  },
];

const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "web-port-coordinator-"),
);
const invocationLog = path.join(temporaryDirectory, "pnpm-invocations.log");
const pnpmShim = path.join(temporaryDirectory, "pnpm");

try {
  await writeFile(
    pnpmShim,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$WEB_PORT_INVOCATION_LOG"\n',
  );
  await chmod(pnpmShim, 0o755);

  const result = spawnSync(coordinator, {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${temporaryDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      WEB_PORT_INVOCATION_LOG: invocationLog,
    },
    shell: true,
  });

  assert.equal(
    result.status,
    0,
    `Root package script "${coordinatorName}" failed under the controlled port-suite runner:\n${result.stderr}`,
  );

  const invocations = (await readFile(invocationLog, "utf8"))
    .trim()
    .split("\n");

  for (const { artifact, command } of expectedCommands) {
    assert.ok(
      invocations.includes(command),
      `${artifact} port suite is missing from root package script "${coordinatorName}"; expected pnpm ${command}`,
    );
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(
  `Root package script "${coordinatorName}" runs both web port suites.`,
);