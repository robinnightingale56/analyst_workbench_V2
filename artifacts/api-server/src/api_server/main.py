from __future__ import annotations
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .config import get_settings
from .engine import EVALUATION_VECTORS, HISTORICAL_RATINGS, deduplicate_incidents, incident_citation_error
from .models import ArchiveUpdate, AssessmentInput, CreateSession, IncidentReview, ResearchRun
from .sources import SOURCE_CONNECTORS, is_known_connector
from .store import (
    AnalysisVersionConflictError, FinalizedAnalysisArchiveError, assess_session,
    create_session, get_session, list_sessions, purge_expired_archived_sessions,
    run_research, set_archived, update_review,
)

logger = logging.getLogger("api_server")


def _error(message: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message})


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Database initialization is deliberately lazy in request paths, allowing
    # /healthz and diagnostics to remain available while a database is being
    # provisioned.
    try:
        from .store import _seed
        _seed()
    except Exception as exc:
        logger.warning("Database initialization deferred: %s", exc)

    async def cleanup_loop() -> None:
        while True:
            try:
                policy = get_settings().archive_policy()
                await asyncio.sleep(policy["cleanupIntervalMinutes"] * 60)
                purge_expired_archived_sessions()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Archived-session cleanup failed")
                await asyncio.sleep(60)

    cleanup_task = asyncio.create_task(cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Api", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(RequestValidationError)
async def validation_error(_, exc: RequestValidationError):
    return _error(str(exc), 400)


@app.get("/api/healthz")
async def healthz():
    try:
        policy = get_settings().archive_policy()
    except Exception as exc:
        return _error(str(exc), 503)
    return {"status": "ok", "archivePolicy": policy}


@app.get("/api/analysis-sessions")
async def get_analysis_sessions(includeArchived: bool = Query(False)):
    return list_sessions(includeArchived)


@app.post("/api/analysis-sessions", status_code=201)
async def post_analysis_session(body: CreateSession):
    try:
        return create_session(body.prompt, body.analyst, body.classification, body.provenance, body.runId)
    except ValueError as exc:
        return _error(str(exc), 400)


@app.get("/api/analysis-sessions/{sessionId}")
async def get_analysis_session(sessionId: str):
    session = get_session(sessionId)
    return session if session else _error("Analysis session not found", 404)


@app.patch("/api/analysis-sessions/{sessionId}")
async def patch_analysis_session(sessionId: str, body: ArchiveUpdate):
    try:
        result = set_archived(sessionId, body.archived, body.expectedVersion)
        return result if result else _error("Analysis session not found", 404)
    except (AnalysisVersionConflictError, FinalizedAnalysisArchiveError) as exc:
        return _error(str(exc), 409)


@app.post("/api/analysis-sessions/{sessionId}/research")
async def post_research(sessionId: str, body: ResearchRun):
    if not body.sourceConnectorIds:
        return _error("Select at least one source connector", 400)
    existing = get_session(sessionId)
    if not existing:
        return _error("Analysis session not found", 404)
    if existing["classification"] != "UNCLASSIFIED":
        return _error("Public web research is permitted only for UNCLASSIFIED sessions", 403)
    if any(not is_known_connector(x) for x in body.sourceConnectorIds):
        return _error("One or more source connectors are not supported", 400)
    try:
        result = await run_research(sessionId, body.sourceConnectorIds, body.maxResults)
        return result if result else _error("Analysis session not found", 404)
    except Exception as exc:
        return _error(str(exc), 500)


@app.post("/api/analysis-sessions/{sessionId}/assessment")
async def post_assessment(sessionId: str, body: AssessmentInput):
    if not body.selectedSourceFileIds:
        return _error("Select at least one source file", 400)
    existing = get_session(sessionId)
    if not existing:
        return _error("Analysis session not found", 404)
    valid = {x["id"] for x in existing["sourceFiles"]}
    if any(x not in valid for x in body.selectedSourceFileIds):
        return _error("One or more selected source files do not belong to this session", 400)
    result = assess_session(sessionId, body.selectedSourceFileIds)
    return result if result else _error("Analysis session not found", 404)


@app.patch("/api/analysis-sessions/{sessionId}/assessment")
async def patch_review(sessionId: str, body: IncidentReview):
    existing = get_session(sessionId)
    if not existing or not (existing.get("assessment") or {}).get("countAnswer"):
        return _error("Count assessment not found", 404)
    selected_ids = set(existing["assessment"]["selectedSourceFileIds"])
    selected = [x for x in existing["sourceFiles"] if x["id"] in selected_ids]
    if any(source_id not in selected_ids for incident in body.incidents for source_id in incident.sourceFileIds):
        return _error("An incident cites a source outside the selected evidence set", 400)
    normalized = deduplicate_incidents(body.incidents)
    answer = existing["assessment"]["countAnswer"]
    citation = next((incident_citation_error(x, selected, answer["requestedParties"], answer["dateRange"]) for x in normalized if x["status"] == "INCLUDED"), None)
    if citation:
        return _error(citation, 400)
    if body.finalized and not any(x["status"] == "INCLUDED" for x in normalized):
        return _error("Insufficient evidence cannot be finalized as a factual zero", 400)
    try:
        result = update_review(sessionId, normalized, body.finalized, body.expectedVersion)
        return result if result else _error("Count assessment not found", 404)
    except AnalysisVersionConflictError:
        return _error("This review changed after you opened it. Reload before saving.", 409)


@app.get("/api/source-connectors")
async def source_connectors():
    return SOURCE_CONNECTORS


@app.get("/api/evaluation-vectors")
async def evaluation_vectors():
    return EVALUATION_VECTORS


@app.get("/api/historical-ratings")
async def historical_ratings():
    return HISTORICAL_RATINGS