from __future__ import annotations

import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import Request

from api_server import sources, store
from api_server.auth import require_user
from api_server.main import app


@pytest.fixture
def feed_cache(monkeypatch):
    """A deterministic clock and fixed, bounded public provider set."""
    class Clock:
        elapsed = 0.0
        start = datetime(2026, 9, 18, 12, tzinfo=timezone.utc)

        def now(self):
            return self.start + timedelta(seconds=self.elapsed)

        def advance(self, seconds):
            self.elapsed += seconds

    clock = Clock()

    class FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock.now()

    cache = sources.CurrentEventDiscoveryCache()
    monkeypatch.setattr(sources, "_current_event_cache", cache)
    monkeypatch.setattr(sources, "datetime", FakeDatetime)
    monkeypatch.setattr(sources, "monotonic", lambda: clock.elapsed)
    monkeypatch.setattr(sources, "CURRENT_EVENT_PROVIDERS", (
        ("First", "https://first.example/rss"),
        ("Second", "https://second.example/rss"),
    ))
    calls = Counter()
    failures = set()
    empty = set()

    async def fetch(client, provider, url):
        calls[provider] += 1
        # Force competing requests to overlap rather than testing serial hits.
        await asyncio.sleep(0)
        if provider in failures:
            return [], {"provider": provider, "status": "ERROR", "message": "Provider request timed out."}
        events = [] if provider in empty else [{
            "id": provider,
            "title": f"{provider} report",
            "question": "What changed?",
            "url": f"https://news.example/{provider}",
            "provider": provider,
            "publishedAt": sources._utc_iso(clock.now() - timedelta(hours=1)),
            "retrievedAt": sources._utc_iso(clock.now()),
            "freshness": "CURRENT",
        }]
        return events, {"provider": provider, "status": "OK", "message": "Provider check succeeded."}

    monkeypatch.setattr(sources, "_fetch_current_provider", fetch)
    return clock, cache, calls, failures, empty


@pytest.mark.asyncio
async def test_concurrent_refreshes_and_hits_share_requests_and_preserve_timestamps(feed_cache):
    clock, cache, calls, _, _ = feed_cache
    feeds = await asyncio.gather(*(store.list_current_events() for _ in range(30)))
    assert calls == {"First": 1, "Second": 1}
    assert all(feed == feeds[0] for feed in feeds)
    first = feeds[0]
    clock.advance(10)
    cached = await store.list_current_events()
    assert cached["checkedAt"] == first["checkedAt"]
    assert cached["events"] == first["events"]
    assert all(status["cached"] and not status["stale"] for status in cached["providers"])
    assert [p["checkedAt"] for p in cached["providers"]] == [p["checkedAt"] for p in first["providers"]]
    assert calls == {"First": 1, "Second": 1}
    # Mutating one user's response cannot contaminate another user's result.
    cached["events"][0]["title"] = "changed by consumer"
    cached["providers"][0]["message"] = "changed by consumer"
    assert (await cache.get())["events"] == first["events"]
    assert "changed by consumer" not in (await cache.get())["providers"][0]["message"]
    assert len(cache._latest) == len(cache._good) == 2


@pytest.mark.asyncio
async def test_expiry_boundary_coalesces_a_new_refresh(feed_cache):
    clock, _, calls, _, _ = feed_cache
    first = await store.list_current_events()
    clock.advance(sources.CURRENT_EVENT_CACHE_SECONDS - 0.01)
    await store.list_current_events()
    assert calls == {"First": 1, "Second": 1}
    clock.advance(0.01)
    refreshed = await asyncio.gather(*(store.list_current_events() for _ in range(20)))
    assert calls == {"First": 2, "Second": 2}
    assert refreshed[0]["checkedAt"] != first["checkedAt"]
    assert refreshed[0]["events"][0]["retrievedAt"] != first["events"][0]["retrievedAt"]


