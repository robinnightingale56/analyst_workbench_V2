from __future__ import annotations
import asyncio
import html
import ipaddress
import re
import socket
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from time import monotonic
from urllib.parse import urlencode, urljoin, urlparse
from uuid import NAMESPACE_URL, uuid4, uuid5
import httpx
from .deployment import require_collection_allowed
import trafilatura
from bs4 import BeautifulSoup
from .models import SourceFile
from .feed_coordination import PublicFeedCoordinator, PUBLIC_FEED_KEYS
from .feed_signals import signal

MAX_DOCUMENT_BYTES = 2_000_000
MAX_DOCUMENT_CHARS = 500_000
DOCUMENT_TIMEOUT_SECONDS = 10
MAX_DOCUMENT_REDIRECTS = 3
CURRENT_EVENT_FRESHNESS_HOURS = 72
CURRENT_EVENT_TIMEOUT_SECONDS = 8
MAX_CURRENT_EVENT_BYTES = 1_000_000
MAX_CURRENT_EVENTS_PER_PROVIDER = 12
MAX_CURRENT_EVENTS = 20
CURRENT_EVENT_CACHE_SECONDS = 60
CURRENT_EVENT_ERROR_CACHE_SECONDS = 30
CURRENT_EVENT_MAX_RETRY_AFTER_SECONDS = 3600
CURRENT_EVENT_STALE_SECONDS = 300
READABLE_CONTENT_TYPES = {
    "text/html",
    "application/xhtml+xml",
    "text/plain",
}

# Current-event discovery is intentionally not a search endpoint.  These
# provider URLs contain a fixed, general-interest query and never include a
# user's question, classification, or session data.
CURRENT_EVENT_QUERY = "world news"
CURRENT_EVENT_PROVIDERS = (
    (
        "Google News",
        "https://news.google.com/rss/search?"
        + urlencode({"q": CURRENT_EVENT_QUERY, "hl": "en-US", "gl": "US", "ceid": "US:en"}),
    ),
    (
        "BBC News",
        "https://feeds.bbci.co.uk/news/world/rss.xml",
    ),
)
_PUBLIC_FEED_IDS = dict(zip(CURRENT_EVENT_PROVIDERS, PUBLIC_FEED_KEYS))

SOURCE_CONNECTORS = [
    {"id": "google-news-rss", "name": "Google News", "description": "Live news and article discovery through the public Google News RSS feed.", "status": "READY", "mode": "LIVE", "sourceTypes": ["NEWS", "WEB"]},
    {"id": "bing-news-rss", "name": "Bing News", "description": "Live news discovery with substantive report snippets from Bing's public RSS feed.", "status": "READY", "mode": "LIVE", "sourceTypes": ["NEWS", "WEB"]},
    {"id": "federal-register", "name": "Federal Register", "description": "Live U.S. rules, notices, presidential documents, and official publications.", "status": "READY", "mode": "LIVE", "sourceTypes": ["GOVERNMENT"]},
    {"id": "crossref", "name": "Crossref Research", "description": "Live scholarly publication metadata from the public Crossref API.", "status": "READY", "mode": "LIVE", "sourceTypes": ["ACADEMIC"]},
    {"id": "demonstration-library", "name": "Demonstration Library", "description": "Synthetic records for training and interface demonstrations only.", "status": "READY", "mode": "DEMONSTRATION", "sourceTypes": ["GOVERNMENT", "NEWS", "ACADEMIC", "WEB"]},
]


def is_known_connector(value: str) -> bool:
    return any(x["id"] == value for x in SOURCE_CONNECTORS)


def _clean(value: str | None, fallback: str, limit: int = 700) -> str:
    text = BeautifulSoup(value or "", "lxml").get_text(" ", strip=True)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()[:limit] or fallback


def _tags(prompt: str) -> list[str]:
    return [x for x in re.split(r"[^a-z0-9]+", prompt.lower()) if len(x) > 4][:4]


def _published(raw: str | None, fallback: str) -> tuple[str, str | None]:
    if not raw:
        return fallback, None
    try:
        from email.utils import parsedate_to_datetime
        date = parsedate_to_datetime(raw)
        return date.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"), None
    except (TypeError, ValueError, OverflowError):
        pass
    try:
        date = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        return date.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"), None
    except (TypeError, ValueError, OverflowError):
        return fallback, None


def _provider_published(raw: str | None, fallback: str) -> tuple[str, str | None, str]:
    published_at, provider_published_at = _published(raw, fallback)
    # `_published` returns the parsed provider time as the first value; retain
    # it separately so downstream lead generation never mistakes a retrieval
    # fallback for authentic publisher dating.
    if raw and published_at != fallback:
        return published_at, published_at, "PROVIDER"
    return published_at, provider_published_at, "RETRIEVAL_FALLBACK"


