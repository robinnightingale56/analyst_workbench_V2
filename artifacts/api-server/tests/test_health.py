import httpx
import pytest

from api_server.config import get_settings
from api_server.main import app


@pytest.fixture(autouse=True)
def reset_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def get_health_response() -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as client:
        return await client.get("/api/healthz")


@pytest.mark.asyncio
async def test_health_reports_default_archive_policy(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "pki")
    monkeypatch.delenv("ARCHIVED_SESSION_RETENTION_DAYS", raising=False)
    monkeypatch.delenv(
        "ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES",
        raising=False,
    )

    response = await get_health_response()

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "archivePolicy": {
            "retentionDays": 30.0,
            "cleanupIntervalMinutes": 360.0,
        },
        "authentication": {
            "mode": "pki",
            "ready": False,
            "reason": "PKI_NOT_CONFIGURED",
        },
    }


@pytest.mark.asyncio
async def test_health_reports_configured_archive_policy_without_unrelated_values(
    monkeypatch,
):
    monkeypatch.setenv("AUTH_MODE", "pki")
    unrelated_value = "must-not-leak"
    monkeypatch.setenv("ARCHIVED_SESSION_RETENTION_DAYS", "12.5")
    monkeypatch.setenv("ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES", "7.25")
    monkeypatch.setenv("UNRELATED_HEALTH_TEST_VALUE", unrelated_value)

    response = await get_health_response()

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "archivePolicy": {
            "retentionDays": 12.5,
            "cleanupIntervalMinutes": 7.25,
        },
        "authentication": {
            "mode": "pki",
            "ready": False,
            "reason": "PKI_NOT_CONFIGURED",
        },
    }
    assert unrelated_value not in response.text


@pytest.mark.asyncio
async def test_health_reports_invalid_archive_configuration_without_leaking_environment(
    monkeypatch,
):
    malformed_value = "never-expose-this-value"
    unrelated_value = "unrelated-secret-value"
    monkeypatch.setenv("ARCHIVED_SESSION_RETENTION_DAYS", malformed_value)
    monkeypatch.setenv("UNRELATED_HEALTH_TEST_VALUE", unrelated_value)

    response = await get_health_response()

    assert response.status_code == 503
    assert response.json() == {
        "error": "Archive policy configuration is invalid",
    }
    assert malformed_value not in response.text
    assert unrelated_value not in response.text
    assert "ARCHIVED_SESSION_RETENTION_DAYS" not in response.text
    assert "UNRELATED_HEALTH_TEST_VALUE" not in response.text