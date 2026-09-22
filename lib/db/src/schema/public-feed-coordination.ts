import { sql } from "drizzle-orm";
import { check, doublePrecision, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Public RSS only: never add session IDs, prompts, or private research here.
export const publicFeedCoordinationTable = pgTable(
  "public_feed_coordination",
  {
    providerKey: text("provider_key").primaryKey(),
    latest: text("latest"),
    good: text("good"),
    retryAt: doublePrecision("retry_at").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: doublePrecision("lease_until").notNull().default(0),
  },
  (table) => [
    check("public_feed_fixed_keys",
      sql`${table.providerKey} IN ('google-world-v1', 'bbc-world-v1')`),
    check("public_feed_snapshot_size",
      sql`length(${table.latest}) <= 524288 AND length(${table.good}) <= 524288`),
  ],
);

export const insertPublicFeedCoordinationSchema = createInsertSchema(publicFeedCoordinationTable);
export type PublicFeedCoordination = typeof publicFeedCoordinationTable.$inferSelect;