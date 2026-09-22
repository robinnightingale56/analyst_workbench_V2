from __future__ import annotations
from datetime import datetime, timedelta, timezone
import logging
from uuid import uuid4
from sqlalchemy import delete, select, update
from .config import get_settings
from .db import (
    AnalysisSessionRow,
    CONTRACT_TEST_PROVENANCE as DB_CONTRACT_TEST_PROVENANCE,
    LEGACY_UNASSIGNED_PROVENANCE,
    SessionLocal,
    USER_PROVENANCE as DB_USER_PROVENANCE,
    utcnow,
)
from .engine import assess_sources
from .models import AnalysisSession, Classification, Incident, SourceFile
from .sources import (
    blocked_current_event_feed,
    demonstration_files,
    discover_current_events,
    research,
)

CONTRACT_TEST_PROVENANCE = DB_CONTRACT_TEST_PROVENANCE
USER_PROVENANCE = DB_USER_PROVENANCE
logger = logging.getLogger("api_server.store")


class AnalysisVersionConflictError(Exception):
    def __init__(self) -> None:
        super().__init__("Analysis session was updated by another request")


class FinalizedAnalysisArchiveError(Exception):
    def __init__(self) -> None:
        super().__init__("Finalized analysis reviews cannot be archived")


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _session(row: AnalysisSessionRow) -> dict:
    data = dict(row.data)
    data.update(version=row.version, updatedAt=_iso(row.updated_at), archivedAt=_iso(row.archived_at))
    return data


def _seed() -> None:
    with SessionLocal.begin() as db:
        if db.get(AnalysisSessionRow, "demo-session"):
            return
        now = utcnow()
        data = {
            "id": "demo-session",
            "prompt": "Assess the near-term implications of the reported operating-environment shift and identify indicators that would change the judgment.",
            "analyst": "Demo Analyst", "classification": "UNCLASSIFIED", "status": "READY_FOR_SELECTION",
            "createdAt": _iso(now), "sourceFiles": demonstration_files("operating environment implications"),
            "sourceNotices": ["This saved training session contains synthetic demonstration records."],
            "sourceConnectorIds": ["demonstration-library"],
            "assessment": None,
        }
        # Demonstration data predates user ownership and remains deliberately
        # unassigned. It is never presented to the first (or any) signed-in user.
        db.add(AnalysisSessionRow(id="demo-session", data=data, version=1, provenance=LEGACY_UNASSIGNED_PROVENANCE, created_at=now, updated_at=now))


def _valid_ownership(provenance: str, run_id: str | None) -> bool:
    has_nonblank_run_id = isinstance(run_id, str) and bool(run_id.strip())
    return (
        provenance == USER_PROVENANCE and run_id is None
    ) or (
        provenance == CONTRACT_TEST_PROVENANCE and has_nonblank_run_id
    )


def _write(session: dict, expected: int, owner_id: str | None = None) -> dict:
    now = utcnow()
    count_answer = (session.get("assessment") or {}).get("countAnswer") or {}
    finalized = bool(count_answer.get("finalized"))
    payload = {k: v for k, v in session.items() if k not in {"version", "updatedAt", "archivedAt"}}
    with SessionLocal.begin() as db:
        statement = update(AnalysisSessionRow).where(
            AnalysisSessionRow.id == session["id"],
            AnalysisSessionRow.version == expected,
        )
        if owner_id is not None:
            statement = statement.where(
                AnalysisSessionRow.owner_id == owner_id,
                AnalysisSessionRow.provenance == USER_PROVENANCE,
            )
        result = db.execute(statement.values(
            data=payload, version=expected + 1, updated_at=now,
            finalized_at=now if finalized else None,
        ))
        if result.rowcount != 1:
            raise AnalysisVersionConflictError()
        row = db.get(AnalysisSessionRow, session["id"])
        return _session(row)


def get_session(session_id: str, owner_id: str | None = None) -> dict | None:
    _seed()
    with SessionLocal() as db:
        statement = select(AnalysisSessionRow).where(AnalysisSessionRow.id == session_id)
        if owner_id is not None:
            statement = statement.where(
                AnalysisSessionRow.owner_id == owner_id,
                AnalysisSessionRow.provenance == USER_PROVENANCE,
            )
        row = db.scalar(statement)
        return _session(row) if row else None


