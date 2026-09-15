from __future__ import annotations
from datetime import datetime, timedelta, timezone
import logging
from uuid import uuid4
from sqlalchemy import delete, select, update
from .config import get_settings
from .db import AnalysisSessionRow, SessionLocal, init_db, utcnow
from .engine import assess_sources
from .models import AnalysisSession, Classification, Incident, SourceFile
from .sources import demonstration_files, research

CONTRACT_TEST_PROVENANCE = "CONTRACT_TEST"
USER_PROVENANCE = "USER"
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
    init_db()
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
            "assessment": None,
        }
        db.add(AnalysisSessionRow(id="demo-session", data=data, version=1, provenance=USER_PROVENANCE, created_at=now, updated_at=now))


def _valid_ownership(provenance: str, run_id: str | None) -> bool:
    has_nonblank_run_id = isinstance(run_id, str) and bool(run_id.strip())
    return (
        provenance == USER_PROVENANCE and run_id is None
    ) or (
        provenance == CONTRACT_TEST_PROVENANCE and has_nonblank_run_id
    )


def _write(session: dict, expected: int) -> dict:
    now = utcnow()
    count_answer = (session.get("assessment") or {}).get("countAnswer") or {}
    finalized = bool(count_answer.get("finalized"))
    payload = {k: v for k, v in session.items() if k not in {"version", "updatedAt", "archivedAt"}}
    with SessionLocal.begin() as db:
        result = db.execute(
            update(AnalysisSessionRow)
            .where(AnalysisSessionRow.id == session["id"], AnalysisSessionRow.version == expected)
            .values(data=payload, version=expected + 1, updated_at=now, finalized_at=now if finalized else None)
        )
        if result.rowcount != 1:
            raise AnalysisVersionConflictError()
        row = db.get(AnalysisSessionRow, session["id"])
        return _session(row)


def get_session(session_id: str) -> dict | None:
    _seed()
    with SessionLocal() as db:
        row = db.get(AnalysisSessionRow, session_id)
        return _session(row) if row else None


def list_sessions(include_archived: bool = False) -> list[dict]:
    _seed()
    try:
        purge_expired_archived_sessions()
    except Exception:
        logger.exception("Archived-session cleanup failed during session listing")
    with SessionLocal() as db:
        query = select(AnalysisSessionRow).order_by(AnalysisSessionRow.created_at.desc())
        if not include_archived:
            query = query.where(AnalysisSessionRow.archived_at.is_(None))
        return [_session(row) for row in db.scalars(query)]


def create_session(prompt: str, analyst: str | None = None, classification: str | None = None,
                   provenance: str | None = None, run_id: str | None = None) -> dict:
    _seed()
    provenance = provenance or USER_PROVENANCE
    if not _valid_ownership(provenance, run_id):
        raise ValueError("Analysis session provenance and runId are inconsistent")
    now = utcnow()
    data = {"id": str(uuid4()), "prompt": prompt, "analyst": analyst or "Current Analyst", "classification": classification or "UNCLASSIFIED", "status": "DRAFT", "createdAt": _iso(now), "sourceFiles": [], "sourceNotices": [], "assessment": None}
    with SessionLocal.begin() as db:
        db.add(AnalysisSessionRow(id=data["id"], data=data, provenance=provenance, run_id=run_id, version=1, created_at=now, updated_at=now))
    return {**data, "version": 1, "updatedAt": _iso(now), "archivedAt": None}


def set_archived(session_id: str, archived: bool, expected: int) -> dict | None:
    _seed()
    session = get_session(session_id)
    if not session:
        return None
    if session["version"] != expected:
        raise AnalysisVersionConflictError()
    if archived and (session.get("assessment") or {}).get("countAnswer", {}).get("finalized"):
        raise FinalizedAnalysisArchiveError()
    now = utcnow()
    with SessionLocal.begin() as db:
        result = db.execute(update(AnalysisSessionRow).where(AnalysisSessionRow.id == session_id, AnalysisSessionRow.version == expected).values(archived_at=now if archived else None, updated_at=now, version=expected + 1))
        if result.rowcount != 1:
            raise AnalysisVersionConflictError()
        return _session(db.get(AnalysisSessionRow, session_id))


async def run_research(session_id: str, connector_ids: list[str], max_results: int | None) -> dict | None:
    session = get_session(session_id)
    if not session:
        return None
    session["status"] = "RESEARCHING"
    current = _write(session, session["version"])
    try:
        files, notices = await research(current["prompt"], connector_ids, max_results or 12)
        current.update(sourceFiles=files, sourceNotices=notices, status="READY_FOR_SELECTION" if files else "FAILED", assessment=None)
        return _write(current, current["version"])
    except Exception as exc:
        current.update(status="FAILED", sourceNotices=[str(exc)])
        _write(current, current["version"])
        raise


def assess_session(session_id: str, selected_ids: list[str]) -> dict | None:
    session = get_session(session_id)
    if not session:
        return None
    selected = [x for x in session["sourceFiles"] if x["id"] in selected_ids]
    session.update(assessment=assess_sources(selected, session["prompt"]), status="COMPLETE")
    return _write(session, session["version"])


def update_review(session_id: str, incidents: list[dict], finalized: bool, expected: int) -> dict | None:
    session = get_session(session_id)
    if not session or not (session.get("assessment") or {}).get("countAnswer"):
        return None
    if session["version"] != expected:
        raise AnalysisVersionConflictError()
    answer = session["assessment"]["countAnswer"]
    answer["incidents"] = incidents
    included = sum(x.get("status") == "INCLUDED" for x in incidents)
    answer.update(provisionalCount=included, answerStatus="SUPPORTED" if included else "INSUFFICIENT_EVIDENCE", finalized=finalized)
    session["assessment"]["provisional"] = not finalized
    return _write(session, expected)


def purge_expired_archived_sessions(now: datetime | None = None) -> int:
    now = now or utcnow()
    cutoff = now - timedelta(days=get_settings().archive_policy()["retentionDays"])
    with SessionLocal.begin() as db:
        result = db.execute(delete(AnalysisSessionRow).where(AnalysisSessionRow.archived_at.is_not(None), AnalysisSessionRow.archived_at < cutoff, AnalysisSessionRow.finalized_at.is_(None)))
        return result.rowcount or 0


def purge_stale_contract_fixtures(active_run_id: str, now: datetime | None = None, stale_after_ms: int = 3_600_000) -> int:
    if not active_run_id:
        raise ValueError("activeRunId is required for stale contract fixture cleanup")
    cutoff = (now or utcnow()) - timedelta(milliseconds=stale_after_ms)
    with SessionLocal.begin() as db:
        result = db.execute(delete(AnalysisSessionRow).where(AnalysisSessionRow.provenance == CONTRACT_TEST_PROVENANCE, AnalysisSessionRow.run_id.is_not(None), AnalysisSessionRow.run_id != active_run_id, AnalysisSessionRow.created_at < cutoff))
        return result.rowcount or 0