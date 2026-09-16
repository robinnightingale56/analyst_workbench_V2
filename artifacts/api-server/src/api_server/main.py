from __future__ import annotations
import asyncio
import logging
from contextlib import asynccontextmanager
import os
from urllib.parse import urlparse
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import httpx
from .auth import require_trusted_origin, require_user, trusted_origins
from .config import get_settings
from .engine import EVALUATION_VECTORS, HISTORICAL_RATINGS, deduplicate_incidents, incident_citation_error
from .models import AnalysisStarters, ArchiveUpdate, AssessmentInput, CreateSession, IncidentReview, ResearchRun
from .sources import SOURCE_CONNECTORS, is_known_connector
from .store import (
    AnalysisVersionConflictError, FinalizedAnalysisArchiveError, assess_session,
    create_session, get_session, list_analysis_starters, list_sessions, purge_expired_archived_sessions,
    run_research, set_archived, update_review,
)

logger = logging.getLogger("api_server")


def _error(message: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message})


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Schema creation and migration run once at process startup. Health checks
    # remain available if an initial database connection is still provisioning.
    try:
        from .db import init_db
        from .store import _seed
        init_db()
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

# The browser application and API are same-origin. If another trusted origin is
# intentionally configured, echo only that explicit allowlist and allow Clerk's
# cookie; wildcard origins are incompatible with credentialed CORS.
allowed_origins = sorted(trusted_origins())
if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type"],
    )


@app.exception_handler(RequestValidationError)
async def validation_error(_, exc: RequestValidationError):
    return _error(str(exc), 400)


@app.get("/api/healthz")
async def healthz():
    try:
        policy = get_settings().archive_policy()
    except Exception:
        return _error("Archive policy configuration is invalid", 503)
    return {"status": "ok", "archivePolicy": policy}


CLERK_PROXY_PATH = "/api/__clerk"
CLERK_FRONTEND_API = "https://frontend-api.clerk.dev"
_HOP_BY_HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
}


def _public_host(request: Request) -> str:
    raw = request.headers.get("x-forwarded-host", request.headers.get("host", ""))
    host = raw.split(",", 1)[0].strip()
    if not host or any(character in host for character in "\r\n/\\"):
        raise HTTPException(status_code=400, detail="Invalid forwarded host")
    if host.lower() not in {
        urlparse(origin).netloc.lower() for origin in trusted_origins()
    }:
        raise HTTPException(status_code=400, detail="Untrusted forwarded host")
    return host


