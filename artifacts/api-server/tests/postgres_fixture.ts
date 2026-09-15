import assert from "node:assert/strict";

import {
  analysisSessionsTable,
  CONTRACT_TEST_PROVENANCE,
  db,
  pool,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const [action, id, runId] = process.argv.slice(2);
if (!action || !id || !runId) {
  throw new Error("Usage: postgres_fixture.ts <seed|assert-python-update> <id> <runId>");
}

try {
  if (action === "seed") {
    const createdAt = new Date("2026-09-15T12:34:56.789Z");
    await db.insert(analysisSessionsTable).values({
      id,
      data: {
        id,
        prompt: "TypeScript-created PostgreSQL compatibility fixture",
        analyst: "Drizzle Analyst",
        classification: "UNCLASSIFIED",
        status: "DRAFT",
        createdAt: createdAt.toISOString(),
        sourceFiles: [],
        sourceNotices: ["Unicode and JSONB survive: café 東京"],
        assessment: null,
        legacyExtension: {
          nested: true,
          values: [1, "two", null],
        },
      },
      provenance: CONTRACT_TEST_PROVENANCE,
      runId,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    });
  } else if (action === "assert-python-update") {
    const [row] = await db
      .select()
      .from(analysisSessionsTable)
      .where(eq(analysisSessionsTable.id, id))
      .limit(1);
    assert(row, "Python update removed the TypeScript-created row");
    assert.equal(row.runId, runId);
    assert.equal(row.version, 2);
    assert.equal(row.data["analyst"], "Python Analyst");
    assert.deepEqual(row.data["legacyExtension"], {
      nested: true,
      values: [1, "two", null],
    });
    assert(row.updatedAt.getTime() > row.createdAt.getTime());
  } else {
    throw new Error(`Unknown fixture action: ${action}`);
  }
} finally {
  await pool.end();
}