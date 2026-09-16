"""Clerk cookie-session authentication for the FastAPI API.

The browser sends Clerk's ``__session`` cookie automatically on same-origin
requests.  Identity is extracted only after signature, issuer, expiry, and
subject validation by PyJWT; no request header or body can select a user.
"""
from __future__ import annotations

import os
import base64
import binascii
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

import jwt
from fastapi import HTTPException, Request, status
from jwt import PyJWKClient

SESSION_COOKIE = "__session"
ALGORITHMS = ("RS256", "RS384", "RS512")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class ClerkAuthenticationError(Exception):
    """Raised when a request does not contain a valid Clerk session JWT."""


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
    """FastAPI dependency for every user-visible API route."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    try:
        return verify_clerk_session(token)
    except ClerkAuthenticationError:
        # Never disclose key, issuer, or JWT parse errors to an unauthenticated
        # caller.  They are useful only to server operators.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        ) from None