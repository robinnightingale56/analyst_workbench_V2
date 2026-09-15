from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class Classification(StrEnum):
    UNCLASSIFIED = "UNCLASSIFIED"
    CUI = "CUI"
    SECRET = "SECRET"
    TS = "TS"


class SessionStatus(StrEnum):
    DRAFT = "DRAFT"
    RESEARCHING = "RESEARCHING"
    READY_FOR_SELECTION = "READY_FOR_SELECTION"
    ASSESSING = "ASSESSING"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"


class SourceFile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    title: str
    source: str
    sourceType: Literal["NEWS", "GOVERNMENT", "ACADEMIC", "SOCIAL", "WEB", "INTERNAL"]
    publishedAt: str
    relevance: float = Field(ge=0, le=1)
    reliability: Literal["HIGH", "MODERATE", "LOW", "UNKNOWN"]
    bluf: str
    keyPoints: list[str]
    tags: list[str]
    url: str
    retrievedAt: str
    collectionMethod: str
    content: str
    contentDepth: Literal["FULL_TEXT", "EXCERPT", "METADATA"]


class Incident(BaseModel):
    id: str
    date: str
    location: str
    parties: list[str] = Field(min_length=2)
    description: str
    sourceFileIds: list[str]
    status: Literal["INCLUDED", "EXCLUDED"]

    @field_validator("parties")
    @classmethod
    def parties_must_be_nonblank(cls, parties: list[str]) -> list[str]:
        normalized = [party.strip() for party in parties]
        if any(not party for party in normalized):
            raise ValueError("incident parties must not be blank")
        return normalized


class AnalysisSession(BaseModel):
    id: str
    prompt: str
    analyst: str
    classification: Classification
    status: SessionStatus
    createdAt: str
    sourceFiles: list[SourceFile]
    sourceNotices: list[str]
    assessment: dict[str, Any] | None
    version: int = Field(ge=1)
    updatedAt: str
    archivedAt: str | None


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="allow")
    prompt: str = Field(min_length=5, max_length=500)
    analyst: str | None = None
    classification: Classification | None = None
    provenance: str | None = None
    runId: str | None = None


class ArchiveUpdate(BaseModel):
    archived: bool
    expectedVersion: int = Field(ge=1)


class ResearchRun(BaseModel):
    sourceConnectorIds: list[str]
    maxResults: int | None = Field(default=None, ge=1, le=20)


class AssessmentInput(BaseModel):
    selectedSourceFileIds: list[str]


class IncidentReview(BaseModel):
    expectedVersion: int = Field(ge=1)
    finalized: bool
    incidents: list[Incident]