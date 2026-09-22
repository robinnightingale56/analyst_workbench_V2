"""Fail-closed deployment policy. Restricted providers are not implemented."""
import os


def deployment_readiness() -> dict:
    profile = os.getenv("DEPLOYMENT_PROFILE", "development").strip()
    if profile not in {"development", "restricted"}:
        return {"profile": "invalid", "ready": False, "reason": "DEPLOYMENT_PROFILE_INVALID"}
    if profile == "restricted" and os.getenv("AUTH_MODE", "clerk").strip() != "pki":
        return {"profile": profile, "ready": False, "reason": "RESTRICTED_REQUIRES_PKI"}
    return {"profile": profile, "ready": True}


def require_collection_allowed() -> None:
    posture = deployment_readiness()
    if not posture["ready"] or posture["profile"] != "development":
        raise ValueError("COLLECTION_DISABLED_BY_DEPLOYMENT_PROFILE")