"""Cross-runtime contract tests for the Drizzle-managed PostgreSQL schema."""

from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import pytest
from sqlalchemy import delete, inspect, select, text, update
from sqlalchemy.exc import IntegrityError


POSTGRES_ENABLED = os.getenv("POSTGRES_INTEGRATION") == "1"
pytestmark = pytest.mark.skipif(
    not POSTGRES_ENABLED,
    reason="Run with POSTGRES_INTEGRATION=1 against the development PostgreSQL database",
)
ARTIFACT_ROOT = Path(__file__).resolve().parents[1]


@dataclass
class ContractRun:
    run_id: str = field(default_factory=lambda: f"python-postgres-{uuid4()}")
    ids: set[str] = field(default_factory=set)

    def new_id(self, label: str) -> str:
        value = f"{label}-{uuid4()}"
        self.ids.add(value)
        return value


@pytest.fixture(scope="module")
def contract_run():
    import psycopg
    from psycopg import sql

    original_url = os.getenv("DATABASE_URL")
    assert original_url, "PostgreSQL compatibility tests require DATABASE_URL"
    assert "api_server.db" not in sys.modules, (
        "The isolated PostgreSQL schema must be configured before importing api_server.db"
    )
    schema_name = f"python_contract_{uuid4().hex}"
    psycopg_url = original_url.replace(
        "postgresql+psycopg://",
        "postgresql://",
        1,
    )
    with psycopg.connect(psycopg_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL("CREATE SCHEMA {}").format(
                sql.Identifier(schema_name),
            ))
            cursor.execute(sql.SQL(
                "CREATE TABLE {}.analysis_sessions "
                "(LIKE public.analysis_sessions INCLUDING ALL)"
            ).format(sql.Identifier(schema_name)))

    parsed = urlsplit(original_url)
    query = parse_qsl(parsed.query, keep_blank_values=True)
    query = [
        (key, value)
        for key, value in query
        if key != "options"
    ]
    query.append(("options", f"-csearch_path={schema_name},public"))
    os.environ["DATABASE_URL"] = urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment)
    )

    engine = None
    SessionLocal = None
    AnalysisSessionRow = None
    run = None
    try:
        from api_server.db import (
            AnalysisSessionRow as SessionRow,
            SessionLocal as SessionFactory,
            engine as database_engine,
        )

        AnalysisSessionRow = SessionRow
        SessionLocal = SessionFactory
        engine = database_engine
        assert engine.dialect.name == "postgresql", (
            "POSTGRES_INTEGRATION=1 requires DATABASE_URL to point to PostgreSQL"
        )
        run = ContractRun()
        yield run
    finally:
        if SessionLocal is not None and AnalysisSessionRow is not None and run is not None:
            with SessionLocal.begin() as db:
                db.execute(
                    delete(AnalysisSessionRow).where(
                        (AnalysisSessionRow.run_id == run.run_id)
                        | (AnalysisSessionRow.id.in_(run.ids))
                    )
                )
        if engine is not None:
            engine.dispose()
        os.environ["DATABASE_URL"] = original_url
        with psycopg.connect(psycopg_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(
                    sql.Identifier(schema_name),
                ))


