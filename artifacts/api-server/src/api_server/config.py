from functools import lru_cache
import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")
    port: int = 8080
    database_url: str | None = None
    archived_session_retention_days: float = 30
    archived_session_cleanup_interval_minutes: float = 360

    def archive_policy(self) -> dict[str, float]:
        retention = self.archived_session_retention_days
        interval = self.archived_session_cleanup_interval_minutes
        if retention <= 0:
            raise ValueError(
                f'Invalid ARCHIVED_SESSION_RETENTION_DAYS value: "{retention}". '
                "Expected a positive number."
            )
        if interval <= 0:
            raise ValueError(
                f'Invalid ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES value: "{interval}". '
                "Expected a positive number."
            )
        if interval * 60_000 > 2_147_483_647:
            raise ValueError(
                f'Invalid ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES value: "{interval}". '
                "Expected at most 35791.39411666667 minutes."
            )
        return {"retentionDays": retention, "cleanupIntervalMinutes": interval}


@lru_cache
def get_settings() -> Settings:
    # pydantic-settings reads ARCHIVED_SESSION_* aliases only when explicitly
    # configured; this preserves the names used by the existing deployment.
    values: dict[str, object] = {}
    for field, env_name in (
        ("database_url", "DATABASE_URL"),
        ("port", "PORT"),
        ("archived_session_retention_days", "ARCHIVED_SESSION_RETENTION_DAYS"),
        ("archived_session_cleanup_interval_minutes", "ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES"),
    ):
        if env_name in os.environ:
            values[field] = os.environ[env_name]
    return Settings(**values)