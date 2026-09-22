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
    providerPublishedAt: str | None = None
    publicationDateSource: Literal["PROVIDER", "RETRIEVAL_FALLBACK", "SYNTHETIC", "UNKNOWN"] = "UNKNOWN"
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


class EvidenceSpan(BaseModel):
    sourceFileId: str
    text: str
    startChar: int = Field(ge=0)
    endChar: int = Field(ge=0)


class Incident(BaseModel):
    id: str
    date: str
    location: str
    parties: list[str] = Field(min_length=2)
    description: str
    sourceFileIds: list[str]
    evidenceSpans: list[EvidenceSpan] = Field(default_factory=list)
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
    sourceConnectorIds: list[str] = Field(default_factory=list)
    assessment: dict[str, Any] | None
    version: int = Field(ge=1)
    updatedAt: str
    archivedAt: str | None


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=5, max_length=500)
    analyst: str | None = None
    classification: Classification | None = None


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


class RecentQuestionStarter(BaseModel):
    sessionId: str
    prompt: str
    classification: Classification
    updatedAt: str


class OngoingEventStarter(BaseModel):
    sessionId: str
    title: str
    question: str
    sourceTitle: str
    sourceUrl: str
    publishedAt: str
    retrievedAt: str


class AnalysisStarters(BaseModel):
    recentQuestions: list[RecentQuestionStarter]
    ongoingEvents: list[OngoingEventStarter]


class CurrentEvent(BaseModel):
    id: str
    title: str
    question: str
    url: str
    provider: str
    publishedAt: datetime
    retrievedAt: datetime
    freshness: Literal["CURRENT"]


class DiscoveryProviderStatus(BaseModel):
    provider: str
    status: Literal["OK", "ERROR", "BLOCKED"]
    message: str
    cached: bool = False
    stale: bool = False
    checkedAt: datetime | None = None
    lastAttemptAt: datetime | None = None


class CurrentEventFeed(BaseModel):
    events: list[CurrentEvent]
    providers: list[DiscoveryProviderStatus]
    checkedAt: datetime
    freshnessWindowHours: float
    blocked: bool