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
  sourceFiles: SourceFile[];
  sourceNotices: string[];
  assessment: ReturnType<typeof assessSources> | null;
};

const seededId = "demo-session";
const sessions = new Map<string, AnalysisSession>([
  [
    seededId,
    {
      id: seededId,
      prompt:
        "Assess the near-term implications of the reported operating-environment shift and identify indicators that would change the judgment.",
      analyst: "Demo Analyst",
      classification: "UNCLASSIFIED",
      status: "READY_FOR_SELECTION",
      createdAt: new Date().toISOString(),
      sourceFiles: generateDemonstrationFiles("operating environment implications"),
      sourceNotices: [
        "This saved training session contains synthetic demonstration records.",
      ],
      assessment: null,
    },
  ],
]);

export function listSessions() {
  return [...sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSession(id: string) {
  return sessions.get(id);
}

export function createSession(input: {
  prompt: string;
  analyst?: string;
  classification?: AnalysisSession["classification"];
}) {
  const session: AnalysisSession = {
    id: crypto.randomUUID(),
    prompt: input.prompt,
    analyst: input.analyst ?? "Current Analyst",
    classification: input.classification ?? "UNCLASSIFIED",
    status: "DRAFT",
    createdAt: new Date().toISOString(),
    sourceFiles: [],
    sourceNotices: [],
    assessment: null,
  };
  sessions.set(session.id, session);
  return session;
}

export async function runSessionResearch(
  id: string,
  connectorIds: string[],
  maxResults?: number,
) {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.status = "RESEARCHING";
  try {
    const result = await runOpenSourceResearch(
      session.prompt,
      connectorIds,
      maxResults,
    );
    session.sourceFiles = result.files;
    session.sourceNotices = result.notices;
    session.status = result.files.length > 0 ? "READY_FOR_SELECTION" : "FAILED";
    session.assessment = null;
    return session;
  } catch (error) {
    session.status = "FAILED";
    session.sourceNotices = [
      error instanceof Error ? error.message : "Unexpected research failure",
    ];
    throw error;
  }
}

export function assessSession(id: string, selectedSourceFileIds: string[]) {
  const session = sessions.get(id);
  if (!session) return undefined;
  const selected = session.sourceFiles.filter((file) =>
    selectedSourceFileIds.includes(file.id),
  );
  session.assessment = assessSources(selected);
  session.status = "COMPLETE";
  return session;
}
