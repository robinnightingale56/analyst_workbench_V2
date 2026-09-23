import asyncio
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from api_server import feed_signals as signals, sources
from api_server.feed_coordination import PUBLIC_FEED_KEYS, PublicFeedCoordinator
from test_feed_coordination import sqlite_feeds


@pytest.fixture(autouse=True)
def reset_signals():
    with signals._lock:
        signals._counts.clear()
        for history in signals._expirations.values():
            history.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["claim", "publish"])
async def test_database_failure_is_safe_and_fail_closed(
    sqlite_feeds, monkeypatch, caplog, operation,
):
    _, engines = sqlite_feeds
    coordinator = PublicFeedCoordinator(engines[0])
    key = sources.CURRENT_EVENT_PROVIDERS[0]
    calls = []
    private = "secret-password https://private.example prompt session-id"

    def broken_begin():
        raise OperationalError(private, {"private": private}, Exception(private))

    async def fetch(*args):
        calls.append(True)
        monkeypatch.setattr(engines[0], "begin", broken_begin)
        return [], {"status": "OK", "message": private}

    monkeypatch.setattr(sources, "_fetch_current_provider", fetch)
    if operation == "claim":
        monkeypatch.setattr(engines[0], "begin", broken_begin)
    cache = sources.CurrentEventDiscoveryCache(coordinator)
    with pytest.raises(OperationalError):
        await cache._shared_provider(key)
    assert len(calls) == (1 if operation == "publish" else 0)
    counts = signals.counters()
    assert counts[(PUBLIC_FEED_KEYS[0], f"{operation}_database_error")] == 1
    assert counts[(PUBLIC_FEED_KEYS[0], "refresh_failed")] == 1
    assert "duration_seconds=" in caplog.text
    assert private not in caplog.text
    assert "private.example" not in caplog.text
    assert all(not record.exc_info for record in caplog.records)


def test_repeated_expirations_and_fenced_publish(sqlite_feeds, caplog):
    _, engines = sqlite_feeds
    coordinator = PublicFeedCoordinator(engines[0])
    key = PUBLIC_FEED_KEYS[0]
    old, *_ = coordinator.claim_or_read(key)
    for _ in range(3):
        with engines[0].begin() as connection:
            connection.execute(text("UPDATE public_feed_coordination SET lease_until=0"))
        token, *_ = coordinator.claim_or_read(key)
        assert token
        # A peer merely waiting must not inflate expiration counts.
        assert coordinator.claim_or_read(key)[0] is None
    snapshot = {"events": [], "status": {"status": "OK"}}
    assert not coordinator.publish(key, old, snapshot, 60)
    assert coordinator.publish(key, token, snapshot, 60)
    counts = signals.counters()
    assert counts[(key, "lease_expired")] == 3
    assert counts[(key, "lease_expired_repeated")] == 1
    assert counts[(key, "publish_rejected")] == 1
    assert counts[(key, "publish_success")] == 1
    assert old not in caplog.text and token not in caplog.text


def test_expiration_window_and_label_validation(monkeypatch):
    times = iter([0, 301, 302])
    monkeypatch.setattr(signals, "monotonic", lambda: next(times))
    for _ in range(3):
        signals.signal(PUBLIC_FEED_KEYS[0], "lease_expired")
    assert (PUBLIC_FEED_KEYS[0], "lease_expired_repeated") not in signals.counters()
    with pytest.raises(ValueError):
        signals.signal("private-url", "cache_success")
    with pytest.raises(ValueError):
        signals.signal(PUBLIC_FEED_KEYS[0], "private-prompt")


@pytest.mark.asyncio
async def test_success_error_cache_and_stale_fallback(sqlite_feeds, monkeypatch, caplog):
    _, engines = sqlite_feeds
    coordinator = PublicFeedCoordinator(engines[0])
    key = sources.CURRENT_EVENT_PROVIDERS[0]
    feed = PUBLIC_FEED_KEYS[0]
    private = "private-feed-content"
    snapshot = {
        "events": [], "status": {"status": "OK", "message": private},
        "checked_at": "2026-09-22T00:00:00Z",
    }
    token, *_ = coordinator.claim_or_read(feed)
    coordinator.publish(feed, token, snapshot, 60)

    async def forbidden(*args):
        raise AssertionError("cache hit called provider")

    monkeypatch.setattr(sources, "_fetch_current_provider", forbidden)
    cache = sources.CurrentEventDiscoveryCache(coordinator)
    assert not await cache._shared_provider(key)
    with engines[0].begin() as connection:
        connection.execute(text("UPDATE public_feed_coordination SET retry_at=0"))
    token, *_ = coordinator.claim_or_read(feed)
    snapshot["status"]["status"] = "ERROR"
    coordinator.publish(feed, token, snapshot, 60)
    assert not await cache._shared_provider(key)
    counts = signals.counters()
    for event in ("cache_success", "cache_error", "stale_fallback", "publish_error"):
        assert counts[(feed, event)] == 1
    assert counts[(feed, "refresh_complete")] == 2
    assert private not in caplog.text


@pytest.mark.asyncio
async def test_wait_timeout_duration_without_provider(monkeypatch, caplog):
    coordinator = SimpleNamespace(
        lease_seconds=1, claim_or_read=lambda _: (None, None, None, 0),
    )
    clock = [0]
    monkeypatch.setattr(sources, "monotonic", lambda: clock[0])

    async def sleep(_):
        clock[0] += 1

    async def forbidden(*args):
        raise AssertionError("waiter called provider")

    monkeypatch.setattr(sources.asyncio, "sleep", sleep)
    monkeypatch.setattr(sources, "_fetch_current_provider", forbidden)
    with pytest.raises(TimeoutError):
        await sources.CurrentEventDiscoveryCache(coordinator)._shared_provider(
            sources.CURRENT_EVENT_PROVIDERS[0],
        )
    counts = signals.counters()
    assert counts[(PUBLIC_FEED_KEYS[0], "refresh_timeout")] == 1
    assert counts[(PUBLIC_FEED_KEYS[0], "refresh_slow")] == 1
    assert "duration_seconds=4.000" in caplog.text


@pytest.mark.asyncio
async def test_cancelled_wait_is_measured(monkeypatch):
    coordinator = SimpleNamespace(lease_seconds=15)
    cache = sources.CurrentEventDiscoveryCache(coordinator)

    async def cancelled(_):
        raise asyncio.CancelledError()

    monkeypatch.setattr(cache, "_shared_provider_attempt", cancelled)
    with pytest.raises(asyncio.CancelledError):
        await cache._shared_provider(sources.CURRENT_EVENT_PROVIDERS[0])
    assert signals.counters()[(PUBLIC_FEED_KEYS[0], "refresh_cancelled")] == 1