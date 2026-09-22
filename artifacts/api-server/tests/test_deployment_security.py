import logging

import httpx
import pytest
from sqlalchemy import CheckConstraint, MetaData, create_engine

from api_server import main, sources, db
from api_server.auth import verify_clerk_session
from api_server.readiness import database_readiness


@pytest.mark.asyncio
@pytest.mark.parametrize("profile", ["restricted", "typo", ""])
async def test_collection_boundaries_never_send(profile, monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_PROFILE", profile)
    monkeypatch.setenv("AUTH_MODE", "pki")
    def forbidden(*args, **kwargs):
        pytest.fail("network or DNS attempted")
    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    monkeypatch.setattr(sources.socket, "getaddrinfo", forbidden)
    async with httpx.AsyncClient() as client:
        for operation in (
            sources._get(client, "https://example.com"),
            sources._fetch_current_provider(client, "BBC", "https://example.com"),
            sources.extract_readable_document(client, "https://example.com"),
            sources.research("sensitive", ["demonstration-library"]),
            sources.CurrentEventDiscoveryCache().get(),
        ):
            with pytest.raises(ValueError, match="COLLECTION_DISABLED"):
                await operation
    with pytest.raises(ValueError, match="COLLECTION_DISABLED"):
        sources.demonstration_files("sensitive")
    with pytest.raises(Exception) as error:
        verify_clerk_session("not-a-token")
    assert getattr(error.value, "status_code", None) == 503


@pytest.mark.asyncio
async def test_readiness_and_liveness(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_PROFILE", "restricted")
    monkeypatch.setenv("AUTH_MODE", "pki")
    monkeypatch.setattr(main, "database_readiness", lambda: {"ready": True})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        response = await client.get("/api/readyz")
        assert response.status_code == 503
        assert response.json()["checks"]["authentication"]["reason"] == "PKI_NOT_CONFIGURED"
        assert (await client.get("/api/healthz")).status_code == 200
        monkeypatch.setenv("AUTH_MODE", "clerk")
        response = await client.get("/api/readyz")
        assert response.json()["checks"]["deployment"]["reason"] == "RESTRICTED_REQUIRES_PKI"
        assert (await client.get("/api/__clerk")).status_code == 503
        monkeypatch.setenv("DEPLOYMENT_PROFILE", "invalid")
        assert (await client.get("/api/source-connectors")).status_code == 503


def test_database_readiness_is_read_only(monkeypatch):
    engine = create_engine("sqlite://")
    monkeypatch.setattr(db, "engine", engine)
    assert database_readiness()["ready"] is False
    from sqlalchemy import inspect
    assert inspect(engine).get_table_names() == []
    # Only this isolated in-memory engine is changed.
    metadata = MetaData()
    for table in db.Base.metadata.sorted_tables:
        clone = table.to_metadata(metadata)
        # The real metadata may have PostgreSQL-specific ownership constraints.
        for constraint in list(clone.constraints):
            if isinstance(constraint, CheckConstraint):
                clone.constraints.remove(constraint)
    metadata.create_all(engine)
    assert database_readiness() == {"ready": True}
    db.PublicFeedRow.__table__.drop(engine)
    assert database_readiness()["ready"] is False
    engine.dispose()


@pytest.mark.asyncio
async def test_database_failure_blocks_readiness(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_PROFILE", "development")
    monkeypatch.setattr(main, "auth_readiness", lambda: {"mode": "clerk", "ready": True})
    monkeypatch.setattr(main, "database_readiness", lambda: {"ready": False, "reason": "DATABASE_UNAVAILABLE_OR_SCHEMA_INCOMPLETE"})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        assert (await client.get("/api/readyz")).status_code == 503
        monkeypatch.setattr(main, "database_readiness", lambda: {"ready": True})
        assert (await client.get("/api/readyz")).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("address", ["127.0.0.1", "10.1.1.1", "169.254.169.254", "224.0.0.1", "240.0.0.1", "[::1]", "[::ffff:8.8.8.8]"])
async def test_unsafe_addresses_rejected(monkeypatch, address):
    monkeypatch.setenv("DEPLOYMENT_PROFILE", "development")
    with pytest.raises(ValueError, match="non-public"):
        await sources._resolve_public_http_url(f"http://{address}/")


@pytest.mark.asyncio
async def test_audit_only_safe_metadata(monkeypatch, caplog):
    monkeypatch.setenv("DEPLOYMENT_PROFILE", "development")
    monkeypatch.setenv("AUTH_MODE", "clerk")
    monkeypatch.setattr("api_server.auth.verify_clerk_session", lambda token: "private-subject")
    caplog.set_level(logging.INFO, logger="api_server")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test",
                                 cookies={"__session": "secret-cookie"}) as client:
        response = await client.get("/api/source-connectors?question=secret-question")
    assert response.status_code == 200
    assert "authenticated_api_access" in caplog.text
    assert "/api/source-connectors" in caplog.text
    assert all(secret not in caplog.text for secret in ["secret-cookie", "secret-question", "private-subject"])