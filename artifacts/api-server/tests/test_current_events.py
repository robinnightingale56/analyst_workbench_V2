from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from api_server import sources
from api_server.auth import require_user
from api_server.main import app
from api_server.store import list_current_events


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _rss(now: datetime) -> str:
    return f"""<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Fresh report</title><link>https://news.example/fresh</link>
    <pubDate>{_iso(now - timedelta(hours=2))}</pubDate></item>
  <item><title>Stale report</title><link>https://news.example/stale</link>
    <pubDate>{_iso(now - timedelta(hours=73))}</pubDate></item>
  <item><title>Future report</title><link>https://news.example/future</link>
    <pubDate>{_iso(now + timedelta(hours=1))}</pubDate></item>
  <item><title>Unknown date report</title><link>https://news.example/unknown</link></item>
  <item><title>Updated-only report</title><link>https://news.example/updated</link>
    <updated>{_iso(now - timedelta(hours=1))}</updated></item>
  <item><title>Synthetic demonstration</title><link>about:blank#demo</link>
    <pubDate>{_iso(now - timedelta(hours=1))}</pubDate></item>
</channel></rss>"""


def test_rss_parser_excludes_unverified_or_noncurrent_records():
    retrieved = datetime.now(timezone.utc).replace(microsecond=0)
    events = sources.parse_current_events_rss(
        _rss(retrieved),
        "Test Provider",
        _iso(retrieved),
    )

    assert [event["title"] for event in events] == ["Fresh report"]
    assert events[0]["freshness"] == "CURRENT"
    assert events[0]["retrievedAt"] == _iso(retrieved)


@pytest.mark.asyncio
async def test_provider_transport_reports_partial_errors_and_malformed_feeds():
    now = datetime.now(timezone.utc)
    good_xml = f"""<rss version="2.0"><channel><item>
      <title>Fresh report</title><link>https://news.example/fresh</link>
      <pubDate>{_iso(now - timedelta(hours=1))}</pubDate>
    </item></channel></rss>"""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "good.test":
            if request.url.path == "/malformed.xml":
                return httpx.Response(200, text="<rss>", request=request)
            return httpx.Response(200, text=good_xml, request=request)
        return httpx.Response(503, text="upstream failure", request=request)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        good_events, good_status = await sources._fetch_current_provider(
            client, "Good Provider", "https://good.test/feed.xml"
        )
        bad_events, bad_status = await sources._fetch_current_provider(
            client, "Bad Provider", "https://bad.test/feed.xml"
        )
        malformed_events, malformed_status = await sources._fetch_current_provider(
            client, "Malformed Provider", "https://good.test/malformed.xml"
        )

    assert len(good_events) == 1
    assert good_status["status"] == "OK"
    assert bad_events == []
    assert bad_status == {
        "provider": "Bad Provider",
        "status": "ERROR",
        "message": "Provider returned an unsuccessful response.",
    }
    assert malformed_events == []
    assert malformed_status == {
        "provider": "Malformed Provider",
        "status": "ERROR",
        "message": "Provider returned malformed RSS.",
    }


@pytest.mark.asyncio
async def test_discovery_returns_explicit_statuses_when_all_providers_fail(monkeypatch):
    # Synthetic provider keys must never enter the shared public-feed table.
    monkeypatch.setattr(sources, "_current_event_cache", sources.CurrentEventDiscoveryCache())
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, request=request)

    original_client = sources.httpx.AsyncClient
    monkeypatch.setattr(
        sources.httpx,
        "AsyncClient",
        lambda *args, **kwargs: original_client(
            *args,
            transport=httpx.MockTransport(handler),
            **kwargs,
        ),
    )
    monkeypatch.setattr(
        sources,
        "CURRENT_EVENT_PROVIDERS",
        (("First Provider", "https://first.test/feed"), ("Second Provider", "https://second.test/feed")),
    )

    feed = await sources.discover_current_events()

    assert feed["events"] == []
    assert [provider["status"] for provider in feed["providers"]] == ["ERROR", "ERROR"]


@pytest.mark.asyncio
async def test_successful_empty_feed_is_not_reported_as_http_error():
    empty_xml = "<rss version='2.0'><channel></channel></rss>"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=empty_xml, request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        events, status = await sources._fetch_current_provider(
            client, "Empty Provider", "https://empty.test/feed.xml"
        )

    assert events == []
    assert status["status"] == "OK"
    assert status["message"] == "Provider returned no verified current events."


@pytest.mark.asyncio
async def test_provider_body_size_is_capped_while_streaming():
    oversized_xml = b"<rss version='2.0'>" + b"x" * (sources.MAX_CURRENT_EVENT_BYTES + 1)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=oversized_xml, request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        events, status = await sources._fetch_current_provider(
            client, "Oversized Provider", "https://large.test/feed.xml"
        )

    assert events == []
    assert status == {
        "provider": "Oversized Provider",
        "status": "ERROR",
        "message": "Provider response exceeded the discovery limits.",
    }


@pytest.mark.asyncio
async def test_current_events_requires_authentication_and_blocks_classified_requests():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        anonymous = await client.get("/api/current-events")
        assert anonymous.status_code == 401

        app.dependency_overrides[require_user] = lambda: "current-event-test-user"
        try:
            with patch(
                "api_server.store.discover_current_events",
                new=AsyncMock(side_effect=AssertionError("classified discovery made an external call")),
            ):
                blocked = await client.get("/api/current-events?classification=CUI")
        finally:
            app.dependency_overrides.pop(require_user, None)

    assert blocked.status_code == 200
    body = blocked.json()
    assert body["blocked"] is True
    assert body["events"] == []
    assert {provider["status"] for provider in body["providers"]} == {"BLOCKED"}


@pytest.mark.asyncio
async def test_discovery_store_function_does_not_touch_sessions():
    feed = {
        "events": [],
        "providers": [],
        "checkedAt": _iso(datetime.now(timezone.utc)),
        "freshnessWindowHours": 72,
        "blocked": False,
    }
    with (
        patch("api_server.store._seed", side_effect=AssertionError("session seed accessed")),
        patch("api_server.store.list_sessions", side_effect=AssertionError("sessions accessed")),
        patch("api_server.store.discover_current_events", new=AsyncMock(return_value=feed)),
    ):
        result = await list_current_events("UNCLASSIFIED")

    assert result is feed