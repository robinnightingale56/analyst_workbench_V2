import { assessSources } from "./analysis-engine";
import { generateDemonstrationFiles } from "./source-adapters";

export type AnalysisSession = {
  id: string;
  prompt: string;
  analyst: string;
  classification: "UNCLASSIFIED" | "CUI" | "SECRET" | "TS";
  status: "DRAFT" | "RESEARCHING" | "READY_FOR_SELECTION" | "ASSESSING" | "COMPLETE";
  createdAt: string;
  sourceFiles: ReturnType<typeof generateDemonstrationFiles>;
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
    assessment: null,
  };
  sessions.set(session.id, session);
  return session;
}

export function runSessionResearch(id: string, maxResults?: number) {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.sourceFiles = generateDemonstrationFiles(session.prompt, maxResults);
  session.status = "READY_FOR_SELECTION";
  session.assessment = null;
  return session;
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
