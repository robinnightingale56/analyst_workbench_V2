import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const analysisSessionsTable = pgTable("analysis_sessions", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAnalysisSessionSchema = createInsertSchema(
  analysisSessionsTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertAnalysisSession = z.infer<typeof insertAnalysisSessionSchema>;
export type AnalysisSessionRecord = typeof analysisSessionsTable.$inferSelect;