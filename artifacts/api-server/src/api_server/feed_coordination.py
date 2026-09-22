"""SQL coordination for fixed public feeds, never research/session content.

Transactions end before network I/O. Database time controls all shared deadlines;
ownership tokens fence off results from workers whose leases have expired.
Database errors propagate (never fall back to uncoordinated provider requests).
"""
from __future__ import annotations

import json
from uuid import uuid4

from sqlalchemy import select, update, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .db import PublicFeedRow, engine

PUBLIC_FEED_KEYS = ("google-world-v1", "bbc-world-v1")
MAX_SNAPSHOT_BYTES = 524288
REFRESH_LEASE_SECONDS = 15


class PublicFeedCoordinator:
    def __init__(self, database=engine, lease_seconds=REFRESH_LEASE_SECONDS):
        self.database = database
        self.lease_seconds = lease_seconds

    def _now(self, connection):
        # clock_timestamp, unlike CURRENT_TIMESTAMP, is not transaction-start time.
        sql = ("SELECT EXTRACT(EPOCH FROM clock_timestamp())"
               if self.database.dialect.name == "postgresql"
               else "SELECT (julianday('now') - 2440587.5) * 86400.0")
        return float(connection.execute(text(sql)).scalar_one())

    @staticmethod
    def _key(key):
        if key not in PUBLIC_FEED_KEYS:
            raise ValueError("Only fixed public feed keys may be coordinated")

    def claim_or_read(self, key):
        """Return (token, latest, good, database_now); a null token means wait/hit."""
        self._key(key)
        table = PublicFeedRow.__table__
        insert = pg_insert if self.database.dialect.name == "postgresql" else sqlite_insert
        with self.database.begin() as connection:
            connection.execute(insert(table).values(
                provider_key=key, retry_at=0, lease_until=0,
            ).on_conflict_do_nothing(index_elements=["provider_key"]))
            now = self._now(connection)
            token = str(uuid4())
            acquired = connection.execute(
                update(table).where(
                    table.c.provider_key == key,
                    table.c.retry_at <= now,
                    table.c.lease_until <= now,
                ).values(lease_token=token, lease_until=now + self.lease_seconds)
            ).rowcount == 1
            row = connection.execute(select(table).where(
                table.c.provider_key == key)).mappings().one()
            latest = json.loads(row["latest"]) if row["latest"] else None
            good = json.loads(row["good"]) if row["good"] else None
            # Expired attempts cannot be mistaken for a cache hit while a peer
            # refreshes. Last-success data is carried separately for fallback.
            if row["retry_at"] <= now:
                latest = None
            return token if acquired else None, latest, good, now

    def publish(self, key, token, snapshot, ttl):
        self._key(key)
        if len(snapshot["events"]) > 12:
            raise ValueError("Too many public feed events")
        table = PublicFeedRow.__table__
        with self.database.begin() as connection:
            now = self._now(connection)
            snapshot = {**snapshot, "stored_at": now}
            payload = json.dumps(snapshot, ensure_ascii=True, separators=(",", ":"))
            if len(payload.encode("utf-8")) > MAX_SNAPSHOT_BYTES:
                raise ValueError("Public feed snapshot exceeds size limit")
            values = dict(latest=payload, retry_at=now + ttl,
                          lease_token=None, lease_until=0)
            if snapshot["status"]["status"] == "OK":
                values["good"] = payload
            return connection.execute(update(table).where(
                table.c.provider_key == key,
                table.c.lease_token == token,
                table.c.lease_until > now,
            ).values(**values)).rowcount == 1