def _typescript_fixture(action: str, fixture_id: str, run_id: str) -> None:
    result = subprocess.run(
        [
            "pnpm",
            "--filter",
            "@workspace/scripts",
            "exec",
            "tsx",
            "../artifacts/api-server/tests/postgres_fixture.ts",
            action,
            fixture_id,
            run_id,
        ],
        cwd=ARTIFACT_ROOT,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, (
        f"TypeScript PostgreSQL fixture failed ({action}):\n"
        f"{result.stdout}\n{result.stderr}"
    )


def test_cloned_drizzle_schema_matches_jsonb_timestamp_constraint_and_indexes(
    contract_run,
):
    from api_server.db import SessionLocal, engine

    columns = {column["name"]: column for column in inspect(engine).get_columns("analysis_sessions")}
    assert str(columns["data"]["type"]).upper() == "JSONB"
    for name in ("archived_at", "finalized_at", "created_at", "updated_at"):
        assert columns[name]["type"].timezone is True

    with SessionLocal() as db:
        constraints = dict(db.execute(text("""
            SELECT c.conname, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname = 'analysis_sessions'
        """)).all())
        indexes = dict(db.execute(text("""
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'analysis_sessions'
        """)).all())

    ownership = constraints[
        "analysis_sessions_ownership_nonwhitespace_run_id_required_check"
    ]
    assert "provenance = 'USER'" in ownership
    assert "provenance = 'CONTRACT_TEST'" in ownership
    assert "run_id IS NULL" in ownership
    assert "run_id !~ '^[[:space:]]*$'" in ownership

    expired = indexes["analysis_sessions_expired_archive_idx"]
    assert "archived_at IS NOT NULL" in expired
    assert "finalized_at IS NULL" in expired
    stale = indexes["analysis_sessions_stale_contract_fixture_idx"]
    assert "provenance = 'CONTRACT_TEST'" in stale
    assert "created_at" in stale and "run_id" in stale


def test_typescript_row_is_read_and_compare_and_swap_updated_by_python(contract_run):
    from api_server.store import AnalysisVersionConflictError, _write, get_session

    fixture_id = contract_run.new_id("typescript-created")
    _typescript_fixture("seed", fixture_id, contract_run.run_id)

    current = get_session(fixture_id)
    assert current is not None
    assert current["analyst"] == "Drizzle Analyst"
    assert current["sourceNotices"] == ["Unicode and JSONB survive: café 東京"]
    assert current["legacyExtension"] == {
        "nested": True,
        "values": [1, "two", None],
    }
    assert current["updatedAt"] == "2026-09-15T12:34:56.789000Z"

    changed = dict(current)
    changed["analyst"] = "Python Analyst"
    saved = _write(changed, current["version"])
    assert saved["version"] == 2

    stale = dict(current)
    stale["analyst"] = "Stale Python Writer"
    with pytest.raises(AnalysisVersionConflictError):
        _write(stale, current["version"])

    _typescript_fixture("assert-python-update", fixture_id, contract_run.run_id)


def test_python_rows_satisfy_application_and_database_ownership_rules(contract_run):
    from api_server.db import AnalysisSessionRow, SessionLocal, utcnow
    from api_server.store import CONTRACT_TEST_PROVENANCE, create_session

    analyst = create_session("Python analyst-owned PostgreSQL session")
    contract_run.ids.add(analyst["id"])
    contract = create_session(
        "Python contract-owned PostgreSQL session",
        provenance=CONTRACT_TEST_PROVENANCE,
        run_id=contract_run.run_id,
    )
    contract_run.ids.add(contract["id"])

    with SessionLocal() as db:
        analyst_row = db.get(AnalysisSessionRow, analyst["id"])
        contract_row = db.get(AnalysisSessionRow, contract["id"])
        assert analyst_row.provenance == "USER" and analyst_row.run_id is None
        assert contract_row.provenance == "CONTRACT_TEST"
        assert contract_row.run_id == contract_run.run_id
        assert analyst_row.created_at.tzinfo is not None
        assert contract_row.updated_at.tzinfo is not None

    with pytest.raises(ValueError, match="provenance and runId are inconsistent"):
        create_session(
            "Reject a Python USER row with run ownership",
            provenance="USER",
            run_id=contract_run.run_id,
        )
    with pytest.raises(ValueError, match="provenance and runId are inconsistent"):
        create_session(
            "Reject a Python contract row without run ownership",
            provenance=CONTRACT_TEST_PROVENANCE,
        )

    now = utcnow()
    invalid_id = contract_run.new_id("database-invalid-ownership")
    with pytest.raises(IntegrityError):
        with SessionLocal.begin() as db:
            db.add(AnalysisSessionRow(
                id=invalid_id,
                data={"id": invalid_id},
                provenance="CONTRACT_TEST",
                run_id=" \t\n ",
                version=1,
                created_at=now,
                updated_at=now,
            ))


def test_cleanup_removes_only_expired_unfinalized_archives(
    contract_run,
    monkeypatch,
):
    from api_server.config import get_settings
    from api_server.db import AnalysisSessionRow, SessionLocal
    from api_server.store import (
        CONTRACT_TEST_PROVENANCE,
        create_session,
        purge_expired_archived_sessions,
    )

    now = datetime(2026, 9, 15, 16, 0, tzinfo=timezone.utc)
    old = now - timedelta(days=31)
    recent = now - timedelta(days=1)
    rows = {}
    for label in ("expired", "finalized", "recent", "sentinel"):
        created = create_session(
            f"PostgreSQL cleanup fixture: {label}",
            provenance=CONTRACT_TEST_PROVENANCE,
            run_id=contract_run.run_id,
        )
        contract_run.ids.add(created["id"])
        rows[label] = created["id"]

    with SessionLocal.begin() as db:
        db.execute(update(AnalysisSessionRow).where(
            AnalysisSessionRow.id == rows["expired"],
        ).values(archived_at=old, finalized_at=None))
        db.execute(update(AnalysisSessionRow).where(
            AnalysisSessionRow.id == rows["finalized"],
        ).values(archived_at=old, finalized_at=old))
        db.execute(update(AnalysisSessionRow).where(
            AnalysisSessionRow.id == rows["recent"],
        ).values(archived_at=recent, finalized_at=None))

    monkeypatch.setenv("ARCHIVED_SESSION_RETENTION_DAYS", "30")
    get_settings.cache_clear()
    try:
        assert purge_expired_archived_sessions(now) == 1
    finally:
        get_settings.cache_clear()

    with SessionLocal() as db:
        present = set(db.scalars(
            select(AnalysisSessionRow.id).where(
                AnalysisSessionRow.id.in_(rows.values())
            )
        ))
    assert rows["expired"] not in present
    assert present == {rows["finalized"], rows["recent"], rows["sentinel"]}
    with SessionLocal() as db:
        sentinel = db.get(AnalysisSessionRow, rows["sentinel"])
        assert sentinel.data["prompt"] == "PostgreSQL cleanup fixture: sentinel"