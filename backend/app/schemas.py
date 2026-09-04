"""
Response schemas, plus the one request schema Phase 2 introduces.
POST /sessions still takes no request body at all (there's no field for a
client to submit a direction into, by construction, not just by convention).
POST /sessions/{id}/result does take a body: the client-computed verdict —
see ResultSubmitRequest for exactly what it can and can't influence.
"""
from typing import Literal, Optional

from pydantic import BaseModel

Direction = Literal["LEFT", "RIGHT"]
Outcome = Literal["VERIFIED", "INCOMPLETE_RETRY"]


class SessionCreateResponse(BaseModel):
    sessionId: str
    headTurnDirection: Direction
    status: str


class SessionDetailResponse(BaseModel):
    sessionId: str
    headTurnDirection: Direction
    status: str
    createdAt: str
    completedAt: Optional[str] = None
    headTurnOutcome: Optional[str] = None
    lightChallengeOutcome: Optional[str] = None


class ResultSubmitRequest(BaseModel):
    """
    The verdict an already-completed client-side verification flow computed
    (see frontend useVerificationOrchestrator.js). `outcome` is constrained
    to the two categorical values the orchestrator actually produces — no
    numeric score or probability field exists here, deliberately: this
    backend does not compute or store a confidence value, only the
    categorical result and the per-challenge state strings the UI already
    displays. The per-challenge fields are free-form status strings (e.g.
    "SUCCESS", "LIGHT_PASS", "DECLINED") rather than a closed enum, since
    they're diagnostic/display evidence, not something this endpoint makes
    a decision from — the decision (`outcome`) was already made client-side.
    """
    outcome: Outcome
    headTurnOutcome: Optional[str] = None
    lightChallengeOutcome: Optional[str] = None
