import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ANALYSIS_SESSION_OWNERSHIP_RULES = [
  { provenance: "USER", requiresRunId: false },
  { provenance: "CONTRACT_TEST", requiresRunId: true },
] as const;

export type AnalysisSessionProvenance =
  (typeof ANALYSIS_SESSION_OWNERSHIP_RULES)[number]["provenance"];

export const USER_PROVENANCE = "USER" satisfies AnalysisSessionProvenance;
export const CONTRACT_TEST_PROVENANCE =
  "CONTRACT_TEST" satisfies AnalysisSessionProvenance;

const ownershipCheckSql = ANALYSIS_SESSION_OWNERSHIP_RULES.map(
  ({ provenance, requiresRunId }) =>
    `(provenance = '${provenance}' AND ${
      requiresRunId
        ? "run_id IS NOT NULL AND run_id !~ '^[[:space:]]*$'"
        : "run_id IS NULL"
    })`,
).join(" OR ");

export const analysisSessionsTable = pgTable(
  "analysis_sessions",
  {
    id: text("id").primaryKey(),
    data: jsonb("data").notNull(),
    provenance: text("provenance")
      .$type<AnalysisSessionProvenance>()
      .notNull()
      .default(USER_PROVENANCE),
    runId: text("run_id"),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("analysis_sessions_expired_archive_idx")
      .on(table.archivedAt)
      .where(
        sql`${table.archivedAt} IS NOT NULL AND ${table.finalizedAt} IS NULL`,
      ),
    index("analysis_sessions_stale_contract_fixture_idx")
      .on(table.createdAt, table.runId)
      .where(
        sql`${table.provenance} = 'CONTRACT_TEST' AND ${table.runId} !~ '^[[:space:]]*$'`,
      ),
    check(
      "analysis_sessions_ownership_nonwhitespace_run_id_required_check",
      sql.raw(ownershipCheckSql),
    ),
  ],
);

export const insertAnalysisSessionSchema = createInsertSchema(
  analysisSessionsTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertAnalysisSession = z.infer<typeof insertAnalysisSessionSchema>;
export type AnalysisSessionRecord = typeof analysisSessionsTable.$inferSelect;