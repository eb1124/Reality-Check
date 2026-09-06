"""
Request/response schemas for Phase 7 continuous-session endpoints. Kept
separate from schemas.py (the Phase 1/2 one-shot session schemas).

Free-form strings (eventType, severity, challenge type/outcome) are
validated by membership against the tuples in continuous_types.py rather
than re-declared as a second, parallel Literal here — that tuple is the
one place these values are allowed to be edited; duplicating the list as a
Literal would create exactly the drift risk this is meant to prevent.
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .continuous_types import CHALLENGE_CLIENT_OUTCOMES, EVENT_TYPES, SEVERITIES

SessionStateLiteral = Literal["CREATED", "ACTIVE", "ENDED", "CANCELLED", "ERROR"]
EndReasonLiteral = Literal["ENDED", "CANCELLED", "ERROR"]


class CreateContinuousSessionRequest(BaseModel):
    """
    Phase 9: lets an embedding consumer (e.g. an external online-assessment
    app) tag a session with its own correlation id up front — a single
    opaque string, not an arbitrary blob, so the OA can associate
    `assessmentAttemptId <-> realityCheckSessionId` without Reality Check
    depending on the OA's own data model. Entirely optional; omitting it
    (or POSTing no body at all) reproduces the pre-Phase-9 behavior exactly.
    """
    externalRef: Optional[str] = Field(default=None, max_length=200)


class ContinuousSessionResponse(BaseModel):
    sessionId: str
    state: SessionStateLiteral
    env: str
    createdAt: str
    startedAt: Optional[str] = None
    endedAt: Optional[str] = None
    riskScore: int
    riskState: Optional[str] = None
    riskEscalated: bool
    externalRef: Optional[str] = None


class EventIn(BaseModel):
    eventType: str
    severity: str
    clientOffsetMs: Optional[int] = None
    metadata: Optional[dict] = None

    @field_validator("eventType")
    @classmethod
    def _validate_event_type(cls, v: str) -> str:
        if v not in EVENT_TYPES:
            raise ValueError(f"eventType must be one of {EVENT_TYPES}")
        return v

    @field_validator("severity")
    @classmethod
    def _validate_severity(cls, v: str) -> str:
        if v not in SEVERITIES:
            raise ValueError(f"severity must be one of {SEVERITIES}")
        return v


class EventBatchRequest(BaseModel):
    events: list[EventIn]


class ChallengeResultRequest(BaseModel):
    nonce: str
    outcome: str
    detail: Optional[dict] = None

    @field_validator("outcome")
    @classmethod
    def _validate_outcome(cls, v: str) -> str:
        if v not in CHALLENGE_CLIENT_OUTCOMES:
            raise ValueError(f"outcome must be one of {CHALLENGE_CLIENT_OUTCOMES}")
        return v


class EndSessionRequest(BaseModel):
    reason: EndReasonLiteral = "ENDED"


class ReportResponse(BaseModel):
    sessionId: str
    state: str
    durationMs: Optional[float] = None
    riskState: Optional[str] = None
    riskScore: int
    riskEscalated: bool
    challenges: dict
    suspiciousEventCount: int
    timeline: list
    externalRef: Optional[str] = None
