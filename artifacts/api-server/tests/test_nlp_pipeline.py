import asyncio
import ipaddress
from urllib.parse import urlparse

import httpx
import pytest

import api_server.sources as sources
from api_server.engine import build_count_answer, source_supports_incident
from api_server.sources import (
    _hydrate_full_documents,
    extract_readable_document,
)


def source(source_id: str, content: str, depth: str = "FULL_TEXT") -> dict:
    return {
        "id": source_id,
        "title": f"Report {source_id}",
        "source": "Test publisher",
        "sourceType": "NEWS",
        "publishedAt": "2026-09-12T00:00:00Z",
        "relevance": 0.9,
        "reliability": "HIGH",
        "bluf": "Test report",
        "keyPoints": [],
        "tags": [],
        "url": "https://93.184.216.34/report",
        "retrievedAt": "2026-09-12T00:00:00Z",
        "collectionMethod": "test",
        "content": content,
        "contentDepth": depth,
    }


@pytest.mark.asyncio
async def test_extracts_bounded_readable_full_text_from_html():
    article = """
    <html><body><nav>Navigation</nav><article>
    <h1>Border update</h1>
    <p>On 12 September 2026, Country Alpha and Country Beta exchanged fire
    near the North Ridge border crossing.</p>
    <p>Officials said the incident ended quickly and did not change control
    of the crossing. Independent observers documented the event.</p>
    </article></body></html>
    """

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            text=article,
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        extracted = await extract_readable_document(
            client,
            "https://93.184.216.34/report",
        )

    assert "Country Alpha and Country Beta exchanged fire" in extracted
    assert "Navigation" not in extracted


@pytest.mark.asyncio
async def test_pins_validated_dns_address_and_preserves_https_identity(monkeypatch):
    async def resolve(url: str):
        return urlparse(url), [ipaddress.ip_address("93.184.216.34")]

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "93.184.216.34"
        assert request.headers["host"] == "reports.example"
        assert request.extensions["sni_hostname"] == "reports.example"
        return httpx.Response(
            200,
            headers={"content-type": "text/plain"},
            text="A bounded public report. " * 10,
            request=request,
        )

    monkeypatch.setattr(sources, "_resolve_public_http_url", resolve)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        extracted = await extract_readable_document(
            client,
            "https://reports.example/report",
        )

    assert extracted.startswith("A bounded public report.")


@pytest.mark.asyncio
async def test_retries_all_validated_addresses_for_dual_stack_host(monkeypatch):
    attempted_hosts = []

    async def resolve(url: str):
        return urlparse(url), [
            ipaddress.ip_address("2001:4860:4860::8888"),
            ipaddress.ip_address("93.184.216.34"),
        ]

    async def handler(request: httpx.Request) -> httpx.Response:
        attempted_hosts.append(request.url.host)
        if request.url.host == "2001:4860:4860::8888":
            raise httpx.ConnectError("IPv6 route unavailable", request=request)
        assert request.headers["host"] == "reports.example"
        assert request.extensions["sni_hostname"] == "reports.example"
        return httpx.Response(
            200,
            headers={"content-type": "text/plain"},
            text="A reachable report after the first validated address failed. " * 4,
            request=request,
        )

    monkeypatch.setattr(sources, "_resolve_public_http_url", resolve)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        extracted = await extract_readable_document(
            client,
            "https://reports.example/report",
        )

    assert attempted_hosts == ["2001:4860:4860::8888", "93.184.216.34"]
    assert extracted.startswith("A reachable report")


@pytest.mark.asyncio
async def test_dns_addresses_are_deduplicated_in_ipv4_first_order(monkeypatch):
    async def getaddrinfo(*_args, **_kwargs):
        return [
            (None, None, None, None, ("2001:4860:4860::8888", 443, 0, 0)),
            (None, None, None, None, ("93.184.216.35", 443)),
            (None, None, None, None, ("93.184.216.34", 443)),
            (None, None, None, None, ("93.184.216.35", 443)),
        ]

    loop = asyncio.get_running_loop()
    monkeypatch.setattr(loop, "getaddrinfo", getaddrinfo)
    _, addresses = await sources._resolve_public_http_url(
        "https://reports.example/report",
    )

    assert [str(address) for address in addresses] == [
        "93.184.216.34",
        "93.184.216.35",
        "2001:4860:4860::8888",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/report",
        "http://100.64.0.1/report",
        "http://192.0.2.1/report",
        "http://[2001:db8::1]/report",
    ],
)
async def test_rejects_non_global_document_hosts_before_fetch(url):
    called = False

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, text="should not be fetched", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="non-public address"):
            await extract_readable_document(client, url)

    assert called is False


