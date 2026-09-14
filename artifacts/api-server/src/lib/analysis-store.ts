import { analysisSessionsTable, db } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { assessSources } from "./analysis-engine";
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

const seededId = "demo-session";

function rowToSession(row: typeof analysisSessionsTable.$inferSelect): AnalysisSession {
  const data = row.data as Omit<AnalysisSession, "version" | "updatedAt">;
  return {
    ...data,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ensureDemonstrationSession() {
  const now = new Date();
  const session: Omit<AnalysisSession, "version" | "updatedAt"> = {
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
  const { version: _version, updatedAt: _updatedAt, ...data } = session;
  const [row] = await db
    .update(analysisSessionsTable)
    .set({ data, version: nextVersion, updatedAt })
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

export async function listSessions() {
  await ensureDemonstrationSession();
  const rows = await db
    .select()
    .from(analysisSessionsTable)
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

export async function createSession(input: {
  prompt: string;
  analyst?: string;
  classification?: AnalysisSession["classification"];
}) {
  const now = new Date();
  const data: Omit<AnalysisSession, "version" | "updatedAt"> = {
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
    .values({ id: data.id, data, version: 1, createdAt: now, updatedAt: now })
    .returning();
  return rowToSession(row!);
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