def list_sessions(include_archived: bool = False, owner_id: str | None = None) -> list[dict]:
    _seed()
    try:
        purge_expired_archived_sessions()
    except Exception:
        logger.exception("Archived-session cleanup failed during session listing")
    with SessionLocal() as db:
        query = select(AnalysisSessionRow).order_by(AnalysisSessionRow.created_at.desc())
        if owner_id is not None:
            query = query.where(
                AnalysisSessionRow.owner_id == owner_id,
                AnalysisSessionRow.provenance == USER_PROVENANCE,
            )
        if not include_archived:
            query = query.where(AnalysisSessionRow.archived_at.is_(None))
        return [_session(row) for row in db.scalars(query)]


def _is_live_source(source: dict) -> bool:
    tags = {str(tag).lower() for tag in source.get("tags", [])}
    method = str(source.get("collectionMethod", "")).lower()
    return (
        "live" in tags
        or "google news" in method
        or "bing news" in method
        or "federal register" in method
        or "crossref" in method
    )


def _parse_iso_timestamp(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value


def list_analysis_starters(owner_id: str) -> dict:
    """Return only the caller's saved questions and dated prior-research leads.

    Leads are deliberately derived from prior user-owned retrieval. This avoids
    implying that static templates or synthetic training records are current events.
    """
    sessions = list_sessions(owner_id=owner_id)
    recent = [
        {
            "sessionId": session["id"],
            "prompt": session["prompt"],
            "classification": session["classification"],
            "updatedAt": session["updatedAt"],
        }
        for session in sessions[:8]
    ]
    events: list[dict] = []
    seen_urls: set[str] = set()
    for session in sessions:
        for source in session.get("sourceFiles", []):
            url = source.get("url", "")
            provider_published_at = _parse_iso_timestamp(source.get("providerPublishedAt"))
            retrieved_at = _parse_iso_timestamp(source.get("retrievedAt"))
            if (
                len(events) >= 8
                or not url
                or url in seen_urls
                or source.get("publicationDateSource") != "PROVIDER"
                or not provider_published_at
                or not retrieved_at
                or not _is_live_source(source)
            ):
                continue
            seen_urls.add(url)
            title = str(source.get("title", "Dated source result"))
            events.append({
                "sessionId": session["id"],
                "title": title,
                "question": (
                    f"What does the dated reporting “{title}” indicate for the decision need, "
                    "and what information would change the provisional judgment?"
                ),
                "sourceTitle": str(source.get("source", "Source")),
                "sourceUrl": url,
                "publishedAt": provider_published_at,
                "retrievedAt": retrieved_at,
            })
    return {"recentQuestions": recent, "ongoingEvents": events}


async def list_current_events(classification: Classification | str = Classification.UNCLASSIFIED) -> dict:
    """Return shared public discovery without reading or mutating sessions.

    Public RSS collection is permitted only for UNCLASSIFIED discovery.  Keep
    this authorization gate separate from ``list_analysis_starters`` so adding
    the feed cannot accidentally broaden the owner-scoped starter query. Gate
    before cache access too: restricted requests must neither receive a warm
    public snapshot nor join/start an in-flight public collection.
    """
    value = classification.value if isinstance(classification, Classification) else classification
    if value != Classification.UNCLASSIFIED.value:
        return blocked_current_event_feed()
    return await discover_current_events()


def create_session(prompt: str, analyst: str | None = None, classification: str | None = None,
                   provenance: str | None = None, run_id: str | None = None,
                   owner_id: str | None = None) -> dict:
    _seed()
    provenance = provenance or USER_PROVENANCE
    if not _valid_ownership(provenance, run_id):
        raise ValueError("Analysis session provenance and runId are inconsistent")
    if provenance == USER_PROVENANCE and (not isinstance(owner_id, str) or not owner_id.strip()):
        raise ValueError("User analysis sessions require an authenticated owner")
    if provenance == CONTRACT_TEST_PROVENANCE and owner_id is not None:
        raise ValueError("Contract test analysis sessions cannot have a user owner")
    now = utcnow()
    data = {"id": str(uuid4()), "prompt": prompt, "analyst": analyst or "Current Analyst", "classification": classification or "UNCLASSIFIED", "status": "DRAFT", "createdAt": _iso(now), "sourceFiles": [], "sourceNotices": [], "sourceConnectorIds": [], "assessment": None}
    with SessionLocal.begin() as db:
        db.add(AnalysisSessionRow(id=data["id"], data=data, provenance=provenance, owner_id=owner_id, run_id=run_id, version=1, created_at=now, updated_at=now))
    return {**data, "version": 1, "updatedAt": _iso(now), "archivedAt": None}


def set_archived(session_id: str, archived: bool, expected: int, owner_id: str | None = None) -> dict | None:
    _seed()
    session = get_session(session_id, owner_id)
    if not session:
        return None
    if session["version"] != expected:
        raise AnalysisVersionConflictError()
    if archived and (session.get("assessment") or {}).get("countAnswer", {}).get("finalized"):
        raise FinalizedAnalysisArchiveError()
    now = utcnow()
    with SessionLocal.begin() as db:
        statement = update(AnalysisSessionRow).where(
            AnalysisSessionRow.id == session_id,
            AnalysisSessionRow.version == expected,
        )
        if owner_id is not None:
            statement = statement.where(
                AnalysisSessionRow.owner_id == owner_id,
                AnalysisSessionRow.provenance == USER_PROVENANCE,
            )
        result = db.execute(statement.values(
            archived_at=now if archived else None, updated_at=now, version=expected + 1,
        ))
        if result.rowcount != 1:
            raise AnalysisVersionConflictError()
        return _session(db.get(AnalysisSessionRow, session_id))


async def run_research(session_id: str, connector_ids: list[str], max_results: int | None, owner_id: str | None = None) -> dict | None:
    session = get_session(session_id, owner_id)
    if not session:
        return None
    session["status"] = "RESEARCHING"
    current = _write(session, session["version"], owner_id)
    try:
        files, notices = await research(current["prompt"], connector_ids, max_results or 12)
        current.update(sourceFiles=files, sourceNotices=notices, sourceConnectorIds=connector_ids, status="READY_FOR_SELECTION" if files else "FAILED", assessment=None)
        return _write(current, current["version"], owner_id)
    except Exception as exc:
        current.update(status="FAILED", sourceNotices=[str(exc)])
        _write(current, current["version"], owner_id)
        raise


def assess_session(session_id: str, selected_ids: list[str], owner_id: str | None = None) -> dict | None:
    session = get_session(session_id, owner_id)
    if not session:
        return None
    selected = [x for x in session["sourceFiles"] if x["id"] in selected_ids]
    session.update(assessment=assess_sources(selected, session["prompt"]), status="COMPLETE")
    return _write(session, session["version"], owner_id)


def update_review(session_id: str, incidents: list[dict], finalized: bool, expected: int, owner_id: str | None = None) -> dict | None:
    session = get_session(session_id, owner_id)
    if not session or not (session.get("assessment") or {}).get("countAnswer"):
        return None
    if session["version"] != expected:
        raise AnalysisVersionConflictError()
    answer = session["assessment"]["countAnswer"]
    answer["incidents"] = incidents
    included = sum(x.get("status") == "INCLUDED" for x in incidents)
    answer.update(provisionalCount=included, answerStatus="SUPPORTED" if included else "INSUFFICIENT_EVIDENCE", finalized=finalized)
    session["assessment"]["provisional"] = not finalized
    return _write(session, expected, owner_id)


def purge_expired_archived_sessions(now: datetime | None = None) -> int:
    now = now or utcnow()
    cutoff = now - timedelta(days=get_settings().archive_policy()["retentionDays"])
    with SessionLocal.begin() as db:
        result = db.execute(delete(AnalysisSessionRow).where(AnalysisSessionRow.archived_at.is_not(None), AnalysisSessionRow.archived_at < cutoff, AnalysisSessionRow.finalized_at.is_(None)))
        return result.rowcount or 0


def purge_stale_contract_fixtures(active_run_id: str, now: datetime | None = None, stale_after_ms: int = 3_600_000) -> int:
    if not isinstance(active_run_id, str) or not active_run_id.strip():
        raise ValueError("activeRunId is required for stale contract fixture cleanup")
    cutoff = (now or utcnow()) - timedelta(milliseconds=stale_after_ms)
    with SessionLocal.begin() as db:
        result = db.execute(delete(AnalysisSessionRow).where(AnalysisSessionRow.provenance == CONTRACT_TEST_PROVENANCE, AnalysisSessionRow.run_id.is_not(None), AnalysisSessionRow.run_id != active_run_id, AnalysisSessionRow.created_at < cutoff))
        return result.rowcount or 0