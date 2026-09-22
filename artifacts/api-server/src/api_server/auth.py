"""Authentication boundary for the FastAPI API.

The default Clerk implementation validates the same-origin ``__session``
cookie.  PKI mode is deliberately a closed readiness state until an approved
gateway or identity-provider adapter is implemented; it never accepts
certificate uploads, arbitrary identity headers, or Clerk sessions as a
substitute.
"""
from __future__ import annotations

import os
import base64
import binascii
from functools import lru_cache
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

import jwt
from fastapi import HTTPException, Request, status
from jwt import PyJWKClient
from .deployment import deployment_readiness

SESSION_COOKIE = "__session"
ALGORITHMS = ("RS256", "RS384", "RS512")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
AuthMode = Literal["clerk", "pki"]


@dataclass(frozen=True)
class TrustedPrincipal:
    """A verified identity exposed to application authorization code.

    ``subject`` is deliberately the existing owner identifier.  A future
    approved PKI adapter must construct this object only after cryptographic
    verification and reviewed subject-to-owner mapping; request metadata must
    never construct it directly.
    """

    subject: str
    provider: str


class ClerkAuthenticationError(Exception):
    """Raised when a request does not contain a valid Clerk session JWT."""


def auth_mode() -> AuthMode | None:
    """Return the configured authentication mode, or None for an invalid mode.

    The default preserves current Clerk development deployments.  Returning
    ``None`` instead of silently falling back makes a typo fail closed.
    """
    configured = os.getenv("AUTH_MODE", "clerk").strip()
    return configured if configured in {"clerk", "pki"} else None


def auth_readiness() -> dict[str, object]:
    """Public, non-secret auth posture for deployment/readiness reporting."""
    mode = auth_mode()
    deployment = deployment_readiness()
    if not deployment["ready"]:
        return {"mode": mode or "invalid", "ready": False, "reason": deployment["reason"]}
    if mode is None:
        return {
            "mode": "invalid",
            "ready": False,
            "reason": "AUTH_MODE_INVALID",
        }
    if mode == "pki":
        return {
            "mode": "pki",
            "ready": False,
            "reason": "PKI_NOT_CONFIGURED",
        }
    try:
        _issuer()
    except ClerkAuthenticationError:
        return {
            "mode": "clerk",
            "ready": False,
            "reason": "CLERK_NOT_CONFIGURED",
        }
    return {"mode": "clerk", "ready": True}


def _not_configured_error(reason: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=reason)


def require_auth_ready() -> AuthMode:
    """Gate protected behavior before any provider-specific authentication."""
    mode = auth_mode()
    deployment = deployment_readiness()
    if not deployment["ready"]:
        raise _not_configured_error(deployment["reason"])
    if mode is None:
        raise _not_configured_error("AUTH_MODE_INVALID")
    if mode == "pki":
        raise _not_configured_error("PKI_NOT_CONFIGURED")
    return mode


def trusted_origins() -> set[str]:
    """Return explicit browser origins trusted for Clerk cookies and proxying.

    Replit supplies ``REPLIT_DOMAINS`` at runtime, while self-hosted deployments
    configure ``ALLOWED_ORIGINS``. Values are normalized as origins so an
    attacker-controlled Host/forwarded-host header never becomes trusted.
    """
    configured = [
        value.strip().rstrip("/")
        for value in os.getenv("ALLOWED_ORIGINS", "").split(",")
        if value.strip()
    ]
    replit_domains = [
        f"https://{value.strip().rstrip('/')}"
        for value in os.getenv("REPLIT_DOMAINS", "").split(",")
        if value.strip()
    ]
    origins: set[str] = set()
    for origin in [*configured, *replit_domains]:
        parsed = urlparse(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            continue
        origins.add(f"{parsed.scheme}://{parsed.netloc}".lower())
    return origins


def require_trusted_origin(request: Request) -> None:
    """Reject cookie-authenticated writes that did not originate at this app."""
    # In PKI mode every protected route has the same explicit readiness
    # response, including writes with a forged Origin header.
    require_auth_ready()
    if request.method in SAFE_METHODS:
        return
    origin = request.headers.get("origin", "").strip().rstrip("/").lower()
    if not origin or origin not in trusted_origins():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Untrusted request origin",
        )


