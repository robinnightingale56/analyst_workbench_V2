"""Authentication and session-ownership regression tests."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import base64

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from starlette.requests import Request

import api_server.auth as auth
from api_server.main import _public_host, app


@pytest.fixture
def clerk_tokens(monkeypatch):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    issuer = "https://clerk.test.example"
    monkeypatch.setenv("CLERK_JWT_ISSUER", issuer)
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://workbench.example")
    monkeypatch.setattr(
        auth,
        "_jwks_client",
        lambda _: SimpleNamespace(
            get_signing_key_from_jwt=lambda __: SimpleNamespace(key=private_key.public_key()),
        ),
    )

    def issue(
        user_id: str,
        *,
        expired: bool = False,
        forged: bool = False,
        authorized_party: str | None = "https://workbench.example",
    ) -> str:
        now = datetime.now(timezone.utc)
        claims = {
            "sub": user_id,
            "iss": issuer,
            "iat": now,
            "exp": now - timedelta(minutes=1) if expired else now + timedelta(minutes=5),
        }
        if authorized_party is not None:
            claims["azp"] = authorized_party
        return jwt.encode(
            claims,
            forged_private_key if forged else private_key,
            algorithm="RS256",
            headers={"kid": "test-key"},
        )

    return issue


def test_derives_trusted_issuer_from_provisioned_publishable_key(monkeypatch):
    hostname = "workbench.clerk.accounts.dev"
    encoded = base64.urlsafe_b64encode(f"{hostname}$".encode()).decode().rstrip("=")
    monkeypatch.delenv("CLERK_JWT_ISSUER", raising=False)
    monkeypatch.setenv("CLERK_PUBLISHABLE_KEY", f"pk_test_{encoded}")
    assert auth._issuer() == f"https://{hostname}"


@pytest.fixture
async def client():
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as async_client:
            yield async_client


@pytest.mark.asyncio
async def test_data_routes_reject_anonymous_requests(client):
    response = await client.get("/api/analysis-sessions")
    assert response.status_code == 401
    # Health remains an intentionally unauthenticated deployment health check.
    assert (await client.get("/api/healthz")).status_code == 200


@pytest.mark.asyncio
async def test_rejects_forged_and_expired_clerk_cookie_sessions(client, clerk_tokens):
    for token in (
        clerk_tokens("user_123", forged=True),
        clerk_tokens("user_123", expired=True),
    ):
        client.cookies.set("__session", token)
        response = await client.get("/api/analysis-sessions")
        assert response.status_code == 401
        client.cookies.clear()


@pytest.mark.asyncio
async def test_identity_cannot_be_supplied_by_request_header(client, clerk_tokens):
    response = await client.get(
        "/api/analysis-sessions",
        headers={"X-Clerk-User-Id": "user_attacker"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_users_cannot_read_another_users_session(client, clerk_tokens):
    client.cookies.set("__session", clerk_tokens("user_owner"))
    created = await client.post(
        "/api/analysis-sessions",
        headers={"Origin": "https://workbench.example"},
        json={"prompt": "Assess cross-user session isolation"},
    )
    assert created.status_code == 201
    session_id = created.json()["id"]

    client.cookies.clear()
    client.cookies.set("__session", clerk_tokens("user_other"))
    direct = await client.get(
        f"/api/analysis-sessions/{session_id}",
    )
    assert direct.status_code == 404
    listed = await client.get("/api/analysis-sessions")
    assert listed.status_code == 200
    assert session_id not in {item["id"] for item in listed.json()}
    # Seeded pre-auth data remains in the database but is never silently
    # claimed or disclosed to a later user.
    assert "demo-session" not in {item["id"] for item in listed.json()}


@pytest.mark.asyncio
async def test_rejects_untrusted_authorized_party(client, clerk_tokens):
    client.cookies.set(
        "__session",
        clerk_tokens("user_123", authorized_party="https://attacker.example"),
    )
    response = await client.get("/api/analysis-sessions")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_rejects_missing_authorized_party_when_origins_are_configured(client, clerk_tokens):
    client.cookies.set("__session", clerk_tokens("user_123", authorized_party=None))
    response = await client.get("/api/analysis-sessions")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_cookie_mutations_require_a_trusted_origin(client, clerk_tokens):
    client.cookies.set("__session", clerk_tokens("user_123"))
    payload = {"prompt": "Reject cross-site mutation"}
    assert (await client.post("/api/analysis-sessions", json=payload)).status_code == 403
    assert (
        await client.post(
            "/api/analysis-sessions",
            headers={"Origin": "https://attacker.example"},
            json=payload,
        )
    ).status_code == 403
    assert (
        await client.post(
            "/api/analysis-sessions",
            headers={"Origin": "https://workbench.example"},
            json=payload,
        )
    ).status_code == 201


@pytest.mark.asyncio
async def test_users_cannot_mutate_another_users_session(client, clerk_tokens):
    trusted_headers = {"Origin": "https://workbench.example"}
    client.cookies.set("__session", clerk_tokens("user_owner"))
    created = await client.post(
        "/api/analysis-sessions",
        headers=trusted_headers,
        json={"prompt": "Protect mutations from another account"},
    )
    session_id = created.json()["id"]
    client.cookies.clear()
    client.cookies.set("__session", clerk_tokens("user_other"))

    archive = await client.patch(
        f"/api/analysis-sessions/{session_id}",
        headers=trusted_headers,
        json={"archived": True, "expectedVersion": 1},
    )
    research = await client.post(
        f"/api/analysis-sessions/{session_id}/research",
        headers=trusted_headers,
        json={"sourceConnectorIds": ["demonstration-library"], "maxResults": 1},
    )
    assessment = await client.post(
        f"/api/analysis-sessions/{session_id}/assessment",
        headers=trusted_headers,
        json={"selectedSourceFileIds": ["not-owned"]},
    )
    assert archive.status_code == research.status_code == assessment.status_code == 404


def test_proxy_rejects_an_untrusted_forwarded_host(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://workbench.example")
    request = Request({
        "type": "http",
        "method": "GET",
        "scheme": "https",
        "path": "/api/__clerk/v1/environment",
        "headers": [
            (b"host", b"workbench.example"),
            (b"x-forwarded-host", b"attacker.example"),
        ],
        "server": ("workbench.example", 443),
    })
    with pytest.raises(HTTPException) as exc:
        _public_host(request)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Untrusted forwarded host"