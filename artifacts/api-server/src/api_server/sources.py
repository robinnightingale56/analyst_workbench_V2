from __future__ import annotations
import html
import re
from datetime import datetime, timezone
from uuid import uuid4
import httpx
from bs4 import BeautifulSoup
from .models import SourceFile

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


def _published(raw: str | None, fallback: str) -> str:
    if not raw:
        return fallback
    try:
        from email.utils import parsedate_to_datetime
        date = parsedate_to_datetime(raw)
        return date.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError):
        return fallback


def _rss_items(xml: str) -> list[BeautifulSoup]:
    soup = BeautifulSoup(xml, "xml")
    return soup.find_all("item")


def parse_bing_news_rss(xml: str, prompt: str, limit: int, retrieved_at: str | None = None) -> list[dict]:
    retrieved_at = retrieved_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    files = []
    for index, item in enumerate(_rss_items(xml)[: min(limit, 25)]):
        title = _clean(item.find("title").get_text() if item.find("title") else None, "Untitled news report")
        source_tag = item.find("News:Source") or item.find("source")
        source = _clean(source_tag.get_text() if source_tag else None, "Bing News source")
        description = _clean(item.find("description").get_text() if item.find("description") else None, "")
        substantive = len(description) >= 80 and description.lower() != title.lower()
        files.append({
            "id": str(uuid4()), "title": title, "source": source, "sourceType": "NEWS",
            "publishedAt": _published(item.find("pubDate").get_text() if item.find("pubDate") else None, retrieved_at),
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
        result.append({"id": str(uuid4()), "title": title, "source": "Demonstration Library", "sourceType": source_type, "publishedAt": (now.timestamp() - index * 86400).__str__(), "relevance": .82 - index * .08, "reliability": reliability, "bluf": bluf, "keyPoints": ["This record is synthetic and must not be cited as live reporting.", "Use it only to exercise selection and assessment workflows."], "tags": _tags(prompt) + ["demonstration"], "url": f"about:blank#demonstration-source-{index + 1}", "retrievedAt": now.isoformat().replace("+00:00", "Z"), "collectionMethod": "Synthetic demonstration library", "content": content, "contentDepth": "FULL_TEXT"})
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
                        files.append({"id": str(uuid4()), "title": title, "source": source, "sourceType": "NEWS", "publishedAt": _published(item.find("pubDate").get_text() if item.find("pubDate") else None, datetime.now(timezone.utc).isoformat()), "relevance": max(.55, .95 - index * .035), "reliability": "UNKNOWN", "bluf": f"{title}. This is a live discovery result; source credibility and the full article must be reviewed before use.", "keyPoints": [f"Published by {source} and discovered through Google News.", "The feed supplies article metadata rather than a validated intelligence judgment.", "Review the linked article for sourcing, context, and possible bias."], "tags": _tags(prompt) + ["live", "news"], "url": item.find("link").get_text(strip=True) if item.find("link") else "https://news.google.com/", "retrievedAt": datetime.now(timezone.utc).isoformat(), "collectionMethod": "Google News public RSS", "content": _clean(item.find("description").get_text() if item.find("description") else None, f"{title}. The RSS provider did not include an article excerpt; use the linked report for full context.", 8000), "contentDepth": "METADATA"})
                elif connector == "federal-register":
                    data = await _get(client, "https://www.federalregister.gov/api/v1/documents.json?" + str(httpx.QueryParams({"per_page": min(max_results, 20), "order": "relevance", "conditions[term]": prompt})), json_response=True)
                    for index, document in enumerate(data.get("results", [])):
                        title = _clean(document.get("title"), "Untitled Federal Register document")
                        abstract = _clean(document.get("abstract"), f"{title}. Review the official document for scope, authorities, dates, and implications.")
                        files.append({"id": str(uuid4()), "title": title, "source": ", ".join(a.get("name", "") for a in document.get("agencies", [])) or "Federal Register", "sourceType": "GOVERNMENT", "publishedAt": document.get("publication_date", "") + "T12:00:00Z", "relevance": max(.58, .96 - index * .04), "reliability": "HIGH", "bluf": abstract, "keyPoints": ["Primary-source authority is high; analytic relevance still requires review."], "tags": _tags(prompt) + ["live", "official"], "url": document.get("html_url", "https://www.federalregister.gov/"), "retrievedAt": datetime.now(timezone.utc).isoformat(), "collectionMethod": "Federal Register public API", "content": abstract, "contentDepth": "EXCERPT" if document.get("abstract") else "METADATA"})
                else:
                    data = await _get(client, "https://api.crossref.org/works?" + str(httpx.QueryParams({"query": prompt, "rows": min(max_results, 20), "sort": "relevance"})), json_response=True)
                    for index, work in enumerate(data.get("message", {}).get("items", [])):
                        title = _clean((work.get("title") or [None])[0], "Untitled research publication")
                        abstract = _clean(work.get("abstract"), f"{title}. Crossref provides publication metadata; methodology and findings require review at the linked source.")
                        files.append({"id": str(uuid4()), "title": title, "source": work.get("publisher") or "Crossref indexed publisher", "sourceType": "ACADEMIC", "publishedAt": datetime.now(timezone.utc).isoformat(), "relevance": max(.55, .94 - index * .035), "reliability": "MODERATE", "bluf": abstract, "keyPoints": ["Crossref provides publication metadata; methodology and findings require review."], "tags": _tags(prompt) + ["live", "research"], "url": work.get("URL") or "https://www.crossref.org/", "retrievedAt": datetime.now(timezone.utc).isoformat(), "collectionMethod": "Crossref public REST API", "content": abstract, "contentDepth": "EXCERPT" if work.get("abstract") else "METADATA"})
            except Exception as exc:
                notices.append(f"{next(x['name'] for x in SOURCE_CONNECTORS if x['id'] == connector)} was unavailable: {exc}.")
    if "demonstration-library" in selected:
        files.extend(demonstration_files(prompt, max_results))
        notices.append("Demonstration Library results are synthetic and are labeled in each record.")
    files.sort(key=lambda x: x["relevance"], reverse=True)
    return files[: min(max_results, 20)], notices