@pytest.mark.asyncio
async def test_freshness_window_is_reapplied_without_changing_cached_snapshot(feed_cache):
    clock, cache, calls, _, _ = feed_cache
    await cache.get()
    for snapshot in cache._latest.values():
        snapshot.events[0]["publishedAt"] = sources._utc_iso(
            clock.now() - timedelta(hours=sources.CURRENT_EVENT_FRESHNESS_HOURS)
        )
    assert len((await cache.get())["events"]) == 2  # Inclusive cutoff.
    clock.advance(1)
    feed = await cache.get()
    assert feed["events"] == []
    assert all("outside the freshness window" in p["message"] for p in feed["providers"])
    assert all(len(snapshot.events) == 1 for snapshot in cache._latest.values())
    assert calls == {"First": 1, "Second": 1}


@pytest.mark.asyncio
async def test_failures_are_cached_and_partial_retry_leaves_healthy_provider_alone(feed_cache):
    clock, _, calls, failures, _ = feed_cache
    failures.add("Second")
    first = await store.list_current_events()
    assert [p["status"] for p in first["providers"]] == ["OK", "ERROR"]
    assert [event["provider"] for event in first["events"]] == ["First"]
    await asyncio.gather(*(store.list_current_events() for _ in range(20)))
    assert calls == {"First": 1, "Second": 1}
    clock.advance(sources.CURRENT_EVENT_ERROR_CACHE_SECONDS)
    failures.clear()
    recovered = await store.list_current_events()
    assert calls == {"First": 1, "Second": 2}
    assert [p["status"] for p in recovered["providers"]] == ["OK", "OK"]
    assert recovered["providers"][0]["cached"] is True
    assert recovered["providers"][1]["cached"] is False


@pytest.mark.asyncio
async def test_all_provider_errors_have_a_cooldown_and_no_fabricated_results(feed_cache):
    clock, _, calls, failures, _ = feed_cache
    failures.update(("First", "Second"))
    first = await store.list_current_events()
    clock.advance(1)
    feeds = await asyncio.gather(*(store.list_current_events() for _ in range(20)))
    assert calls == {"First": 1, "Second": 1}
    assert feeds[0]["events"] == []
    assert feeds[0]["checkedAt"] == first["checkedAt"]
    assert all(p["status"] == "ERROR" and p["cached"] and not p["stale"] for p in feeds[0]["providers"])


@pytest.mark.asyncio
async def test_stale_fallback_is_explicit_preserves_dates_and_expires(feed_cache):
    clock, _, calls, failures, _ = feed_cache
    first = await store.list_current_events()
    failures.update(("First", "Second"))
    clock.advance(sources.CURRENT_EVENT_CACHE_SECONDS)
    fallback = await store.list_current_events()
    assert fallback["events"] == first["events"]
    assert fallback["checkedAt"] != first["checkedAt"]  # Actual failed recheck.
    for status in fallback["providers"]:
        assert status["status"] == "ERROR"
        assert status["cached"] and status["stale"]
        assert status["checkedAt"] == first["checkedAt"]
        assert status["lastAttemptAt"] == fallback["checkedAt"]
        assert "Stale cached provider data" in status["message"]
    clock.advance(1)
    assert (await store.list_current_events()) == fallback
    assert calls == {"First": 2, "Second": 2}
    # Retrying errors must not extend the age of last successful data.
    clock.advance(sources.CURRENT_EVENT_STALE_SECONDS - clock.elapsed - 1)
    assert len((await store.list_current_events())["events"]) == 2
    calls_before_expiry = calls.copy()
    clock.advance(1)
    expired = await store.list_current_events()
    assert expired["events"] == []
    assert all(p["status"] == "ERROR" and not p["stale"] for p in expired["providers"])
    assert calls == calls_before_expiry  # Age check also applies during cooldown.
    failures.clear()
    clock.advance(sources.CURRENT_EVENT_ERROR_CACHE_SECONDS)
    recovered = await store.list_current_events()
    assert len(recovered["events"]) == 2
    assert all(p["status"] == "OK" and not p["stale"] for p in recovered["providers"])


