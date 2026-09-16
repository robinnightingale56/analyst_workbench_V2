from __future__ import annotations
import asyncio
import html
import ipaddress
import re
import socket
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse
from uuid import uuid4
import httpx
import trafilatura
from bs4 import BeautifulSoup
from .models import SourceFile

MAX_DOCUMENT_BYTES = 2_000_000
MAX_DOCUMENT_CHARS = 500_000
DOCUMENT_TIMEOUT_SECONDS = 10
MAX_DOCUMENT_REDIRECTS = 3
READABLE_CONTENT_TYPES = {
    "text/html",
    "application/xhtml+xml",
    "text/plain",
}

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


async def _resolve_public_http_url(
    url: str,
) -> tuple[object, list[ipaddress.IPv4Address | ipaddress.IPv6Address]]:
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

    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("document URL resolved to a non-public address")
    return parsed, sorted(addresses, key=lambda address: (address.version != 4, str(address)))


async def extract_readable_document(
    client: httpx.AsyncClient | None,
    url: str,
) -> str:
    """Fetch and extract bounded readable text from a public web document."""
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
                        async with httpx.AsyncClient() as hop_client:
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
    response = await client.get(url, timeout=12, headers={"User-Agent": "AnalystWorkbenchProofOfConcept/0.1"})
    response.raise_for_status()
    if len(response.content) > 5_000_000:
        raise ValueError("provider response exceeded the 5 MB limit")
    return response.json() if json_response else response.text


def demonstration_files(prompt: str, max_results: int = 4) -> list[dict]:
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