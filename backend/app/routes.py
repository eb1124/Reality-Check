"""
Session endpoints — Phase 1 scope only.

POST /sessions   — create a session; server generates the ID and randomly
                   assigns the head-turn direction. No request body is
                   accepted or read.
GET /sessions/{id} — read-only lookup. No other HTTP methods are registered
                     for this path, so the framework itself returns 405 for
                     any attempt to modify a session through it.
"""
from fastapi import APIRouter, HTTPException

from . import models
from .schemas import SessionCreateResponse, SessionDetailResponse

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=SessionCreateResponse, status_code=201)
def create_session() -> SessionCreateResponse:
    record = models.create_session()
    return SessionCreateResponse(
        sessionId=record["session_id"],
        headTurnDirection=record["assigned_head_turn_direction"],
        status=record["status"],
    )


@router.get("/{session_id}", response_model=SessionDetailResponse)
def read_session(session_id: str) -> SessionDetailResponse:
    record = models.get_session(session_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionDetailResponse(
        sessionId=record["session_id"],
        headTurnDirection=record["assigned_head_turn_direction"],
        status=record["status"],
        createdAt=record["created_at"],
        completedAt=record["completed_at"],
    )
