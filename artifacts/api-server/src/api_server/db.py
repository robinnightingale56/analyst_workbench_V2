from __future__ import annotations
import os
from datetime import datetime, timezone
from sqlalchemy import CheckConstraint, DateTime, Integer, JSON, String, Text, create_engine
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

OWNERSHIP_CONSTRAINT_NAME = (
    "analysis_sessions_ownership_nonwhitespace_run_id_required_check"
)


def _ownership_constraint_sql() -> str:
    nonblank_run_id = (
        "run_id !~ '^[[:space:]]*$'"
        if engine.dialect.name == "postgresql"
        else "length(trim(run_id, char(9) || char(10) || char(11) || "
        "char(12) || char(13) || ' ')) > 0"
    )
    return (
        "(provenance = 'USER' AND run_id IS NULL) OR "
        "(provenance = 'CONTRACT_TEST' AND run_id IS NOT NULL AND "
        f"{nonblank_run_id})"
    )


class Base(DeclarativeBase):
    pass


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
    Base.metadata.create_all(engine)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)