def _crossref_published(work: dict, fallback: str) -> tuple[str, str | None, str]:
    for key in ("published-online", "published-print", "published", "issued", "created"):
        raw = work.get(key)
        parts = raw.get("date-parts", [[]])[0] if isinstance(raw, dict) else []
        if not parts or not isinstance(parts[0], int):
            continue
        try:
            year, month, day = parts[0], parts[1] if len(parts) > 1 else 1, parts[2] if len(parts) > 2 else 1
            parsed = datetime(year, month, day, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
            return parsed, parsed, "PROVIDER"
        except ValueError:
            continue
    return fallback, None, "RETRIEVAL_FALLBACK"


def _rss_items(xml: str) -> list[BeautifulSoup]:
    soup = BeautifulSoup(xml, "xml")
    return soup.find_all("item")


class CurrentEventFeedParseError(ValueError):
    """The provider response was not a valid RSS document."""


def _utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _strict_provider_datetime(raw: str | None) -> datetime | None:
    """Parse a provider timestamp without inventing a retrieval fallback."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    value = raw.strip()
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        parsed = None
    if parsed is None:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (TypeError, ValueError, OverflowError):
            return None
    if parsed.tzinfo is None:
        # A timezone-less provider date cannot be verified against a UTC
        # freshness window and is therefore treated as unknown.
        return None
    return parsed.astimezone(timezone.utc)


def _valid_event_url(raw: object) -> str | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    value = raw.strip()
    try:
        parsed = urlparse(value)
        hostname = parsed.hostname
        # Accessing port also validates malformed values such as ":notaport".
        _ = parsed.port
    except ValueError:
        return None
    try:
        address = ipaddress.ip_address(hostname) if hostname else None
    except ValueError:
        address = None
    if (
        parsed.scheme not in {"http", "https"}
        or not hostname
        or hostname.lower() in {"localhost", "localhost.localdomain"}
        or (address is not None and not address.is_global)
        or parsed.username is not None
        or parsed.password is not None
        or any(character.isspace() for character in value)
    ):
        return None
    return value


def parse_current_events_rss(
    xml: str,
    provider: str,
    retrieved_at: str | None = None,
    *,
    freshness_window_hours: int = CURRENT_EVENT_FRESHNESS_HOURS,
) -> list[dict]:
    """Return only RSS records with a verified, recent provider date.

    This parser deliberately does not use the existing ``_published`` helper:
    that helper supplies a retrieval fallback for research source files, while
    a current-event result must never present retrieval time as publication
    time.
    """
    if not isinstance(xml, str) or not xml.strip():
        raise CurrentEventFeedParseError("Provider returned an empty RSS response")
    try:
        # BeautifulSoup is useful for the existing adapters because it recovers
        # from malformed feeds.  Recovery is unsafe here: it could turn an
        # invalid response into apparently verified headlines, so validate the
        # XML first with the standard library parser.
        import xml.etree.ElementTree as ElementTree
        ElementTree.fromstring(xml)
    except (ElementTree.ParseError, TypeError):
        raise CurrentEventFeedParseError("Provider returned malformed RSS") from None

    retrieved = _strict_provider_datetime(retrieved_at) if retrieved_at else datetime.now(timezone.utc)
    if retrieved is None:
        raise ValueError("retrieval time is invalid")
    cutoff = retrieved - timedelta(hours=freshness_window_hours)
    items = _rss_items(xml)[:MAX_CURRENT_EVENTS_PER_PROVIDER]
    events: list[dict] = []
    seen_urls: set[str] = set()
    for item in items:
        title_tag = item.find("title")
        title = _clean(title_tag.get_text() if title_tag else None, "", 300)
        if not title:
            continue

        url_tag = item.find("link")
        url = _valid_event_url(url_tag.get_text(strip=True) if url_tag else None)
        if not url or url in seen_urls:
            continue

        published_raw = None
        for date_tag_name in ("pubDate", "published", "date", "dc:date"):
            date_tag = item.find(date_tag_name)
            if date_tag:
                published_raw = date_tag.get_text(strip=True)
                break
        published = _strict_provider_datetime(published_raw)
        # Unknown, future, and stale records are all excluded rather than
        # silently relabeled as current.
        if published is None or published < cutoff or published > retrieved:
            continue

        # Synthetic/demo records should not enter a live feed even if a test
        # provider gives them a superficially valid timestamp and URL.
        marker_text = " ".join(
            _clean(tag.get_text(), "", 500)
            for tag in (item.find("title"), item.find("description"))
            if tag
        ).lower()
        if any(marker in marker_text for marker in ("synthetic demonstration", "training record:")):
            continue

        seen_urls.add(url)
        events.append({
            "id": str(uuid5(NAMESPACE_URL, f"{provider}:{url}")),
            "title": title,
            "question": (
                f"What does “{title}” indicate about the current operating environment, "
                "and what should an analyst watch next?"
            ),
            "url": url,
            "provider": provider,
            "publishedAt": _utc_iso(published),
            "retrievedAt": _utc_iso(retrieved),
            "freshness": "CURRENT",
        })
    return events


def _current_retry_after(raw: str | None) -> tuple[float, str]:
    """Bound untrusted Retry-After without retaining provider header text."""
    fallback = CURRENT_EVENT_ERROR_CACHE_SECONDS
    if raw is None:
        return fallback, "Retry-After missing; using default cooldown."
    value = raw.strip()
    try:
        if re.fullmatch(r"[0-9]+", value):
            # Avoid conversion limits/overflow for arbitrarily large integers.
            digits = value.lstrip("0") or "0"
            seconds = (CURRENT_EVENT_MAX_RETRY_AFTER_SECONDS + 1
                       if len(digits) > 6 else int(digits))
        else:
            if len(value) > 128:
                raise ValueError("oversized date")
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                raise ValueError("timezone required")
            seconds = (date - datetime.now(timezone.utc)).total_seconds()
        if seconds < 0:
            raise ValueError("past date")
    except (ValueError, TypeError, OverflowError):
        return fallback, "Retry-After invalid or expired; using default cooldown."
    bounded = max(fallback, min(seconds, CURRENT_EVENT_MAX_RETRY_AFTER_SECONDS))
    if seconds > CURRENT_EVENT_MAX_RETRY_AFTER_SECONDS:
        return bounded, "Retry-After capped at the one-hour safety limit."
    if seconds < fallback:
        return bounded, "Retry-After subject to the minimum cooldown."
    return bounded, "Retry-After honored."


def _current_provider_ttl(status: dict) -> float:
    if status["status"] == "OK":
        return CURRENT_EVENT_CACHE_SECONDS
    return status.get("_retry_after_seconds", CURRENT_EVENT_ERROR_CACHE_SECONDS)


async def _fetch_current_provider(
    client: httpx.AsyncClient,
    provider: str,
    url: str,
) -> tuple[list[dict], dict]:
    """Fetch one bounded RSS response and return a safe provider status."""
    require_collection_allowed()
    try:
        # ``client.get`` buffers the whole response before returning.  Stream
        # the body instead so the byte cap applies while the provider is being
        # read, and keep one wall-clock deadline over connect, headers, and all
        # body chunks.
        async with asyncio.timeout(CURRENT_EVENT_TIMEOUT_SECONDS):
            async with client.stream(
                "GET",
                url,
                follow_redirects=False,
                timeout=CURRENT_EVENT_TIMEOUT_SECONDS,
                headers={
                    "User-Agent": "AnalystWorkbenchCurrentEventDiscovery/1.0",
                    "Accept": "application/rss+xml,application/xml,text/xml",
                },
            ) as response:
                if response.is_redirect:
                    # Redirects are not followed for discovery, keeping the
                    # fixed provider allowlist and request count auditable.
                    raise httpx.HTTPStatusError(
                        "provider redirect",
                        request=response.request,
                        response=response,
                    )
                response.raise_for_status()
                content_length = response.headers.get("content-length")
                if content_length:
                    try:
                        content_length_value = int(content_length)
                    except ValueError:
                        raise ValueError("provider response had an invalid content length") from None
                    if content_length_value > MAX_CURRENT_EVENT_BYTES:
                        raise ValueError("provider response exceeded the RSS size limit")

                chunks: list[bytes] = []
                byte_count = 0
                async for chunk in response.aiter_bytes():
                    byte_count += len(chunk)
                    if byte_count > MAX_CURRENT_EVENT_BYTES:
                        raise ValueError("provider response exceeded the RSS size limit")
                    chunks.append(chunk)
                raw = b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")

        retrieved_at = _utc_iso(datetime.now(timezone.utc))
        events = parse_current_events_rss(raw, provider, retrieved_at)
    except CurrentEventFeedParseError:
        return [], {
            "provider": provider,
            "status": "ERROR",
            "message": "Provider returned malformed RSS.",
        }
    except (httpx.TimeoutException, TimeoutError):
        return [], {
            "provider": provider,
            "status": "ERROR",
            "message": "Provider request timed out.",
        }
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code in (429, 503):
            delay, explanation = _current_retry_after(exc.response.headers.get("Retry-After"))
            reason = "rate limited requests" if code == 429 else "is temporarily unavailable"
            return [], {
                "provider": provider,
                "status": "ERROR",
                "message": (
                    f"Provider {reason} (HTTP {code}). {explanation}"
                    f" Retry cooldown: {delay:g} seconds from this check."
                ),
                "_retry_after_seconds": delay,
            }
        return [], {
            "provider": provider,
            "status": "ERROR",
            "message": "Provider returned an unsuccessful response.",
        }
    except httpx.HTTPError:
        return [], {
            "provider": provider,
            "status": "ERROR",
            "message": "Provider could not be reached.",
        }
    except ValueError:
        return [], {
            "provider": provider,
            "status": "ERROR",
            "message": "Provider response exceeded the discovery limits.",
        }
    except Exception:
        # Do not disclose transport/library details or provider response
        # content to an analyst.  The status remains actionable and explicit.
        return [], {
            "provider": provider,
            "status": "ERROR",
            "message": "Provider discovery failed.",
        }

    if events:
        message = f"Provider returned {len(events)} verified current event(s)."
    else:
        # A valid, successful empty feed is distinct from malformed RSS or an
        # HTTP failure and is intentionally reported as OK.
        message = "Provider returned no verified current events."
    return events, {"provider": provider, "status": "OK", "message": message}


def blocked_current_event_feed() -> dict:
    checked_at = _utc_iso(datetime.now(timezone.utc))
    return {
        "events": [],
        "providers": [
            {
                "provider": provider,
                "status": "BLOCKED",
                "message": "External discovery is blocked for non-UNCLASSIFIED classifications.",
            }
            for provider, _ in CURRENT_EVENT_PROVIDERS
        ],
        "checkedAt": checked_at,
        "freshnessWindowHours": CURRENT_EVENT_FRESHNESS_HOURS,
        "blocked": True,
    }


@dataclass
class _CurrentProviderSnapshot:
    events: list[dict]
    status: dict
    checked_at: str
    stored_at: float


class CurrentEventDiscoveryCache:
    """Bounded public feed snapshots and local single-flight response assembly.

    Only fixed provider keys are retained, with at most two bounded snapshots
    per provider (latest attempt and last success). No user/session data enters
    this cache. Monotonic time controls retry deadlines; UTC controls evidence
    freshness. The production singleton uses SQL leases across workers/replicas.
    A missing coordinator is reserved for isolated parser/cache unit tests.
    """

    def __init__(self, coordinator: PublicFeedCoordinator | None = None) -> None:
        self._coordinator = coordinator
        self._latest: dict[tuple[str, str], _CurrentProviderSnapshot] = {}
        self._good: dict[tuple[str, str], _CurrentProviderSnapshot] = {}
        self._inflight: asyncio.Task | None = None

    def _due(self, key: tuple[str, str], now: float) -> bool:
        snapshot = self._latest.get(key)
        if snapshot is None:
            return True
        ttl = _current_provider_ttl(snapshot.status)
        return now >= snapshot.stored_at + ttl

    async def _refresh(self, keys: list[tuple[str, str]]) -> set[tuple[str, str]]:
        try:
            if self._coordinator is not None:
                results = await asyncio.gather(*(self._shared_provider(key) for key in keys))
                return {key for key, refreshed in zip(keys, results) if refreshed}
            async with httpx.AsyncClient(follow_redirects=False) as client:
                async def fetch(key: tuple[str, str]) -> None:
                    events, status = await _fetch_current_provider(client, *key)
                    snapshot = _CurrentProviderSnapshot(
                        events, status, _utc_iso(datetime.now(timezone.utc)), monotonic(),
                    )
                    self._latest[key] = snapshot
                    if status["status"] == "OK":
                        # A successful empty feed replaces older headlines too.
                        self._good[key] = snapshot

                await asyncio.gather(*(fetch(key) for key in keys))
            return set(keys)
        finally:
            self._inflight = None

    async def _shared_provider(self, key: tuple[str, str]) -> bool:
        feed_id = _PUBLIC_FEED_IDS[key]
        started = monotonic()
        outcome = "refresh_complete"
        try:
            return await self._shared_provider_attempt(key)
        except asyncio.CancelledError:
            outcome = "refresh_cancelled"
            raise
        except TimeoutError:
            outcome = "refresh_timeout"
            raise
        except Exception:
            outcome = "refresh_failed"
            raise
        finally:
            duration = monotonic() - started
            signal(feed_id, outcome, duration=duration)
            if duration >= self._coordinator.lease_seconds:
                signal(feed_id, "refresh_slow", duration=duration)

    async def _shared_provider_attempt(self, key: tuple[str, str]) -> bool:
        coordinator = self._coordinator
        feed_id = _PUBLIC_FEED_IDS[key]  # Reject all non-fixed provider keys.
        refreshed = False
        # Bound waiting even if successive lease holders crash. A failed
        # coordination service must not cause an uncoordinated network request.
        deadline = monotonic() + coordinator.lease_seconds * 2 + 2
        while monotonic() < deadline:
            token, latest, good, database_now = await asyncio.to_thread(
                coordinator.claim_or_read, feed_id,
            )
            if token:
                async with httpx.AsyncClient(follow_redirects=False) as client:
                    events, status = await _fetch_current_provider(client, *key)
                snapshot = dict(events=events, status=status,
                                checked_at=_utc_iso(datetime.now(timezone.utc)))
                ttl = _current_provider_ttl(status)
                refreshed = await asyncio.to_thread(
                    coordinator.publish, feed_id, token, snapshot, ttl,
                )
                # Read authoritative data even after losing the lease.
                continue
            if latest is not None:
                now = monotonic()
                def restore(data):
                    return _CurrentProviderSnapshot(
                        data["events"], data["status"], data["checked_at"],
                        now - max(0, database_now - data["stored_at"]),
                    )
                self._latest[key] = restore(latest)
                if good and database_now - good["stored_at"] < CURRENT_EVENT_STALE_SECONDS:
                    self._good[key] = restore(good)
                else:
                    self._good.pop(key, None)
                success = latest["status"]["status"] == "OK"
                signal(feed_id, "cache_success" if success else "cache_error")
                if not success and key in self._good:
                    signal(feed_id, "stale_fallback")
                return refreshed
            await asyncio.sleep(0.05)
        raise TimeoutError("Public feed refresh coordination timed out")

    async def get(self) -> dict:
        require_collection_allowed()
        keys = list(CURRENT_EVENT_PROVIDERS)
        now = monotonic()
        for cache in (self._latest, self._good):
            for key in list(cache):
                if key not in keys:
                    del cache[key]
        for key, snapshot in list(self._good.items()):
            if now >= snapshot.stored_at + CURRENT_EVENT_STALE_SECONDS:
                del self._good[key]

        refreshed: set[tuple[str, str]] = set()
        due = (keys if self._coordinator is not None
               else [key for key in keys if self._due(key, now)])
        if self._inflight is not None or due:
            # There is no await between checking and installing the task:
            # concurrent requests in this event loop share the same refresh.
            if self._inflight is None:
                self._inflight = asyncio.create_task(self._refresh(due))
                # Observe exceptions even if every HTTP waiter disconnects.
                self._inflight.add_done_callback(
                    lambda task: task.exception() if not task.cancelled() else None
                )
            refreshed = await asyncio.shield(self._inflight)

        now = monotonic()
        served_at = datetime.now(timezone.utc)
        cutoff = served_at - timedelta(hours=CURRENT_EVENT_FRESHNESS_HOURS)
        events: list[dict] = []
        statuses: list[dict] = []
        for key in keys:
            latest = self._latest[key]
            selected = latest
            stale = False
            if latest.status["status"] == "ERROR":
                good = self._good.get(key)
                if good and now < good.stored_at + CURRENT_EVENT_STALE_SECONDS:
                    selected, stale = good, True
            # Recheck every response, including cache hits and stale fallback.
            current = [
                event for event in selected.events
                if (published := _strict_provider_datetime(event.get("publishedAt"))) is not None
                and cutoff <= published <= served_at
            ]
            status = {
                **{name: value for name, value in latest.status.items()
                   if not name.startswith("_")},
                "cached": key not in refreshed or stale,
                "stale": stale,
                "checkedAt": selected.checked_at,
                "lastAttemptAt": latest.checked_at,
            }
            if stale:
                status["message"] += (
                    f" Stale cached provider data from {selected.checked_at};"
                    f" {len(current)} report(s) remain within the freshness window."
                )
            elif status["cached"]:
                status["message"] += f" Cached check from {selected.checked_at}."
            if len(current) != len(selected.events):
                status["message"] += " Reports outside the freshness window were excluded."
            statuses.append(status)
            events.extend(current)

        events.sort(key=lambda event: event["publishedAt"], reverse=True)
        unique = {}
        for event in events:
            unique.setdefault(event["url"], event)
        # Do not expose mutable cache records to response consumers.
        return deepcopy({
            "events": list(unique.values())[:MAX_CURRENT_EVENTS],
            "providers": statuses,
            "checkedAt": max((self._latest[key].checked_at for key in keys),
                             default=_utc_iso(served_at)),
            "freshnessWindowHours": CURRENT_EVENT_FRESHNESS_HOURS,
            "blocked": False,
        })


_current_event_cache = CurrentEventDiscoveryCache(PublicFeedCoordinator())


async def discover_current_events() -> dict:
    """Return shared public discovery; callers must authorize before cache access."""
    return await _current_event_cache.get()


async def _resolve_public_http_url(
    url: str,
) -> tuple[object, list[ipaddress.IPv4Address | ipaddress.IPv6Address]]:
    require_collection_allowed()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("document URL must use public HTTP or HTTPS")
    if parsed.username or parsed.password:
        raise ValueError("document URL must not contain credentials")

    try:
        addresses = [ipaddress.ip_address(parsed.hostname)]
    except ValueError:
        loop = asyncio.get_running_loop()
        try:
            resolved = await loop.getaddrinfo(
                parsed.hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        except socket.gaierror as exc:
            raise ValueError("document host could not be resolved") from exc
        addresses = list({
            ipaddress.ip_address(item[4][0])
            for item in resolved
        })

    if not addresses or any(
        not address.is_global or address.is_multicast or address.is_reserved
        or (isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None)
        for address in addresses
    ):
        raise ValueError("document URL resolved to a non-public address")
    return parsed, sorted(addresses, key=lambda address: (address.version != 4, str(address)))


async def extract_readable_document(
    client: httpx.AsyncClient | None,
    url: str,
) -> str:
    """Fetch and extract bounded readable text from a public web document."""
    require_collection_allowed()
    current_url = url
    async with asyncio.timeout(DOCUMENT_TIMEOUT_SECONDS):
        for redirect_count in range(MAX_DOCUMENT_REDIRECTS + 1):
            parsed, addresses = await _resolve_public_http_url(current_url)
            host_header = parsed.hostname or ""
            if parsed.port:
                host_header += f":{parsed.port}"

            async def read_hop(
                hop_client: httpx.AsyncClient,
                pinned_url: str,
            ) -> tuple[str | None, str | None]:
                require_collection_allowed()
                async with hop_client.stream(
                    "GET",
                    pinned_url,
                    follow_redirects=False,
                    timeout=DOCUMENT_TIMEOUT_SECONDS,
                    headers={
                        "Host": host_header,
                        "User-Agent": "AnalystWorkbenchProofOfConcept/0.1",
                        "Accept": "text/html,application/xhtml+xml,text/plain",
                    },
                    extensions={"sni_hostname": parsed.hostname},
                ) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise ValueError("document redirect did not provide a location")
                        return location, None

                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                    if content_type not in READABLE_CONTENT_TYPES:
                        raise ValueError("document content type is not readable text")
                    content_length = response.headers.get("content-length")
                    if content_length and int(content_length) > MAX_DOCUMENT_BYTES:
                        raise ValueError("document exceeded the 2 MB limit")

                    chunks: list[bytes] = []
                    byte_count = 0
                    async for chunk in response.aiter_bytes():
                        byte_count += len(chunk)
                        if byte_count > MAX_DOCUMENT_BYTES:
                            raise ValueError("document exceeded the 2 MB limit")
                        chunks.append(chunk)

                    raw = b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")
                    return None, raw

            last_transport_error: httpx.TransportError | None = None
            for address in addresses:
                address_text = f"[{address}]" if address.version == 6 else str(address)
                port_suffix = f":{parsed.port}" if parsed.port else ""
                pinned_url = parsed._replace(
                    netloc=f"{address_text}{port_suffix}",
                ).geturl()
                try:
                    if client is None:
                        # A fresh pool per address prevents redirects or DNS
                        # aliases from reusing another logical host's TLS session.
                        async with httpx.AsyncClient(trust_env=False) as hop_client:
                            location, raw = await read_hop(hop_client, pinned_url)
                    else:
                        # Tests may supply a MockTransport-backed client.
                        location, raw = await read_hop(client, pinned_url)
                    break
                except httpx.TransportError as exc:
                    last_transport_error = exc
            else:
                if last_transport_error is not None:
                    raise last_transport_error
                raise ValueError("document host did not provide a reachable address")

            if location is not None:
                if redirect_count == MAX_DOCUMENT_REDIRECTS:
                    raise ValueError("document exceeded the redirect limit")
                current_url = urljoin(current_url, location)
                continue
            if raw is None:
                raise ValueError("document response was empty")

            extracted = trafilatura.extract(
                raw,
                include_comments=False,
                include_tables=False,
                favor_precision=True,
                output_format="txt",
            )
            if not extracted:
                extracted = BeautifulSoup(raw, "lxml").get_text(" ", strip=True)
            readable = re.sub(r"\s+", " ", extracted or "").strip()
            if len(readable) < 120:
                raise ValueError("document did not contain enough readable text")
            return readable[:MAX_DOCUMENT_CHARS]

    raise ValueError("document could not be retrieved")


async def _hydrate_full_documents(
    client: httpx.AsyncClient | None,
    files: list[dict],
) -> list[str]:
    semaphore = asyncio.Semaphore(4)

    async def hydrate(source: dict) -> str | None:
        if urlparse(source["url"]).scheme not in {"http", "https"}:
            return None
        try:
            async with semaphore:
                text = await extract_readable_document(client, source["url"])
            source["content"] = text
            source["contentDepth"] = "FULL_TEXT"
            source["collectionMethod"] += " + bounded full-document extraction"
            source["keyPoints"] = [
                *source["keyPoints"],
                "Readable full text was extracted for content-grounded analysis.",
            ]
            return None
        except (TimeoutError, httpx.HTTPError, ValueError) as exc:
            source["keyPoints"] = [
                *source["keyPoints"],
                "Full text was unavailable; this record retains only provider-supplied content.",
            ]
            return f"{source['title']}: {exc}"

    failures = await asyncio.gather(*(hydrate(source) for source in files))
    return [
        f"Full-document extraction was unavailable for {failure}."
        for failure in failures
        if failure is not None
    ]


def parse_bing_news_rss(xml: str, prompt: str, limit: int, retrieved_at: str | None = None) -> list[dict]:
    retrieved_at = retrieved_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    files = []
    for index, item in enumerate(_rss_items(xml)[: min(limit, 25)]):
        title = _clean(item.find("title").get_text() if item.find("title") else None, "Untitled news report")
        source_tag = item.find("News:Source") or item.find("source")
        source = _clean(source_tag.get_text() if source_tag else None, "Bing News source")
        description = _clean(item.find("description").get_text() if item.find("description") else None, "")
        substantive = len(description) >= 80 and description.lower() != title.lower()
        published_at, provider_published_at, date_source = _provider_published(
            item.find("pubDate").get_text() if item.find("pubDate") else None,
            retrieved_at,
        )
        files.append({
            "id": str(uuid4()), "title": title, "source": source, "sourceType": "NEWS",
            "publishedAt": published_at, "providerPublishedAt": provider_published_at, "publicationDateSource": date_source,
            "relevance": max(.55, .95 - index * .035), "reliability": "UNKNOWN",
            "bluf": description[:700] if substantive else f"{title}. The feed did not include a substantive report excerpt.",
            "keyPoints": [f"Published by {source} and discovered through Bing News.", "The public feed supplied a substantive report snippet used for candidate extraction." if substantive else "The public feed supplied discovery metadata only; it cannot support a factual count.", "Review the linked report before final dissemination."],
            "tags": _tags(prompt) + ["live", "news"],
            "url": item.find("link").get_text(strip=True) if item.find("link") else "https://www.bing.com/news",
            "retrievedAt": retrieved_at, "collectionMethod": "Bing News public RSS",
            "content": description if substantive else title, "contentDepth": "EXCERPT" if substantive else "METADATA",
        })
    return files


async def _get(client: httpx.AsyncClient, url: str, *, json_response: bool = False) -> object:
    require_collection_allowed()
    response = await client.get(url, follow_redirects=False, timeout=12, headers={"User-Agent": "AnalystWorkbenchProofOfConcept/0.1"})
    response.raise_for_status()
    if len(response.content) > 5_000_000:
        raise ValueError("provider response exceeded the 5 MB limit")
    return response.json() if json_response else response.text


def demonstration_files(prompt: str, max_results: int = 4) -> list[dict]:
    require_collection_allowed()
    now = datetime.now(timezone.utc)
    templates = [
        ("Training record: official update identifies a change", "GOVERNMENT", "HIGH", "Synthetic training reporting indicates a measurable change, but does not establish intent or long-term trajectory.", "On 12 September 2026, Country Alpha and Country Beta exchanged fire near the North Ridge border crossing. Officials described the encounter as brief and reported no territorial change."),
        ("Training record: independent reporting adds context", "NEWS", "MODERATE", "Synthetic independent reporting broadly aligns with the training scenario while adding second-order implications.", "Independent reporting said Country Alpha and Country Beta clashed at the North Ridge border crossing on 12 September 2026. The exchange appears to describe the same brief incident reported by officials."),
    ]
    result = []
    for index, (title, source_type, reliability, bluf, content) in enumerate(templates[:max_results]):
        result.append({"id": str(uuid4()), "title": title, "source": "Demonstration Library", "sourceType": source_type, "publishedAt": (now.timestamp() - index * 86400).__str__(), "providerPublishedAt": None, "publicationDateSource": "SYNTHETIC", "relevance": .82 - index * .08, "reliability": reliability, "bluf": bluf, "keyPoints": ["This record is synthetic and must not be cited as live reporting.", "Use it only to exercise selection and assessment workflows."], "tags": _tags(prompt) + ["demonstration"], "url": f"about:blank#demonstration-source-{index + 1}", "retrievedAt": now.isoformat().replace("+00:00", "Z"), "collectionMethod": "Synthetic demonstration library", "content": content, "contentDepth": "FULL_TEXT"})
    # Preserve ISO timestamps (the timestamp above is only used to avoid a
    # dependency on date arithmetic in generated fixture text).
    for item in result:
        item["publishedAt"] = now.isoformat().replace("+00:00", "Z")
    return result


async def research(prompt: str, connector_ids: list[str], max_results: int = 12) -> tuple[list[dict], list[str]]:
    require_collection_allowed()
    unknown = [x for x in connector_ids if not is_known_connector(x)]
    if unknown:
        raise ValueError(f"Unknown source connector: {', '.join(unknown)}")
    selected = set(connector_ids)
    files: list[dict] = []
    notices: list[str] = []
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for connector in ("google-news-rss", "bing-news-rss", "federal-register", "crossref"):
            if connector not in selected:
                continue
            try:
                if connector == "bing-news-rss":
                    url = "https://www.bing.com/news/search"
                    payload = await _get(client, url + "?q=" + httpx.QueryParams({"q": prompt, "format": "rss"})["q"] + "&format=rss")
                    files.extend(parse_bing_news_rss(str(payload), prompt, max(2, (max_results + len(selected) - 1) // len(selected))))
                elif connector == "google-news-rss":
                    url = "https://news.google.com/rss/search?" + str(httpx.QueryParams({"q": prompt, "hl": "en-US", "gl": "US", "ceid": "US:en"}))
                    xml = str(await _get(client, url))
                    for index, item in enumerate(_rss_items(xml)[:25]):
                        title = _clean(item.find("title").get_text() if item.find("title") else None, "Untitled news report")
                        source_tag = item.find("source")
                        source = _clean(source_tag.get_text() if source_tag else None, "News source")
                        retrieved_at = datetime.now(timezone.utc).isoformat()
                        published_at, provider_published_at, date_source = _provider_published(
                            item.find("pubDate").get_text() if item.find("pubDate") else None,
                            retrieved_at,
                        )
                        files.append({"id": str(uuid4()), "title": title, "source": source, "sourceType": "NEWS", "publishedAt": published_at, "providerPublishedAt": provider_published_at, "publicationDateSource": date_source, "relevance": max(.55, .95 - index * .035), "reliability": "UNKNOWN", "bluf": f"{title}. This is a live discovery result; source credibility and the full article must be reviewed before use.", "keyPoints": [f"Published by {source} and discovered through Google News.", "The feed supplies article metadata rather than a validated intelligence judgment.", "Review the linked article for sourcing, context, and possible bias."], "tags": _tags(prompt) + ["live", "news"], "url": item.find("link").get_text(strip=True) if item.find("link") else "https://news.google.com/", "retrievedAt": retrieved_at, "collectionMethod": "Google News public RSS", "content": _clean(item.find("description").get_text() if item.find("description") else None, f"{title}. The RSS provider did not include an article excerpt; use the linked report for full context.", 8000), "contentDepth": "METADATA"})
                elif connector == "federal-register":
                    data = await _get(client, "https://www.federalregister.gov/api/v1/documents.json?" + str(httpx.QueryParams({"per_page": min(max_results, 20), "order": "relevance", "conditions[term]": prompt})), json_response=True)
                    for index, document in enumerate(data.get("results", [])):
                        title = _clean(document.get("title"), "Untitled Federal Register document")
                        abstract = _clean(document.get("abstract"), f"{title}. Review the official document for scope, authorities, dates, and implications.")
                        retrieved_at = datetime.now(timezone.utc).isoformat()
                        published_at, provider_published_at, date_source = _provider_published(document.get("publication_date"), retrieved_at)
                        files.append({"id": str(uuid4()), "title": title, "source": ", ".join(a.get("name", "") for a in document.get("agencies", [])) or "Federal Register", "sourceType": "GOVERNMENT", "publishedAt": published_at, "providerPublishedAt": provider_published_at, "publicationDateSource": date_source, "relevance": max(.58, .96 - index * .04), "reliability": "HIGH", "bluf": abstract, "keyPoints": ["Primary-source authority is high; analytic relevance still requires review."], "tags": _tags(prompt) + ["live", "official"], "url": document.get("html_url", "https://www.federalregister.gov/"), "retrievedAt": retrieved_at, "collectionMethod": "Federal Register public API", "content": abstract, "contentDepth": "EXCERPT" if document.get("abstract") else "METADATA"})
                else:
                    data = await _get(client, "https://api.crossref.org/works?" + str(httpx.QueryParams({"query": prompt, "rows": min(max_results, 20), "sort": "relevance"})), json_response=True)
                    for index, work in enumerate(data.get("message", {}).get("items", [])):
                        title = _clean((work.get("title") or [None])[0], "Untitled research publication")
                        abstract = _clean(work.get("abstract"), f"{title}. Crossref provides publication metadata; methodology and findings require review at the linked source.")
                        retrieved_at = datetime.now(timezone.utc).isoformat()
                        published_at, provider_published_at, date_source = _crossref_published(work, retrieved_at)
                        files.append({"id": str(uuid4()), "title": title, "source": work.get("publisher") or "Crossref indexed publisher", "sourceType": "ACADEMIC", "publishedAt": published_at, "providerPublishedAt": provider_published_at, "publicationDateSource": date_source, "relevance": max(.55, .94 - index * .035), "reliability": "MODERATE", "bluf": abstract, "keyPoints": ["Crossref provides publication metadata; methodology and findings require review."], "tags": _tags(prompt) + ["live", "research"], "url": work.get("URL") or "https://www.crossref.org/", "retrievedAt": retrieved_at, "collectionMethod": "Crossref public REST API", "content": abstract, "contentDepth": "EXCERPT" if work.get("abstract") else "METADATA"})
            except Exception as exc:
                notices.append(f"{next(x['name'] for x in SOURCE_CONNECTORS if x['id'] == connector)} was unavailable: {exc}.")
    if "demonstration-library" in selected:
        files.extend(demonstration_files(prompt, max_results))
        notices.append("Demonstration Library results are synthetic and are labeled in each record.")
    files.sort(key=lambda x: x["relevance"], reverse=True)
    files = files[: min(max_results, 20)]
    notices.extend(await _hydrate_full_documents(None, files))
    return files, notices