@pytest.mark.asyncio
async def test_stale_fallback_also_filters_publication_age(feed_cache):
    clock, cache, _, failures, _ = feed_cache
    await cache.get()
    for snapshot in cache._latest.values():
        snapshot.events[0]["publishedAt"] = sources._utc_iso(
            clock.now() - timedelta(hours=sources.CURRENT_EVENT_FRESHNESS_HOURS)
        )
    failures.update(("First", "Second"))
    clock.advance(sources.CURRENT_EVENT_CACHE_SECONDS)
    feed = await cache.get()
    assert feed["events"] == []
    assert all(p["stale"] and p["status"] == "ERROR" for p in feed["providers"])


@pytest.mark.asyncio
async def test_successful_empty_feed_replaces_old_results_and_is_cached(feed_cache):
    clock, _, calls, failures, empty = feed_cache
    await store.list_current_events()
    empty.update(("First", "Second"))
    clock.advance(sources.CURRENT_EVENT_CACHE_SECONDS)
    empty_feed = await store.list_current_events()
    assert empty_feed["events"] == []
    assert all(p["status"] == "OK" for p in empty_feed["providers"])
    await store.list_current_events()
    assert calls == {"First": 2, "Second": 2}
    failures.update(empty)
    clock.advance(sources.CURRENT_EVENT_CACHE_SECONDS)
    assert (await store.list_current_events())["events"] == []


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_cancel_shared_collection(feed_cache, monkeypatch):
    _, cache, calls, _, _ = feed_cache
    started, release = asyncio.Event(), asyncio.Event()
    original = sources._fetch_current_provider

    async def slow_fetch(*args):
        started.set()
        await release.wait()
        return await original(*args)

    monkeypatch.setattr(sources, "_fetch_current_provider", slow_fetch)
    cancelled = asyncio.create_task(store.list_current_events())
    await started.wait()
    blocked = await store.list_current_events("SECRET")
    assert blocked["blocked"] and blocked["events"] == []
    assert not calls  # Blocked request neither waits for nor starts collection.
    survivor = asyncio.create_task(store.list_current_events())
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled
    assert cache._inflight is not None and not cache._inflight.cancelled()
    release.set()
    assert len((await survivor)["events"]) == 2
    assert calls == {"First": 1, "Second": 1}
    assert cache._inflight is None


@pytest.mark.asyncio
async def test_restricted_requests_never_access_cold_or_warm_cache(feed_cache, monkeypatch):
    _, cache, calls, _, _ = feed_cache
    for classification in ("CUI", "SECRET", "TS", "unknown", "unclassified", None):
        assert (await store.list_current_events(classification))["blocked"]
    assert not calls
    await store.list_current_events()
    async def forbidden_get():
        raise AssertionError("Restricted request accessed public cache")
    monkeypatch.setattr(cache, "get", forbidden_get)
    for classification in ("CUI", "SECRET", "TS"):
        blocked = await store.list_current_events(classification)
        assert blocked["events"] == []
        assert {p["status"] for p in blocked["providers"]} == {"BLOCKED"}
    assert calls == {"First": 1, "Second": 1}


@pytest.mark.asyncio
async def test_authenticated_users_share_cache_and_metadata_survives_serialization(feed_cache):
    _, _, calls, _, _ = feed_cache

    def test_user(request: Request):
        return request.headers["X-Test-Owner"]

    app.dependency_overrides[require_user] = test_user
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver",
        ) as client:
            responses = await asyncio.gather(*(
                client.get("/api/current-events", headers={"X-Test-Owner": f"owner-{i}"})
                for i in range(20)
            ))
            cached = await client.get("/api/current-events", headers={"X-Test-Owner": "another-owner"})
            blocked = await client.get(
                "/api/current-events?classification=SECRET", headers={"X-Test-Owner": "another-owner"},
            )
    finally:
        app.dependency_overrides.pop(require_user, None)
    assert all(response.status_code == 200 for response in responses)
    assert calls == {"First": 1, "Second": 1}
    assert all(p["cached"] and not p["stale"] and p["checkedAt"] and p["lastAttemptAt"]
               for p in cached.json()["providers"])
    assert blocked.json()["blocked"] and blocked.json()["events"] == []