from collections import Counter
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import asyncio
import json

import httpx
import pytest
from sqlalchemy import text

from api_server import sources
from api_server.feed_coordination import PublicFeedCoordinator
from test_feed_coordination import sqlite_feeds


NOW = datetime(2026, 9, 22, 12, tzinfo=timezone.utc)


@pytest.fixture
def clock(monkeypatch):
    elapsed = [0.0]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW + timedelta(seconds=elapsed[0])

    monkeypatch.setattr(sources, "datetime", Clock)
    monkeypatch.setattr(sources, "monotonic", lambda: elapsed[0])
    return elapsed


@pytest.mark.parametrize("code", [429, 503])
@pytest.mark.parametrize("header,delay,explanation", [
    ("120", 120, "honored"),
    (format_datetime(NOW + timedelta(seconds=180), usegmt=True), 180, "honored"),
    (None, 30, "missing"),
    ("", 30, "invalid"),
    ("garbage private upstream text", 30, "invalid"),
    ("-1", 30, "invalid"),
    ("1.5", 30, "invalid"),
    ("NaN", 30, "invalid"),
    ("inf", 30, "invalid"),
    ("120, 240", 30, "invalid"),
    (format_datetime(NOW - timedelta(seconds=1), usegmt=True), 30, "expired"),
    ("0", 30, "minimum"),
    ("1", 30, "minimum"),
    ("3600", 3600, "honored"),
    ("9999999999", 3600, "capped"),
    ("9" * 5000, 3600, "capped"),
    ("x" * 5000, 30, "invalid"),
    (format_datetime(NOW + timedelta(days=365), usegmt=True), 3600, "capped"),
])
async def test_retry_after_response(clock, code, header, delay, explanation):
    def handler(request):
        return httpx.Response(code, headers={} if header is None else {"Retry-After": header})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        events, status = await sources._fetch_current_provider(client, "BBC News", "https://example.test/rss")
    assert not events
    assert status["status"] == "ERROR"
    assert status["_retry_after_seconds"] == delay
    assert f"HTTP {code}" in status["message"]
    assert explanation in status["message"]
    assert "private upstream text" not in status["message"]


@pytest.mark.asyncio
@pytest.mark.parametrize("shared", [False, True])
async def test_provider_deadlines_concurrency_and_recovery(clock, sqlite_feeds, monkeypatch, shared):
    _, engines = sqlite_feeds
    calls = Counter()
    recovered = set()
    providers = sources.CURRENT_EVENT_PROVIDERS
    waits = {providers[0][1]: "120", providers[1][1]: "240"}

    async def handler(request):
        url = str(request.url)
        calls[url] += 1
        await asyncio.sleep(0)
        if url in recovered:
            return httpx.Response(200, text="<rss><channel></channel></rss>")
        return httpx.Response(429 if url == providers[0][1] else 503,
                              headers={"Retry-After": waits[url]})

    original = httpx.AsyncClient
    monkeypatch.setattr(sources.httpx, "AsyncClient", lambda **kw: original(
        **kw, transport=httpx.MockTransport(handler),
    ))

    def cache(index=0):
        coordinator = PublicFeedCoordinator(engines[index]) if shared else None
        if coordinator:
            monkeypatch.setattr(coordinator, "_now", lambda conn: NOW.timestamp() + clock[0])
        return sources.CurrentEventDiscoveryCache(coordinator)

    caches = [cache(), cache(1)] if shared else [cache()]

    async def wave():
        return await asyncio.gather(*(caches[i % len(caches)].get() for i in range(20)))

    first = await wave()
    assert list(calls.values()) == [1, 1]
    assert all(p["status"] == "ERROR" for p in first[0]["providers"])
    assert "_retry_after_seconds" not in json.dumps(first)
    if shared:
        with engines[0].connect() as connection:
            rows = connection.execute(text("SELECT latest, retry_at FROM public_feed_coordination")).all()
        assert sorted(row.retry_at - json.loads(row.latest)["stored_at"] for row in rows) == [120, 240]
        # New workers must honor the persisted cooldown, not just local memory.
        caches = [cache(), cache(1)]
    clock[0] = 119.99
    await wave()
    assert list(calls.values()) == [1, 1]
    recovered.update(waits)
    clock[0] = 120
    partial = await wave()
    assert calls[providers[0][1]] == 2
    assert calls[providers[1][1]] == 1
    assert [p["status"] for p in partial[0]["providers"]] == ["OK", "ERROR"]
    clock[0] = 239.99
    await wave()
    assert calls[providers[1][1]] == 1
    clock[0] = 240
    success = await wave()
    assert calls[providers[1][1]] == 2
    assert all(p["status"] == "OK" for p in success[0]["providers"])
    assert all("Retry" not in p["message"] for p in success[0]["providers"])