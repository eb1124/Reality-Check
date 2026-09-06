"""
Phase 7 continuous-session endpoints, under /sessions/continuous/... —
matching the existing app's route convention (routes.py's un-prefixed
/sessions/...) rather than the originally-proposed /api/rc/ namespace; see
the Phase 7 final report's Deviations section for why. Kept as their own
APIRouter/module (continuous_models.py backing it) rather than folding into
routes.py, since they operate on a structurally different model.
"""
from fastapi import APIRouter, Body, HTTPException

from . import continuous_models as models
from .continuous_schemas import (
    ChallengeResultRequest,
    ContinuousSessionResponse,
    CreateContinuousSessionRequest,
    EndSessionRequest,
    EventBatchRequest,
    ReportResponse,
)

router = APIRouter(prefix="/sessions/continuous", tags=["continuous-sessions"])


def _to_response(record: dict) -> ContinuousSessionResponse:
    return ContinuousSessionResponse(
        sessionId=record["id"],
        state=record["state"],
        env=record["env"],
        createdAt=record["created_at"],
        startedAt=record["started_at"],
        endedAt=record["ended_at"],
        riskScore=record["risk_score"],
        riskState=record["risk_state"],
        riskEscalated=bool(record["risk_escalated"]),
        externalRef=record["external_ref"],
    )


@router.post("", response_model=ContinuousSessionResponse, status_code=201)
def create_continuous_session(
    payload: CreateContinuousSessionRequest = Body(default_factory=CreateContinuousSessionRequest),
) -> ContinuousSessionResponse:
    return _to_response(models.create_continuous_session(payload.externalRef))


@router.post("/{session_id}/start", response_model=ContinuousSessionResponse)
def start_continuous_session(session_id: str) -> ContinuousSessionResponse:
    result = models.start_continuous_session(session_id)
    if result == models.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Session not found")
    if result == models.INVALID_TRANSITION:
        raise HTTPException(status_code=409, detail="Session cannot be started from its current state")
    return _to_response(result)


@router.post("/{session_id}/events")
def submit_events(session_id: str, payload: EventBatchRequest) -> dict:
    result = models.append_events(session_id, [e.model_dump() for e in payload.events])
    if result == models.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Session not found")
    if result == models.TERMINAL:
        raise HTTPException(status_code=409, detail="Session is not ACTIVE; events are not accepted")
    return result


@router.get("/{session_id}/next-challenge")
def get_next_challenge(session_id: str, trigger: str = "RANDOM") -> dict:
    if trigger not in ("RANDOM", "EVENT"):
        raise HTTPException(status_code=422, detail="trigger must be RANDOM or EVENT")
    result = models.request_next_challenge(session_id, trigger)
    if result == models.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Session not found")
    if result == models.TERMINAL:
        raise HTTPException(status_code=409, detail="Session is not ACTIVE")
    return result


@router.post("/{session_id}/challenges/{challenge_id}/result")
def submit_challenge_result(session_id: str, challenge_id: str, payload: ChallengeResultRequest) -> dict:
    result = models.submit_challenge_result(session_id, challenge_id, payload.nonce, payload.outcome, payload.detail)
    if result == models.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Session not found")
    if result == models.TERMINAL:
        raise HTTPException(status_code=409, detail="Session is not ACTIVE")
    if result == models.CHALLENGE_NOT_FOUND:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if result == models.CHALLENGE_NOT_PENDING:
        raise HTTPException(status_code=409, detail="Challenge has already been resolved")
    if result == models.NONCE_MISMATCH:
        raise HTTPException(status_code=403, detail="Nonce does not match the issued challenge")
    return result


@router.post("/{session_id}/end", response_model=ReportResponse)
def end_session(
    session_id: str,
    payload: EndSessionRequest = Body(default_factory=EndSessionRequest),
) -> ReportResponse:
    result = models.end_continuous_session(session_id, payload.reason)
    if result == models.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Session not found")
    if result == models.TERMINAL:
        raise HTTPException(status_code=409, detail="Session has already ended")
    if result == models.INVALID_TRANSITION:
        raise HTTPException(status_code=422, detail="Invalid end reason")
    return result


@router.get("/{session_id}/report", response_model=ReportResponse)
def get_report(session_id: str) -> ReportResponse:
    result = models.build_report(session_id)
    if result == models.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Session not found")
    return result