def _issuer() -> str:
    """Resolve the trusted Clerk issuer from provisioned configuration.

    A Clerk publishable key encodes the Frontend API hostname.  Unlike an
    unverified JWT ``iss`` claim, this is server environment configuration and
    is therefore safe to use to form the JWKS endpoint.  ``CLERK_JWT_ISSUER``
    remains an optional operator override for custom/self-hosted instances.
    """
    configured = os.getenv("CLERK_JWT_ISSUER", "").strip().rstrip("/")
    if configured:
        if not configured.startswith("https://"):
            raise ClerkAuthenticationError("Clerk JWT issuer must use HTTPS")
        return configured

    publishable_key = os.getenv("CLERK_PUBLISHABLE_KEY", "").strip()
    try:
        _, environment, encoded_host = publishable_key.split("_", 2)
        if environment not in {"test", "live"}:
            raise ValueError("unknown Clerk key environment")
        padded = encoded_host + "=" * (-len(encoded_host) % 4)
        hostname = base64.urlsafe_b64decode(padded).decode("utf-8").rstrip("$")
    except (ValueError, UnicodeDecodeError, binascii.Error):
        raise ClerkAuthenticationError("Clerk publishable key is not configured") from None

    parsed = urlparse(f"https://{hostname}")
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ClerkAuthenticationError("Clerk publishable key has an invalid host")
    return f"https://{parsed.netloc}"


@lru_cache(maxsize=4)
def _jwks_client(issuer: str) -> PyJWKClient:
    # The issuer is administrator configuration, never an unverified token
    # claim, so this does not turn JWT verification into an SSRF primitive.
    return PyJWKClient(
        f"{issuer}/.well-known/jwks.json",
        cache_keys=True,
        lifespan=300,
        timeout=5,
    )


def verify_clerk_session(token: str) -> str:
    """Return a verified Clerk user ID or raise ClerkAuthenticationError."""
    require_auth_ready()
    issuer = _issuer()
    audience = os.getenv("CLERK_JWT_AUDIENCE", "").strip() or None
    try:
        signing_key = _jwks_client(issuer).get_signing_key_from_jwt(token).key
        claims: dict[str, Any] = jwt.decode(
            token,
            signing_key,
            algorithms=list(ALGORITHMS),
            issuer=issuer,
            audience=audience,
            options={
                "require": ["exp", "iss", "sub"],
                "verify_aud": audience is not None,
            },
        )
    except jwt.PyJWTError as exc:
        raise ClerkAuthenticationError("Invalid Clerk session") from exc

    # Clerk's authorized-party claim binds the session to one of our public
    # browser origins. Validate it when an origin allowlist is configured;
    # deployments without trusted-origin configuration fail closed on writes.
    origins = trusted_origins()
    authorized_party = claims.get("azp")
    if origins and (
        not isinstance(authorized_party, str)
        or authorized_party.rstrip("/").lower() not in origins
    ):
        raise ClerkAuthenticationError("Clerk session has an untrusted authorized party")

    user_id = claims.get("sub")
    if not isinstance(user_id, str) or not user_id.strip():
        raise ClerkAuthenticationError("Clerk session has no user subject")
    return user_id


async def require_user(request: Request) -> str:
    """Compatibility dependency returning the existing owner-ID string."""
    principal = await require_principal(request)
    request.state.audit_authenticated = True
    return principal.subject


async def require_principal(request: Request) -> TrustedPrincipal:
    """Provider-neutral FastAPI dependency for protected routes.

    This is intentionally the sole boundary future IdP/mTLS adapters should
    implement against.  There is no generic header, certificate, or body
    fallback while PKI readiness is incomplete.
    """
    require_auth_ready()
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    try:
        return TrustedPrincipal(subject=verify_clerk_session(token), provider="clerk")
    except ClerkAuthenticationError:
        # Never disclose key, issuer, or JWT parse errors to an unauthenticated
        # caller.  They are useful only to server operators.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        ) from None