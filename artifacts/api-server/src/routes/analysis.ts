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
  ListAnalysisSessionsQueryParams,
  ListEvaluationVectorsResponse,
  ListHistoricalRatingsResponse,
  ListSourceConnectorsResponse,
  RunResearchBody,
  RunResearchParams,
  RunResearchResponse,
  UpdateIncidentReviewBody,
  UpdateIncidentReviewParams,
  UpdateIncidentReviewResponse,
  UpdateAnalysisSessionArchiveBody,
  UpdateAnalysisSessionArchiveParams,
  UpdateAnalysisSessionArchiveResponse,
} from "@workspace/api-zod";
import {
  assessSession,
  createSession,
  getSession,
  listSessions,
  setSessionArchived,
  runSessionResearch,
  updateIncidentReview,
  AnalysisVersionConflictError,
  FinalizedAnalysisArchiveError,
} from "../lib/analysis-store";
import {
  evaluationVectors,
  historicalRatings,
  deduplicateIncidents,
  incidentCitationError,
} from "../lib/analysis-engine";
import { sourceConnectors } from "../lib/source-adapters";
import { isKnownSourceConnector } from "../lib/source-adapters";

const router: IRouter = Router();

router.get("/analysis-sessions", async (req, res) => {
  const query = ListAnalysisSessionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  res.json(
    ListAnalysisSessionsResponse.parse(
      await listSessions(query.data.includeArchived ?? false),
    ),
  );
});

router.post("/analysis-sessions", async (req, res) => {
  const body = CreateAnalysisSessionBody.safeParse(req.body);
  if (!body.success) {
    req.log.warn({ validation: body.error.message }, "Invalid analysis session");
    res.status(400).json({ error: body.error.message });
    return;
  }
  res.status(201).json(CreateAnalysisSessionResponse.parse(await createSession(body.data)));
});

router.get("/analysis-sessions/:sessionId", async (req, res) => {
  const params = GetAnalysisSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const session = await getSession(params.data.sessionId);
  if (!session) {
    res.status(404).json({ error: "Analysis session not found" });
    return;
  }
  res.json(GetAnalysisSessionResponse.parse(session));
});

router.patch("/analysis-sessions/:sessionId", async (req, res) => {
  const params = UpdateAnalysisSessionArchiveParams.safeParse(req.params);
  const body = UpdateAnalysisSessionArchiveBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const session = await setSessionArchived(
      params.data.sessionId,
      body.data.archived,
      body.data.expectedVersion,
    );
    if (!session) {
      res.status(404).json({ error: "Analysis session not found" });
      return;
    }
    res.json(UpdateAnalysisSessionArchiveResponse.parse(session));
  } catch (error) {
    if (
      error instanceof AnalysisVersionConflictError ||
      error instanceof FinalizedAnalysisArchiveError
    ) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
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
  const existing = await getSession(params.data.sessionId);
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

router.post("/analysis-sessions/:sessionId/assessment", async (req, res) => {
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
  const existing = await getSession(params.data.sessionId);
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
  const session = await assessSession(
    params.data.sessionId,
    body.data.selectedSourceFileIds,
  );
  if (!session) {
    res.status(404).json({ error: "Analysis session not found" });
    return;
  }
  res.json(CreateAssessmentResponse.parse(session));
});

router.patch("/analysis-sessions/:sessionId/assessment", async (req, res) => {
  const params = UpdateIncidentReviewParams.safeParse(req.params);
  const body = UpdateIncidentReviewBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const existing = await getSession(params.data.sessionId);
  if (!existing?.assessment?.countAnswer) {
    res.status(404).json({ error: "Count assessment not found" });
    return;
  }
  const selectedSourceIds = new Set(existing.assessment.selectedSourceFileIds);
  const selectedSources = existing.sourceFiles.filter((file) => selectedSourceIds.has(file.id));
  const validSourceIds = new Set(selectedSources.map((file) => file.id));
  if (body.data.incidents.some((incident) =>
    incident.sourceFileIds.some((sourceId) => !validSourceIds.has(sourceId))
  )) {
    res.status(400).json({ error: "An incident cites a source outside the selected evidence set" });
    return;
  }
  const normalizedIncidents = deduplicateIncidents(body.data.incidents);
  const citationError = normalizedIncidents
    .filter((incident) => incident.status === "INCLUDED")
    .map((incident) => incidentCitationError(
      incident,
      selectedSources,
      existing.assessment!.countAnswer!.requestedParties,
      existing.assessment!.countAnswer!.dateRange,
    ))
    .find(Boolean);
  if (citationError) {
    res.status(400).json({ error: citationError });
    return;
  }
  if (
    body.data.finalized &&
    !normalizedIncidents.some((incident) => incident.status === "INCLUDED")
  ) {
    res.status(400).json({ error: "Insufficient evidence cannot be finalized as a factual zero" });
    return;
  }
  try {
    const session = await updateIncidentReview(
      params.data.sessionId,
      normalizedIncidents,
      body.data.finalized,
      body.data.expectedVersion,
    );
    res.json(UpdateIncidentReviewResponse.parse(session));
  } catch (error) {
    if (error instanceof AnalysisVersionConflictError) {
      res.status(409).json({
        error: "This review changed after you opened it. Reload before saving.",
      });
      return;
    }
    throw error;
  }
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