@pytest.mark.asyncio
async def test_rejects_redirect_to_private_host():
    requests = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(
            302,
            headers={"location": "http://127.0.0.1/internal"},
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="non-public address"):
            await extract_readable_document(client, "https://93.184.216.34/report")

    assert requests == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({"content-type": "application/pdf"}, "content type"),
        (
            {"content-type": "text/html", "content-length": "2000001"},
            "2 MB limit",
        ),
    ],
)
async def test_rejects_unreadable_or_oversized_documents(headers, expected):
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers=headers,
            text="Readable text " * 20,
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match=expected):
            await extract_readable_document(client, "https://93.184.216.34/report")


@pytest.mark.asyncio
async def test_applies_hard_deadline_to_slow_document_stream(monkeypatch):
    class SlowStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            await asyncio.sleep(0.05)
            yield b"Readable text " * 20

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/plain"},
            stream=SlowStream(),
            request=request,
        )

    monkeypatch.setattr(sources, "DOCUMENT_TIMEOUT_SECONDS", 0.01)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(TimeoutError):
            await extract_readable_document(client, "https://93.184.216.34/report")


@pytest.mark.asyncio
async def test_inaccessible_report_retains_provider_content_and_label():
    original = source(
        "unavailable",
        "Provider supplied metadata only",
        depth="METADATA",
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        notices = await _hydrate_full_documents(client, [original])

    assert original["content"] == "Provider supplied metadata only"
    assert original["contentDepth"] == "METADATA"
    assert "Full text was unavailable" in original["keyPoints"][-1]
    assert notices


def test_nlp_pipeline_deduplicates_and_filters_unsupported_events():
    first = source(
        "one",
        (
            "On 12 September 2026, Country Alpha and Country Beta exchanged "
            "fire near the North Ridge border crossing. "
            "Country Alpha and Country Beta did not clash near South Point "
            "on 13 September 2026. "
            "Country Alpha and Country Beta may clash near West Ridge "
            "on 14 September 2026."
        ),
    )
    corroborating = source(
        "two",
        (
            "Country Alpha and Country Beta clashed at North Ridge on "
            "12 September 2026. "
            "On 15 September 2026, Country Alpha and Country Beta fought "
            "near East Valley."
        ),
    )

    answer = build_count_answer(
        "How many times did Country Alpha and Country Beta clash in 2026?",
        [first, corroborating],
    )

    assert answer is not None
    assert answer["provisionalCount"] == 2
    assert answer["incidents"][0]["sourceFileIds"] == ["one", "two"]
    assert answer["incidents"][0]["description"].startswith("On 12 September 2026")
    assert answer["incidents"][1]["date"].startswith("2026-09-15")
    for span in answer["incidents"][0]["evidenceSpans"]:
        cited_source = next(item for item in [first, corroborating] if item["id"] == span["sourceFileId"])
        assert cited_source["content"][span["startChar"]:span["endChar"]] == span["text"]


def test_event_scope_keeps_factual_no_casualties_and_rejects_counterfactual():
    report = source(
        "scope",
        (
            "On 12 September 2026, Country Alpha and Country Beta clashed "
            "near North Ridge, with no casualties. "
            "Had Country Alpha and Country Beta clashed near West Ridge on "
            "13 September 2026, monitors would have reported it."
        ),
    )

    answer = build_count_answer(
        "How many times did Country Alpha and Country Beta clash in 2026?",
        [report],
    )

    assert answer is not None
    assert answer["provisionalCount"] == 1
    assert answer["incidents"][0]["date"].startswith("2026-09-12")


def test_event_scope_keeps_factual_event_when_no_casualties_comes_first():
    report = source(
        "scope-before",
        (
            "No casualties were reported when Country Alpha and Country Beta "
            "clashed near North Ridge on 12 September 2026."
        ),
    )

    answer = build_count_answer(
        "How many times did Country Alpha and Country Beta clash in 2026?",
        [report],
    )

    assert answer is not None
    assert answer["provisionalCount"] == 1


@pytest.mark.parametrize(
    "negated",
    [
        (
            "There was no clash between Country Alpha and Country Beta near "
            "North Ridge on 12 September 2026."
        ),
        (
            "Country Alpha and Country Beta met without a clash near North "
            "Ridge on 12 September 2026."
        ),
    ],
)
def test_rejects_direct_no_or_without_event_negation(negated):
    report = source("direct-negation", negated)
    answer = build_count_answer(
        "How many times did Country Alpha and Country Beta clash in 2026?",
        [report],
    )

    assert answer is not None
    assert answer["provisionalCount"] == 0

    incident = {
        "id": "candidate",
        "date": "2026-09-12T00:00:00Z",
        "location": "North Ridge",
        "parties": ["Country Alpha", "Country Beta"],
        "description": negated,
        "sourceFileIds": [report["id"]],
        "evidenceSpans": [{
            "sourceFileId": report["id"],
            "text": negated,
            "startChar": 0,
            "endChar": len(negated),
        }],
        "status": "INCLUDED",
    }
    assert source_supports_incident(report, incident) is False


def test_rejects_denial_governing_multi_token_parties_for_count_and_citation():
    denied = (
        "Reports denied that Country Alpha and Country Beta clashed near "
        "North Ridge on 12 September 2026."
    )
    report = source("denied", denied)
    answer = build_count_answer(
        "How many times did Country Alpha and Country Beta clash in 2026?",
        [report],
    )
    assert answer is not None
    assert answer["provisionalCount"] == 0

    incident = {
        "id": "denied-candidate",
        "date": "2026-09-12T00:00:00Z",
        "location": "North Ridge",
        "parties": ["Country Alpha", "Country Beta"],
        "description": denied,
        "sourceFileIds": [report["id"]],
        "evidenceSpans": [{
            "sourceFileId": report["id"],
            "text": denied,
            "startChar": 0,
            "endChar": len(denied),
        }],
        "status": "INCLUDED",
    }
    assert source_supports_incident(report, incident) is False


def test_allows_factual_event_in_contrasting_clause_after_denial():
    report = source(
        "contrast",
        (
            "Officials denied an earlier rumor, but Country Alpha and Country "
            "Beta clashed near North Ridge on 12 September 2026."
        ),
    )
    answer = build_count_answer(
        "How many times did Country Alpha and Country Beta clash in 2026?",
        [report],
    )

    assert answer is not None
    assert answer["provisionalCount"] == 1


@pytest.mark.parametrize(
    "unsupported",
    [
        (
            "If reports are accurate, Country Alpha and Country Beta clashed "
            "near North Ridge on 12 September 2026."
        ),
        (
            "No evidence showed Country Alpha and Country Beta clashed near "
            "North Ridge on 12 September 2026."
        ),
    ],
)
def test_rejects_leading_conditional_or_no_evidence_claims(unsupported):
    answer = build_count_answer(
        "How many times did Country Alpha and Country Beta clash in 2026?",
        [source("unsupported", unsupported)],
    )

    assert answer is not None
    assert answer["provisionalCount"] == 0


def test_conflicting_dates_are_not_deduplicated():
    reports = [
        source(
            "one",
            "On 12 September 2026, Country Alpha and Country Beta clashed near North Ridge.",
        ),
        source(
            "two",
            "On 13 September 2026, Country Alpha and Country Beta clashed near North Ridge.",
        ),
    ]

    answer = build_count_answer(
        "How many times did Country Alpha and Country Beta clash in 2026?",
        reports,
    )

    assert answer is not None
    assert answer["provisionalCount"] == 2