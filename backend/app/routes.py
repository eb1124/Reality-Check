"""
Session endpoints.

POST /sessions   — create a session; server generates the ID and randomly
                   assigns the head-turn direction. No request body is
                   accepted or read.
GET /sessions/{id} — read-only lookup. PUT/PATCH/DELETE are not registered
                     for this path, so the framework itself returns 405 for
                     any attempt to modify a session through it.
POST /sessions/{id}/result — finalize a PENDING session with the client's
                     already-computed verdict (Phase 2: event ingestion).
                     Not independent re-verification — see ResultSubmitRequest
                     and models.submit_result docstrings for the trust model.
"""
from fastapi import APIRouter, HTTPException

from . import models
from .schemas import ResultSubmitRequest, SessionCreateResponse, SessionDetailResponse

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _to_detail_response(record: dict) -> SessionDetailResponse:
    return SessionDetailResponse(
        sessionId=record["session_id"],
        headTurnDirection=record["assigned_head_turn_direction"],
        status=record["status"],
        createdAt=record["created_at"],
        completedAt=record["completed_at"],
        headTurnOutcome=record.get("head_turn_outcome"),
        lightChallengeOutcome=record.get("light_challenge_outcome"),
    )


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
    return _to_detail_response(record)


@router.post("/{session_id}/result", response_model=SessionDetailResponse)
def submit_result(session_id: str, payload: ResultSubmitRequest) -> SessionDetailResponse:
    result = models.submit_result(
        session_id,
        payload.outcome,
        payload.headTurnOutcome,
        payload.lightChallengeOutcome,
    )
    if result == models.RESULT_SESSION_NOT_FOUND:
        raise HTTPException(status_code=404, detail="Session not found")
    if result == models.RESULT_SESSION_ALREADY_COMPLETED:
        raise HTTPException(
            status_code=409,
            detail="Session has already been finalized and cannot be modified",
        )
    return _to_detail_response(result)
