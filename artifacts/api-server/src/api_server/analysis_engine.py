"""Compatibility exports for the backend's evidence engine."""
from .engine import (
    EVALUATION_VECTORS,
    HISTORICAL_RATINGS,
    assess_sources,
    build_count_answer,
    deduplicate_incidents,
    incident_citation_error,
    source_supports_incident,
)

__all__ = [
    "EVALUATION_VECTORS",
    "HISTORICAL_RATINGS",
    "assess_sources",
    "build_count_answer",
    "deduplicate_incidents",
    "incident_citation_error",
    "source_supports_incident",
]