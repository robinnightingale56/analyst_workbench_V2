import os
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
import httpx
import pytest
from sqlalchemy.exc import IntegrityError

# Keep contract tests self-contained; production uses DATABASE_URL and the
# PostgreSQL-compatible table below unchanged.
_db_file = Path("/tmp/api-server-contracts.sqlite")
_db_file.unlink(missing_ok=True)
os.environ.pop("DATABASE_URL", None)
os.environ["API_DATABASE_URL"] = f"sqlite:///{_db_file}"
os.environ["ALLOWED_ORIGINS"] = "http://testserver"

from api_server.engine import build_count_answer  # noqa: E402
from api_server.auth import require_user  # noqa: E402
from api_server.store import (  # noqa: E402
    AnalysisVersionConflictError,
    CONTRACT_TEST_PROVENANCE,
    _write,
    create_session,
    get_session,
    purge_stale_contract_fixtures,
)
from api_server.db import AnalysisSessionRow, SessionLocal, init_db, utcnow  # noqa: E402
from api_server.main import app  # noqa: E402
from api_server.models import Incident  # noqa: E402
from api_server.store import list_sessions  # noqa: E402


@pytest.fixture(autouse=True)
def initialized_database():
    # Store unit tests intentionally call persistence helpers directly, while
    # application startup owns the production migration.
    init_db()


@pytest.fixture
async def client():
    async with app.router.lifespan_context(app):
        app.dependency_overrides[require_user] = lambda: "contract-test-user"
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
            headers={"Origin": "http://testserver"},
        ) as async_client:
            yield async_client
        app.dependency_overrides.pop(require_user, None)


def _source(source_id: str, content: str) -> dict:
    return {
        "id": source_id,
        "title": "report",
        "source": "test",
        "sourceType": "NEWS",
        "publishedAt": "2026-09-12T00:00:00Z",
        "relevance": 0.9,
        "reliability": "HIGH",
        "bluf": "report",
        "keyPoints": [],
        "tags": [],
        "url": "https://example.test/report",
        "retrievedAt": "2026-09-12T00:00:00Z",
        "collectionMethod": "test",
        "content": content,
        "contentDepth": "FULL_TEXT",
    }


def test_count_excludes_unsupported_and_deduplicates_corroboration():
    first = _source(
        "one",
        "On 12 September 2026, Country Alpha and Country Beta exchanged fire near the North Ridge border crossing.",
    )
    second = _source(
        "two",
        "Country Alpha and Country Beta clashed at the North Ridge border crossing on 12 September 2026.",
    )
    answer = build_count_answer(
        "How many times did Country Alpha and Country Beta clash in 2026?",
        [first, second],
    )
    assert answer is not None
    assert answer["provisionalCount"] == 1
    assert answer["incidents"][0]["sourceFileIds"] == ["one", "two"]


def test_optimistic_version_compare_and_swap_rejects_stale_writer():
    session = create_session("Assess the operating environment", owner_id="writer-test-user")
    current = get_session(session["id"], owner_id="writer-test-user")
    assert current is not None
    first = dict(current)
    first["analyst"] = "writer one"
    saved = _write(first, current["version"], owner_id="writer-test-user")
    stale = dict(current)
    stale["analyst"] = "writer two"
    try:
        _write(stale, current["version"], owner_id="writer-test-user")
    except AnalysisVersionConflictError as exc:
        assert str(exc) == "Analysis session was updated by another request"
    else:
        raise AssertionError("stale writer unexpectedly succeeded")
    assert get_session(session["id"], owner_id="writer-test-user")["analyst"] == "writer one"
    assert saved["version"] == current["version"] + 1


@pytest.mark.asyncio
async def test_http_research_and_assessment_flow_returns_compatible_session(client):
    created = await client.post(
        "/api/analysis-sessions",
        json={
            "prompt": "How many times did Country Alpha and Country Beta clash in 2026?",
            "classification": "UNCLASSIFIED",
        },
    )
    assert created.status_code == 201
    session = created.json()

    researched = await client.post(
        f"/api/analysis-sessions/{session['id']}/research",
        json={"sourceConnectorIds": ["demonstration-library"], "maxResults": 4},
    )
    assert researched.status_code == 200
    researched_session = researched.json()
    assert researched_session["status"] == "READY_FOR_SELECTION"
    source_ids = [source["id"] for source in researched_session["sourceFiles"]]

    assessed = await client.post(
        f"/api/analysis-sessions/{session['id']}/assessment",
        json={"selectedSourceFileIds": source_ids},
    )
    assert assessed.status_code == 200
    assessment = assessed.json()["assessment"]
    assert assessment["provisional"] is True
    assert assessment["countAnswer"]["answerStatus"] == "SUPPORTED"
    assert assessment["countAnswer"]["provisionalCount"] == 1

    assessed_session = assessed.json()
    incidents = assessment["countAnswer"]["incidents"]
    without_spans = [
        {key: value for key, value in incident.items() if key != "evidenceSpans"}
        for incident in incidents
    ]
    rejected = await client.patch(
        f"/api/analysis-sessions/{session['id']}/assessment",
        json={
            "expectedVersion": assessed_session["version"],
            "finalized": True,
            "incidents": without_spans,
        },
    )
    assert rejected.status_code == 400
    assert rejected.json() == {
        "error": "Every included incident requires an exact evidence span for each citation"
    }

    finalized = await client.patch(
        f"/api/analysis-sessions/{session['id']}/assessment",
        json={
            "expectedVersion": assessed_session["version"],
            "finalized": True,
            "incidents": incidents,
        },
    )
    assert finalized.status_code == 200
    assert finalized.json()["assessment"]["countAnswer"]["finalized"] is True


