import {
  ANALYSIS_SESSION_OWNERSHIP_RULES,
  analysisSessionsTable,
  CONTRACT_TEST_PROVENANCE,
  db,
  USER_PROVENANCE,
  type AnalysisSessionProvenance,
} from "@workspace/db";
import { and, desc, eq, isNotNull, isNull, lt, ne } from "drizzle-orm";
import { assessSources } from "./analysis-engine";
import { getArchivedSessionSettings } from "./archived-session-settings";
import { logger } from "./logger";
import {
  generateDemonstrationFiles,
  runOpenSourceResearch,
  type SourceFile,
} from "./source-adapters";

export type AnalysisSession = {
  id: string;
  prompt: string;
  analyst: string;
  classification: "UNCLASSIFIED" | "CUI" | "SECRET" | "TS";
  status:
    | "DRAFT"
    | "RESEARCHING"
    | "READY_FOR_SELECTION"
    | "ASSESSING"
    | "COMPLETE"
    | "FAILED";
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  version: number;
  sourceFiles: SourceFile[];
  sourceNotices: string[];
  assessment: ReturnType<typeof assessSources> | null;
};

export class AnalysisVersionConflictError extends Error {
  constructor() {
    super("Analysis session was updated by another request");
    this.name = "AnalysisVersionConflictError";
  }
}

export class FinalizedAnalysisArchiveError extends Error {
  constructor() {
    super("Finalized analysis reviews cannot be archived");
    this.name = "FinalizedAnalysisArchiveError";
  }
}

const seededId = "demo-session";
export { CONTRACT_TEST_PROVENANCE };

function isValidOwnership(
  provenance: AnalysisSessionProvenance,
  runId: string | undefined,
) {
  const rule = ANALYSIS_SESSION_OWNERSHIP_RULES.find(
    (candidate) => candidate.provenance === provenance,
  );
  return rule !== undefined && rule.requiresRunId === Boolean(runId);
}

