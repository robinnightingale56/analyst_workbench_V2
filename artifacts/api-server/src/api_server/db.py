from __future__ import annotations
import os
from threading import Lock
from datetime import datetime, timezone
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    Integer,
    JSON,
    String,
    Text,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def _database_url() -> str:
    value = os.getenv("DATABASE_URL")
    test_database = os.getenv("API_DATABASE_URL")
    if value is None and test_database is not None:
        value = test_database
    if value is None and os.getenv("NODE_ENV") == "production":
        raise RuntimeError("DATABASE_URL is required in production")
    # Development may use local SQLite explicitly; production never does.
    value = value or "sqlite:///./api-server.db"
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+psycopg://", 1)
    if value.startswith("postgres://"):
        return value.replace("postgres://", "postgresql+psycopg://", 1)
    return value


DATABASE_URL = _database_url()
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
_initialization_lock = Lock()
_initialized = False

OWNERSHIP_CONSTRAINT_NAME = (
    "analysis_sessions_ownership_nonwhitespace_run_id_required_check"
)
USER_PROVENANCE = "USER"
CONTRACT_TEST_PROVENANCE = "CONTRACT_TEST"
LEGACY_UNASSIGNED_PROVENANCE = "LEGACY_UNASSIGNED"


def _ownership_constraint_sql() -> str:
    nonblank_run_id = (
        "run_id !~ '^[[:space:]]*$'"
        if engine.dialect.name == "postgresql"
        else "length(trim(run_id, char(9) || char(10) || char(11) || "
        "char(12) || char(13) || ' ')) > 0"
    )
    return (
        f"(provenance = '{USER_PROVENANCE}' AND run_id IS NULL AND "
        f"owner_id IS NOT NULL AND {nonblank_run_id.replace('run_id', 'owner_id')}) OR "
        f"(provenance = '{CONTRACT_TEST_PROVENANCE}' AND owner_id IS NULL "
        f"AND run_id IS NOT NULL AND {nonblank_run_id}) OR "
        f"(provenance = '{LEGACY_UNASSIGNED_PROVENANCE}' AND "
        "owner_id IS NULL AND run_id IS NULL)"
    )


class Base(DeclarativeBase):
    pass


class PublicFeedRow(Base):
    """Only the two versioned, public discovery feeds belong in this table."""
    __tablename__ = "public_feed_coordination"
    __table_args__ = (
        CheckConstraint("provider_key IN ('google-world-v1', 'bbc-world-v1')",
                        name="public_feed_fixed_keys"),
        CheckConstraint("length(latest) <= 524288 AND length(good) <= 524288",
                        name="public_feed_snapshot_size"),
    )
    provider_key: Mapped[str] = mapped_column(Text, primary_key=True)
    latest: Mapped[str | None] = mapped_column(Text, nullable=True)
    good: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_at: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    lease_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    lease_until: Mapped[float] = mapped_column(Float, nullable=False, default=0)


class AnalysisSessionRow(Base):
    __tablename__ = "analysis_sessions"
    __table_args__ = (
        CheckConstraint(
            _ownership_constraint_sql(),
            name=OWNERSHIP_CONSTRAINT_NAME,
        ),
    )
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    provenance: Mapped[str] = mapped_column(String, nullable=False, default="USER")
    # NULL is reserved for pre-auth records imported by the safe migration below.
    # Application queries never return those records to an authenticated user.
    owner_id: Mapped[str | None] = mapped_column("owner_id", Text, nullable=True)
    run_id: Mapped[str | None] = mapped_column("run_id", Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    archived_at: Mapped[datetime | None] = mapped_column(
        "archived_at", DateTime(timezone=True), nullable=True
    )
    finalized_at: Mapped[datetime | None] = mapped_column(
        "finalized_at", DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), nullable=False
    )


def init_db() -> None:
    """Initialize schema and run the ownership migration once per process."""
    global _initialized
    if _initialized:
        return
    with _initialization_lock:
        if _initialized:
            return
        # Retain the legacy session initialization, but new PostgreSQL tables
        # are owned by Drizzle / publish, not startup-time DDL.
        tables = [AnalysisSessionRow.__table__]
        if engine.dialect.name == "sqlite":
            tables.append(PublicFeedRow.__table__)
        Base.metadata.create_all(engine, tables=tables)
        _migrate_ownership_column()
        _initialized = True


def _migrate_ownership_column() -> None:
    """Add ownership without deleting or assigning any pre-auth records.

    ``create_all`` intentionally does not alter existing tables.  This small,
    idempotent migration keeps a deployed development database usable while
    making all newly-created USER rows owner-bound.  PostgreSQL can also
    replace its old check constraint; SQLite uses INSERT/UPDATE triggers
    because SQLite cannot add or replace table constraints in place.
    """
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("analysis_sessions")}
    with engine.begin() as connection:
        if "owner_id" not in columns:
            connection.execute(text("ALTER TABLE analysis_sessions ADD COLUMN owner_id TEXT"))

        if engine.dialect.name == "postgresql":
            connection.execute(text(
                f"ALTER TABLE analysis_sessions DROP CONSTRAINT IF EXISTS "
                f"{OWNERSHIP_CONSTRAINT_NAME}"
            ))
            connection.execute(text(
                "UPDATE analysis_sessions SET provenance = :legacy "
                "WHERE provenance = :user AND owner_id IS NULL"
            ), {"legacy": LEGACY_UNASSIGNED_PROVENANCE, "user": USER_PROVENANCE})
            connection.execute(text(
                f"ALTER TABLE analysis_sessions ADD CONSTRAINT "
                f"{OWNERSHIP_CONSTRAINT_NAME} CHECK ({_ownership_constraint_sql()})"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS analysis_sessions_owner_archive_idx "
                "ON analysis_sessions (owner_id, archived_at) "
                f"WHERE provenance = '{USER_PROVENANCE}'"
            ))
        else:
            # Old SQLite databases retain their prior CHECK constraint, so
            # migrate their historical records only logically (owner_id NULL)
            # and enforce owner binding for all future writes with triggers.
            connection.execute(text("""
                CREATE TRIGGER IF NOT EXISTS analysis_sessions_require_owner_on_insert
                BEFORE INSERT ON analysis_sessions
                WHEN NEW.provenance = 'USER'
                  AND (NEW.owner_id IS NULL OR length(trim(NEW.owner_id)) = 0)
                BEGIN SELECT RAISE(ABORT, 'USER analysis sessions require owner_id'); END;
            """))
            connection.execute(text("""
                CREATE TRIGGER IF NOT EXISTS analysis_sessions_require_owner_on_update
                BEFORE UPDATE ON analysis_sessions
                WHEN NEW.provenance = 'USER'
                  AND (NEW.owner_id IS NULL OR length(trim(NEW.owner_id)) = 0)
                  AND OLD.owner_id IS NOT NULL
                BEGIN SELECT RAISE(ABORT, 'USER analysis sessions require owner_id'); END;
            """))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS analysis_sessions_owner_archive_idx "
                "ON analysis_sessions (owner_id, archived_at)"
            ))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)