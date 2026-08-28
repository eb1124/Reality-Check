"""
Response schemas. Deliberately response-only for Phase 1 — POST /sessions
takes no request body at all (there's no field for a client to submit a
direction into, by construction, not just by convention).
"""
from typing import Literal, Optional

from pydantic import BaseModel

Direction = Literal["LEFT", "RIGHT"]


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