function rowToSession(row: typeof analysisSessionsTable.$inferSelect): AnalysisSession {
  const data = row.data as Omit<AnalysisSession, "version" | "updatedAt">;
  return {
    ...data,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

async function ensureDemonstrationSession() {
  const now = new Date();
  const session: Omit<AnalysisSession, "version" | "updatedAt" | "archivedAt"> = {
    id: seededId,
    prompt:
      "Assess the near-term implications of the reported operating-environment shift and identify indicators that would change the judgment.",
    analyst: "Demo Analyst",
    classification: "UNCLASSIFIED",
    status: "READY_FOR_SELECTION",
    createdAt: now.toISOString(),
    sourceFiles: generateDemonstrationFiles("operating environment implications"),
    sourceNotices: [
      "This saved training session contains synthetic demonstration records.",
    ],
    assessment: null,
  };
  await db
    .insert(analysisSessionsTable)
    .values({ id: seededId, data: session, version: 1, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
}

async function writeSession(
  session: AnalysisSession,
  expectedVersion: number,
): Promise<AnalysisSession> {
  const updatedAt = new Date();
  const nextVersion = expectedVersion + 1;
  const {
    version: _version,
    updatedAt: _updatedAt,
    archivedAt: _archivedAt,
    ...data
  } = session;
  const [row] = await db
    .update(analysisSessionsTable)
    .set({
      data,
      version: nextVersion,
      updatedAt,
      finalizedAt: session.assessment?.countAnswer?.finalized
        ? updatedAt
        : null,
    })
    .where(
      and(
        eq(analysisSessionsTable.id, session.id),
        eq(analysisSessionsTable.version, expectedVersion),
      ),
    )
    .returning();
  if (!row) throw new AnalysisVersionConflictError();
  return rowToSession(row);
}

export function expiredArchivedSessionPredicate(cutoff: Date) {
  return and(
    isNotNull(analysisSessionsTable.archivedAt),
    lt(analysisSessionsTable.archivedAt, cutoff),
    isNull(analysisSessionsTable.finalizedAt),
  );
}

export async function purgeExpiredArchivedSessions(now = new Date()) {
  const { retentionDays } = getArchivedSessionSettings();
  const cutoff = new Date(
    now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
  );
  const deleted = await db
    .delete(analysisSessionsTable)
    .where(expiredArchivedSessionPredicate(cutoff))
    .returning({ id: analysisSessionsTable.id });
  return deleted.length;
}

export function staleContractFixturePredicate(
  activeRunId: string,
  cutoff: Date,
) {
  return and(
    eq(analysisSessionsTable.provenance, CONTRACT_TEST_PROVENANCE),
    isNotNull(analysisSessionsTable.runId),
    ne(analysisSessionsTable.runId, activeRunId),
    lt(analysisSessionsTable.createdAt, cutoff),
  );
}

export async function purgeStaleContractFixtures(
  activeRunId: string,
  now = new Date(),
  staleAfterMs = 60 * 60 * 1000,
) {
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const deleted = await db
    .delete(analysisSessionsTable)
    .where(staleContractFixturePredicate(activeRunId, cutoff))
    .returning({ id: analysisSessionsTable.id });
  return deleted.length;
}

export async function listSessions(includeArchived = false) {
  await ensureDemonstrationSession();
  try {
    await purgeExpiredArchivedSessions();
  } catch (err) {
    logger.error(
      { err },
      "Failed to purge expired archived analysis sessions during list fallback",
    );
  }
  const rows = await db
    .select()
    .from(analysisSessionsTable)
    .where(includeArchived ? undefined : isNull(analysisSessionsTable.archivedAt))
    .orderBy(desc(analysisSessionsTable.createdAt));
  return rows.map(rowToSession);
}

export async function getSession(id: string) {
  await ensureDemonstrationSession();
  const [row] = await db
    .select()
    .from(analysisSessionsTable)
    .where(eq(analysisSessionsTable.id, id))
    .limit(1);
  return row ? rowToSession(row) : undefined;
}

export async function deleteSession(id: string) {
  const deleted = await db
    .delete(analysisSessionsTable)
    .where(eq(analysisSessionsTable.id, id))
    .returning({ id: analysisSessionsTable.id });
  return deleted.length === 1;
}

export async function createSession(input: {
  prompt: string;
  analyst?: string;
  classification?: AnalysisSession["classification"];
  provenance?: AnalysisSessionProvenance;
  runId?: string;
}) {
  const provenance = input.provenance ?? USER_PROVENANCE;
  if (!isValidOwnership(provenance, input.runId)) {
    throw new Error("Analysis session provenance and runId are inconsistent");
  }
  const now = new Date();
  const data: Omit<AnalysisSession, "version" | "updatedAt" | "archivedAt"> = {
    id: crypto.randomUUID(),
    prompt: input.prompt,
    analyst: input.analyst ?? "Current Analyst",
    classification: input.classification ?? "UNCLASSIFIED",
    status: "DRAFT",
    createdAt: now.toISOString(),
    sourceFiles: [],
    sourceNotices: [],
    assessment: null,
  };
  const [row] = await db
    .insert(analysisSessionsTable)
    .values({
      id: data.id,
      data,
      provenance,
      runId: input.runId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rowToSession(row!);
}

export async function setSessionArchived(
  id: string,
  archived: boolean,
  expectedVersion: number,
) {
  const session = await getSession(id);
  if (!session) return undefined;
  if (session.version !== expectedVersion) throw new AnalysisVersionConflictError();
  if (archived && session.assessment?.countAnswer?.finalized) {
    throw new FinalizedAnalysisArchiveError();
  }
  const updatedAt = new Date();
  const [row] = await db
    .update(analysisSessionsTable)
    .set({
      archivedAt: archived ? updatedAt : null,
      updatedAt,
      version: expectedVersion + 1,
    })
    .where(
      and(
        eq(analysisSessionsTable.id, id),
        eq(analysisSessionsTable.version, expectedVersion),
      ),
    )
    .returning();
  if (!row) throw new AnalysisVersionConflictError();
  return rowToSession(row);
}

export async function setSessionSources(
  id: string,
  sourceFiles: SourceFile[],
  sourceNotices: string[] = [],
) {
  const session = await getSession(id);
  if (!session) return undefined;
  session.sourceFiles = sourceFiles;
  session.sourceNotices = sourceNotices;
  session.status = sourceFiles.length ? "READY_FOR_SELECTION" : "FAILED";
  session.assessment = null;
  return writeSession(session, session.version);
}

export async function runSessionResearch(
  id: string,
  connectorIds: string[],
  maxResults?: number,
) {
  const session = await getSession(id);
  if (!session) return undefined;
  session.status = "RESEARCHING";
  const researching = await writeSession(session, session.version);
  try {
    const result = await runOpenSourceResearch(
      researching.prompt,
      connectorIds,
      maxResults,
    );
    researching.sourceFiles = result.files;
    researching.sourceNotices = result.notices;
    researching.status = result.files.length > 0 ? "READY_FOR_SELECTION" : "FAILED";
    researching.assessment = null;
    return await writeSession(researching, researching.version);
  } catch (error) {
    researching.status = "FAILED";
    researching.sourceNotices = [
      error instanceof Error ? error.message : "Unexpected research failure",
    ];
    await writeSession(researching, researching.version);
    throw error;
  }
}

export async function assessSession(id: string, selectedSourceFileIds: string[]) {
  const session = await getSession(id);
  if (!session) return undefined;
  const selected = session.sourceFiles.filter((file) =>
    selectedSourceFileIds.includes(file.id),
  );
  session.assessment = assessSources(selected, session.prompt);
  session.status = "COMPLETE";
  return writeSession(session, session.version);
}

export async function updateIncidentReview(
  id: string,
  incidents: NonNullable<NonNullable<AnalysisSession["assessment"]>["countAnswer"]>["incidents"],
  finalized: boolean,
  expectedVersion: number,
) {
  const session = await getSession(id);
  if (!session?.assessment?.countAnswer) return undefined;
  if (session.version !== expectedVersion) throw new AnalysisVersionConflictError();
  session.assessment.countAnswer.incidents = incidents;
  const includedCount = incidents.filter(
    (incident) => incident.status === "INCLUDED",
  ).length;
  session.assessment.countAnswer.provisionalCount = includedCount;
  session.assessment.countAnswer.answerStatus =
    includedCount > 0 ? "SUPPORTED" : "INSUFFICIENT_EVIDENCE";
  session.assessment.countAnswer.finalized = finalized;
  session.assessment.provisional = !finalized;
  return writeSession(session, expectedVersion);
}