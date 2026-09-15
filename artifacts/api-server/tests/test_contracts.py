import os
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
import pytest
from sqlalchemy.exc import IntegrityError

# Keep contract tests self-contained; production uses DATABASE_URL and the
# PostgreSQL-compatible table below unchanged.
_db_file = Path("/tmp/api-server-contracts.sqlite")
_db_file.unlink(missing_ok=True)
os.environ.pop("DATABASE_URL", None)
os.environ["API_DATABASE_URL"] = f"sqlite:///{_db_file}"

from api_server.engine import build_count_answer  # noqa: E402
from api_server.store import (  # noqa: E402
    AnalysisVersionConflictError,
    CONTRACT_TEST_PROVENANCE,
    _write,
    create_session,
    get_session,
)
from api_server.db import AnalysisSessionRow, SessionLocal, utcnow  # noqa: E402
from api_server.main import app  # noqa: E402
from api_server.models import Incident  # noqa: E402
from api_server.store import list_sessions  # noqa: E402


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
    session = create_session("Assess the operating environment")
    current = get_session(session["id"])
    assert current is not None
    first = dict(current)
    first["analyst"] = "writer one"
    saved = _write(first, current["version"])
    stale = dict(current)
    stale["analyst"] = "writer two"
    try:
        _write(stale, current["version"])
    except AnalysisVersionConflictError as exc:
        assert str(exc) == "Analysis session was updated by another request"
    else:
        raise AssertionError("stale writer unexpectedly succeeded")
    assert get_session(session["id"])["analyst"] == "writer one"
    assert saved["version"] == current["version"] + 1


def test_http_research_and_assessment_flow_returns_compatible_session():
    with TestClient(app) as client:
        created = client.post(
            "/api/analysis-sessions",
            json={
                "prompt": "How many times did Country Alpha and Country Beta clash in 2026?",
                "classification": "UNCLASSIFIED",
            },
        )
        assert created.status_code == 201
        session = created.json()

        researched = client.post(
            f"/api/analysis-sessions/{session['id']}/research",
            json={"sourceConnectorIds": ["demonstration-library"], "maxResults": 4},
        )
        assert researched.status_code == 200
        researched_session = researched.json()
        assert researched_session["status"] == "READY_FOR_SELECTION"
        source_ids = [source["id"] for source in researched_session["sourceFiles"]]

        assessed = client.post(
            f"/api/analysis-sessions/{session['id']}/assessment",
            json={"selectedSourceFileIds": source_ids},
        )
        assert assessed.status_code == 200
        assessment = assessed.json()["assessment"]
        assert assessment["provisional"] is True
        assert assessment["countAnswer"]["answerStatus"] == "SUPPORTED"
        assert assessment["countAnswer"]["provisionalCount"] == 1


@pytest.mark.parametrize("run_id", ["", " \t\n "])
def test_api_rejects_blank_contract_test_run_ids(run_id):
    with TestClient(app) as client:
        response = client.post(
            "/api/analysis-sessions",
            json={
                "prompt": "Reject blank contract run metadata",
                "provenance": CONTRACT_TEST_PROVENANCE,
                "runId": run_id,
            },
        )
    assert response.status_code == 400
    assert "provenance and runId are inconsistent" in response.json()["error"]


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


def test_store_accepts_valid_ownership_metadata():
    analyst_session = create_session("Accept analyst ownership metadata")
    contract_session = create_session(
        "Accept contract ownership metadata",
        provenance=CONTRACT_TEST_PROVENANCE,
        run_id="contract-run",
    )
    assert analyst_session["id"]
    assert contract_session["id"]


def test_session_listing_survives_cleanup_failure():
    create_session("Assess cleanup isolation")
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