@app.api_route(f"{CLERK_PROXY_PATH}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
@app.api_route(f"{CLERK_PROXY_PATH}/{{proxy_path:path}}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def clerk_frontend_api_proxy(request: Request, proxy_path: str = ""):
    """Production Clerk Frontend API proxy equivalent to the canonical template."""
    if os.getenv("NODE_ENV") != "production" or not os.getenv("CLERK_SECRET_KEY"):
        return _error("Clerk proxy is unavailable", 404)

    protocol = request.headers.get("x-forwarded-proto", "https").split(",", 1)[0].strip()
    if protocol not in {"http", "https"}:
        return _error("Invalid forwarded protocol", 400)
    host = _public_host(request)
    target = f"{CLERK_FRONTEND_API}/{proxy_path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

    outgoing_headers = {
        key: value for key, value in request.headers.items()
        if key.lower() not in _HOP_BY_HOP_HEADERS | {"host", "content-length"}
    }
    outgoing_headers["Clerk-Proxy-Url"] = f"{protocol}://{host}{CLERK_PROXY_PATH}"
    outgoing_headers["Clerk-Secret-Key"] = os.environ["CLERK_SECRET_KEY"]
    client_ip = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if not client_ip and request.client:
        client_ip = request.client.host
    if client_ip:
        outgoing_headers["X-Forwarded-For"] = client_ip

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            upstream = await client.request(
                request.method,
                target,
                headers=outgoing_headers,
                content=await request.body(),
            )
    except httpx.HTTPError:
        logger.exception("Clerk Frontend API proxy request failed")
        return _error("Clerk proxy upstream unavailable", 502)

    response_headers = {
        key: value for key, value in upstream.headers.items()
        if key.lower() not in _HOP_BY_HOP_HEADERS | {"content-length", "set-cookie"}
    }
    # Buffering is intentional: deployment edges reject a chunked relayed
    # Frontend API response. Starlette recalculates Content-Length correctly.
    response = Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
    )
    # Multiple Clerk cookies must remain separate Set-Cookie headers; collapsing
    # them into a comma-separated value prevents browsers from establishing a
    # session after sign-in.
    for cookie in upstream.headers.get_list("set-cookie"):
        response.raw_headers.append((b"set-cookie", cookie.encode("latin-1")))
    return response


@app.get("/api/analysis-sessions")
async def get_analysis_sessions(
    includeArchived: bool = Query(False),
    user_id: str = Depends(require_user),
):
    return list_sessions(includeArchived, owner_id=user_id)


@app.post("/api/analysis-sessions", status_code=201)
async def post_analysis_session(
    body: CreateSession,
    _: None = Depends(require_trusted_origin),
    user_id: str = Depends(require_user),
):
    try:
        return create_session(
            body.prompt,
            body.analyst,
            body.classification,
            owner_id=user_id,
        )
    except ValueError as exc:
        return _error(str(exc), 400)


@app.get("/api/analysis-starters", response_model=AnalysisStarters)
async def get_analysis_starters(user_id: str = Depends(require_user)):
    return list_analysis_starters(owner_id=user_id)


@app.get("/api/analysis-sessions/{sessionId}")
async def get_analysis_session(sessionId: str, user_id: str = Depends(require_user)):
    session = get_session(sessionId, owner_id=user_id)
    return session if session else _error("Analysis session not found", 404)


@app.patch("/api/analysis-sessions/{sessionId}")
async def patch_analysis_session(
    sessionId: str,
    body: ArchiveUpdate,
    _: None = Depends(require_trusted_origin),
    user_id: str = Depends(require_user),
):
    try:
        result = set_archived(sessionId, body.archived, body.expectedVersion, owner_id=user_id)
        return result if result else _error("Analysis session not found", 404)
    except (AnalysisVersionConflictError, FinalizedAnalysisArchiveError) as exc:
        return _error(str(exc), 409)


@app.post("/api/analysis-sessions/{sessionId}/research")
async def post_research(
    sessionId: str,
    body: ResearchRun,
    _: None = Depends(require_trusted_origin),
    user_id: str = Depends(require_user),
):
    if not body.sourceConnectorIds:
        return _error("Select at least one source connector", 400)
    existing = get_session(sessionId, owner_id=user_id)
    if not existing:
        return _error("Analysis session not found", 404)
    if existing["classification"] != "UNCLASSIFIED":
        live_connector_ids = {
            connector["id"] for connector in SOURCE_CONNECTORS
            if connector["mode"] == "LIVE"
        }
        if any(connector_id in live_connector_ids for connector_id in body.sourceConnectorIds):
            return _error("Public web research is permitted only for UNCLASSIFIED sessions", 403)
    if any(not is_known_connector(x) for x in body.sourceConnectorIds):
        return _error("One or more source connectors are not supported", 400)
    try:
        result = await run_research(
            sessionId,
            body.sourceConnectorIds,
            body.maxResults,
            owner_id=user_id,
        )
        return result if result else _error("Analysis session not found", 404)
    except Exception as exc:
        return _error(str(exc), 500)


@app.post("/api/analysis-sessions/{sessionId}/assessment")
async def post_assessment(
    sessionId: str,
    body: AssessmentInput,
    _: None = Depends(require_trusted_origin),
    user_id: str = Depends(require_user),
):
    if not body.selectedSourceFileIds:
        return _error("Select at least one source file", 400)
    existing = get_session(sessionId, owner_id=user_id)
    if not existing:
        return _error("Analysis session not found", 404)
    valid = {x["id"] for x in existing["sourceFiles"]}
    if any(x not in valid for x in body.selectedSourceFileIds):
        return _error("One or more selected source files do not belong to this session", 400)
    result = assess_session(sessionId, body.selectedSourceFileIds, owner_id=user_id)
    return result if result else _error("Analysis session not found", 404)


@app.patch("/api/analysis-sessions/{sessionId}/assessment")
async def patch_review(
    sessionId: str,
    body: IncidentReview,
    _: None = Depends(require_trusted_origin),
    user_id: str = Depends(require_user),
):
    existing = get_session(sessionId, owner_id=user_id)
    if not existing or not (existing.get("assessment") or {}).get("countAnswer"):
        return _error("Count assessment not found", 404)
    selected_ids = set(existing["assessment"]["selectedSourceFileIds"])
    selected = [x for x in existing["sourceFiles"] if x["id"] in selected_ids]
    if any(source_id not in selected_ids for incident in body.incidents for source_id in incident.sourceFileIds):
        return _error("An incident cites a source outside the selected evidence set", 400)
    normalized = deduplicate_incidents(body.incidents)
    if body.finalized:
        for incident in normalized:
            if incident["status"] != "INCLUDED":
                continue
            cited = set(incident["sourceFileIds"])
            spanned = {
                span["sourceFileId"]
                for span in incident.get("evidenceSpans", [])
            }
            if cited != spanned:
                return _error(
                    "Every included incident requires an exact evidence span for each citation",
                    400,
                )
    answer = existing["assessment"]["countAnswer"]
    citation = next((incident_citation_error(x, selected, answer["requestedParties"], answer["dateRange"]) for x in normalized if x["status"] == "INCLUDED"), None)
    if citation:
        return _error(citation, 400)
    if body.finalized and not any(x["status"] == "INCLUDED" for x in normalized):
        return _error("Insufficient evidence cannot be finalized as a factual zero", 400)
    try:
        result = update_review(
            sessionId,
            normalized,
            body.finalized,
            body.expectedVersion,
            owner_id=user_id,
        )
        return result if result else _error("Count assessment not found", 404)
    except AnalysisVersionConflictError:
        return _error("This review changed after you opened it. Reload before saving.", 409)


@app.get("/api/source-connectors")
async def source_connectors(_: str = Depends(require_user)):
    return SOURCE_CONNECTORS


@app.get("/api/evaluation-vectors")
async def evaluation_vectors(_: str = Depends(require_user)):
    return EVALUATION_VECTORS


@app.get("/api/historical-ratings")
async def historical_ratings(_: str = Depends(require_user)):
    return HISTORICAL_RATINGS