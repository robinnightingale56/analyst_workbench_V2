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
    `#!/bin/sh
printf "%s\\n" "$*" >> "$WEB_PORT_INVOCATION_LOG"
case "$*" in
  "${expectedCommands[0].command}") exit "$WEB_PORT_ANALYST_STATUS" ;;
  "${expectedCommands[1].command}") exit "$WEB_PORT_CANVAS_STATUS" ;;
  *) echo "Unexpected pnpm command: $*" >&2; exit 99 ;;
esac
`,
  );
  await chmod(pnpmShim, 0o755);

  const scenarios = [
    { name: "both pass", analystStatus: 0, canvasStatus: 0 },
    { name: "Analyst Workbench fails", analystStatus: 17, canvasStatus: 0 },
    { name: "Canvas fails", analystStatus: 0, canvasStatus: 23 },
    { name: "both fail", analystStatus: 17, canvasStatus: 23 },
  ];

  for (const { name, analystStatus, canvasStatus } of scenarios) {
    await writeFile(invocationLog, "");
    const result = spawnSync(coordinator, {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${temporaryDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
        WEB_PORT_INVOCATION_LOG: invocationLog,
        WEB_PORT_ANALYST_STATUS: String(analystStatus),
        WEB_PORT_CANVAS_STATUS: String(canvasStatus),
      },
      shell: true,
      timeout: 10_000,
    });
    const context = `${coordinatorName} (${name}):\n${result.stdout}\n${result.stderr}`;
    assert.ifError(result.error);
    assert.equal(result.signal, null, context);
    assert.notEqual(result.status, null, context);

    const invocations = (await readFile(invocationLog, "utf8"))
      .trim()
      .split("\n");
    assert.deepEqual(
      invocations,
      expectedCommands.map(({ command }) => command),
      `Both suites must run exactly once, in order: ${context}`,
    );

    for (const { artifact } of expectedCommands) {
      assert.ok(
        result.stdout.includes(`${artifact} port contract:`),
        `Missing ${artifact} suite heading: ${context}`,
      );
    }

    if (analystStatus === 0 && canvasStatus === 0) {
      assert.equal(result.status, 0, context);
    } else {
      assert.notEqual(result.status, 0, context);
      assert.ok(
        result.stderr.includes(
          `Web port contract validation failed (Analyst Workbench: ${analystStatus}; Canvas: ${canvasStatus}).`,
        ),
        `Failure summary must report both suite statuses: ${context}`,
      );
    }
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(
  `Root package script "${coordinatorName}" runs both web port suites and reports independent and combined failures.`,
);