import { Router, type IRouter } from "express";
import {
  CreateAnalysisSessionBody,
  CreateAnalysisSessionResponse,
  CreateAssessmentBody,
  CreateAssessmentParams,
  CreateAssessmentResponse,
  GetAnalysisSessionParams,
  GetAnalysisSessionResponse,
  ListAnalysisSessionsResponse,
  ListSourceConnectorsResponse,
  RunResearchBody,
  RunResearchParams,
  RunResearchResponse,
} from "@workspace/api-zod";
import {
  assessSession,
  createSession,
  getSession,
  listSessions,
  runSessionResearch,
} from "../lib/analysis-store";
import { sourceConnectors } from "../lib/source-adapters";

const router: IRouter = Router();

router.get("/analysis-sessions", (_req, res) => {
  res.json(ListAnalysisSessionsResponse.parse(listSessions()));
});

router.post("/analysis-sessions", (req, res) => {
  const body = CreateAnalysisSessionBody.safeParse(req.body);
  if (!body.success) {
    req.log.warn({ validation: body.error.message }, "Invalid analysis session");
    res.status(400).json({ error: body.error.message });
    return;
  }
  res.status(201).json(CreateAnalysisSessionResponse.parse(createSession(body.data)));
});

router.get("/analysis-sessions/:sessionId", (req, res) => {
  const params = GetAnalysisSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const session = getSession(params.data.sessionId);
  if (!session) {
    res.status(404).json({ error: "Analysis session not found" });
    return;
  }
  res.json(GetAnalysisSessionResponse.parse(session));
});

router.post("/analysis-sessions/:sessionId/research", (req, res) => {
  const params = RunResearchParams.safeParse(req.params);
  const body = RunResearchBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const session = runSessionResearch(params.data.sessionId, body.data.maxResults);
  if (!session) {
    res.status(404).json({ error: "Analysis session not found" });
    return;
  }
  req.log.info(
    { sessionId: session.id, connectorCount: body.data.sourceConnectorIds.length },
    "Completed demonstration research run",
  );
  res.json(RunResearchResponse.parse(session));
});

router.post("/analysis-sessions/:sessionId/assessment", (req, res) => {
  const params = CreateAssessmentParams.safeParse(req.params);
  const body = CreateAssessmentBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (body.data.selectedSourceFileIds.length === 0) {
    res.status(400).json({ error: "Select at least one source file" });
    return;
  }
  const session = assessSession(
    params.data.sessionId,
    body.data.selectedSourceFileIds,
  );
  if (!session) {
    res.status(404).json({ error: "Analysis session not found" });
    return;
  }
  res.json(CreateAssessmentResponse.parse(session));
});

router.get("/source-connectors", (_req, res) => {
  res.json(ListSourceConnectorsResponse.parse(sourceConnectors));
});

export default router;