@pytest.mark.parametrize("run_id", ["", " \t\n "])
@pytest.mark.asyncio
async def test_api_rejects_blank_contract_test_run_ids(run_id, client):
    response = await client.post(
        "/api/analysis-sessions",
        json={
            "prompt": "Reject blank contract run metadata",
            "provenance": CONTRACT_TEST_PROVENANCE,
            "runId": run_id,
        },
    )
    assert response.status_code == 400
    assert "Extra inputs are not permitted" in response.json()["error"]


@pytest.mark.parametrize("run_id", ["", " \t\n "])
def test_store_rejects_blank_contract_test_run_ids(run_id):
    with pytest.raises(
        ValueError,
        match="provenance and runId are inconsistent",
    ):
        create_session(
            "Reject blank contract run metadata",
            provenance=CONTRACT_TEST_PROVENANCE,
            run_id=run_id,
        )


@pytest.mark.parametrize("run_id", [None, "", " \t\n "])
def test_database_rejects_contract_test_sessions_without_nonblank_run_id(run_id):
    now = utcnow()
    row = AnalysisSessionRow(
        id=f"invalid-contract-run-{repr(run_id)}",
        data={"prompt": "Reject invalid contract run metadata"},
        provenance=CONTRACT_TEST_PROVENANCE,
        run_id=run_id,
        version=1,
        created_at=now,
        updated_at=now,
    )
    with pytest.raises(IntegrityError):
        with SessionLocal.begin() as db:
            db.add(row)


def test_database_rejects_new_user_session_without_an_owner():
    now = utcnow()
    row = AnalysisSessionRow(
        id="invalid-user-owner",
        data={"prompt": "Reject missing user owner"},
        provenance="USER",
        run_id=None,
        version=1,
        created_at=now,
        updated_at=now,
    )
    with pytest.raises(IntegrityError):
        with SessionLocal.begin() as db:
            db.add(row)


def test_store_accepts_valid_ownership_metadata():
    analyst_session = create_session(
        "Accept analyst ownership metadata",
        owner_id="ownership-test-user",
    )
    contract_session = create_session(
        "Accept contract ownership metadata",
        provenance=CONTRACT_TEST_PROVENANCE,
        run_id="contract-run",
    )
    assert analyst_session["id"]
    assert contract_session["id"]


@pytest.mark.parametrize("active_run_id", ["", " \t\n "])
def test_stale_fixture_cleanup_rejects_blank_active_run_without_deleting_fixtures(
    active_run_id,
):
    now = utcnow()
    active = create_session(
        "Keep the active contract fixture",
        provenance=CONTRACT_TEST_PROVENANCE,
        run_id="active-contract-run",
    )
    other = create_session(
        "Keep the other valid contract fixture",
        provenance=CONTRACT_TEST_PROVENANCE,
        run_id="other-contract-run",
    )
    fixture_ids = [active["id"], other["id"]]
    with SessionLocal.begin() as db:
        for fixture_id in fixture_ids:
            db.get(AnalysisSessionRow, fixture_id).created_at = now - timedelta(hours=2)

    with pytest.raises(
        ValueError,
        match="activeRunId is required for stale contract fixture cleanup",
    ):
        purge_stale_contract_fixtures(
            active_run_id,
            now=now,
            stale_after_ms=3_600_000,
        )

    with SessionLocal.begin() as db:
        for fixture_id in fixture_ids:
            fixture = db.get(AnalysisSessionRow, fixture_id)
            assert fixture is not None
            db.delete(fixture)


def test_stale_fixture_cleanup_preserves_active_and_recent_runs():
    now = utcnow()
    active = create_session(
        "Keep the active contract fixture",
        provenance=CONTRACT_TEST_PROVENANCE,
        run_id="active-cleanup-run",
    )
    stale = create_session(
        "Remove the stale contract fixture",
        provenance=CONTRACT_TEST_PROVENANCE,
        run_id="stale-cleanup-run",
    )
    recent = create_session(
        "Keep the recent contract fixture",
        provenance=CONTRACT_TEST_PROVENANCE,
        run_id="recent-cleanup-run",
    )
    with SessionLocal.begin() as db:
        db.get(AnalysisSessionRow, active["id"]).created_at = now - timedelta(hours=2)
        db.get(AnalysisSessionRow, stale["id"]).created_at = now - timedelta(hours=2)

    assert purge_stale_contract_fixtures(
        "active-cleanup-run",
        now=now,
        stale_after_ms=3_600_000,
    ) == 1

    with SessionLocal.begin() as db:
        active_row = db.get(AnalysisSessionRow, active["id"])
        recent_row = db.get(AnalysisSessionRow, recent["id"])
        assert active_row is not None
        assert db.get(AnalysisSessionRow, stale["id"]) is None
        assert recent_row is not None
        db.delete(active_row)
        db.delete(recent_row)


def test_session_listing_survives_cleanup_failure():
    create_session("Assess cleanup isolation", owner_id="cleanup-test-user")
    with patch(
        "api_server.store.purge_expired_archived_sessions",
        side_effect=RuntimeError("cleanup unavailable"),
    ):
        assert list_sessions()


def test_incident_parties_reject_blank_values():
    try:
        Incident(
            id="incident",
            date="2026-09-12T00:00:00Z",
            location="North Ridge",
            parties=["Country Alpha", " "],
            description="Country Alpha and Country Beta clashed.",
            sourceFileIds=["source"],
            status="EXCLUDED",
        )
    except ValueError as exc:
        assert "incident parties must not be blank" in str(exc)
    else:
        raise AssertionError("blank incident party unexpectedly passed validation")