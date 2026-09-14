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
  ListEvaluationVectorsResponse,
  ListHistoricalRatingsResponse,
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
import {
  evaluationVectors,
  historicalRatings,
} from "../lib/analysis-engine";
import { sourceConnectors } from "../lib/source-adapters";
import { isKnownSourceConnector } from "../lib/source-adapters";

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

router.post("/analysis-sessions/:sessionId/research", async (req, res): Promise<void> => {
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
  if (body.data.sourceConnectorIds.length === 0) {
    res.status(400).json({ error: "Select at least one source connector" });
    return;
  }
  const existing = getSession(params.data.sessionId);
  if (!existing) {
    res.status(404).json({ error: "Analysis session not found" });
    return;
  }
  if (existing.classification !== "UNCLASSIFIED") {
    res.status(403).json({
      error: "Public web research is permitted only for UNCLASSIFIED sessions",
    });
    return;
  }
  const unknownConnectors = body.data.sourceConnectorIds.filter(
    (id) => !isKnownSourceConnector(id),
  );
  if (unknownConnectors.length > 0) {
    res.status(400).json({ error: "One or more source connectors are not supported" });
    return;
  }
  const session = await runSessionResearch(
    params.data.sessionId,
    body.data.sourceConnectorIds,
    body.data.maxResults,
  );
  if (!session) {
    res.status(404).json({ error: "Analysis session not found" });
    return;
  }
  req.log.info(
    { sessionId: session.id, connectorCount: body.data.sourceConnectorIds.length },
    "Completed open-source research run",
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
  const existing = getSession(params.data.sessionId);
  if (!existing) {
    res.status(404).json({ error: "Analysis session not found" });
    return;
  }
  const validIds = new Set(existing.sourceFiles.map((file) => file.id));
  if (body.data.selectedSourceFileIds.some((id) => !validIds.has(id))) {
    res.status(400).json({
      error: "One or more selected source files do not belong to this session",
    });
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

router.get("/evaluation-vectors", (_req, res) => {
  res.json(ListEvaluationVectorsResponse.parse(evaluationVectors));
});

router.get("/historical-ratings", (_req, res) => {
  res.json(ListHistoricalRatingsResponse.parse(historicalRatings));
});

export default router;
