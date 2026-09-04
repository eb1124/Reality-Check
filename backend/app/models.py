"""
Session data access. Create, read, and one write: finalizing a session with
a client-reported verdict (submit_result). Still no update of the session's
identity/direction and no delete.

Session ID and challenge direction are always generated here, server-side,
using `secrets` (not `random`) so they cannot be predicted or influenced by
a client. Nothing in this module ever accepts a caller-supplied direction.
"""
import secrets
from datetime import datetime, timezone
from typing import Optional

from .database import get_connection

VALID_DIRECTIONS = ("LEFT", "RIGHT")
STATUS_PENDING = "PENDING"

# Terminal statuses a session can be finalized into via submit_result().
# Deliberately reuse the exact vocabulary the frontend orchestrator already
# uses for its client-side verdict (useVerificationOrchestrator.js's
# VERIFICATION_VERDICT) rather than inventing a second, parallel naming
# scheme for the same two outcomes.
STATUS_VERIFIED = "VERIFIED"
STATUS_INCOMPLETE_RETRY = "INCOMPLETE_RETRY"
VALID_RESULT_STATUSES = (STATUS_VERIFIED, STATUS_INCOMPLETE_RETRY)

# submit_result() sentinels — kept as plain strings (matching this module's
# existing minimal style) rather than custom exception types, since the
# route layer only needs to branch on which HTTP error to raise.
RESULT_SESSION_NOT_FOUND = "NOT_FOUND"
RESULT_SESSION_ALREADY_COMPLETED = "ALREADY_COMPLETED"


def generate_session_id() -> str:
    # 32 random bytes, URL-safe encoded — opaque, unguessable, cryptographically strong.
    return secrets.token_urlsafe(32)


def assign_direction() -> str:
    return secrets.choice(VALID_DIRECTIONS)


def create_session() -> dict:
    session_id = generate_session_id()
    direction = assign_direction()
    created_at = datetime.now(timezone.utc).isoformat()

    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO sessions
                (session_id, assigned_head_turn_direction, status, created_at, completed_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, direction, STATUS_PENDING, created_at, None),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "session_id": session_id,
        "assigned_head_turn_direction": direction,
        "status": STATUS_PENDING,
        "created_at": created_at,
        "completed_at": None,
    }


def get_session(session_id: str) -> Optional[dict]:
    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT session_id, assigned_head_turn_direction, status, created_at,
                   completed_at, head_turn_outcome, light_challenge_outcome
            FROM sessions
            WHERE session_id = ?
            """,
            (session_id,),
        ).fetchone()
    finally:
        conn.close()

    return dict(row) if row is not None else None


def submit_result(
    session_id: str,
    outcome: str,
    head_turn_outcome: Optional[str],
    light_challenge_outcome: Optional[str],
) -> dict | str | None:
    """
    Finalizes a session with the client-reported verification verdict.

    This does NOT independently re-verify the client's challenge measurements
    (see backend/README.md's trust-boundary note) — it records what the
    browser reported, the same trust model POST /sessions already has for
    everything except session identity and direction assignment. What IS
    authoritative here: a session can only be finalized once. A session
    already in a terminal status cannot be silently overwritten by a second,
    possibly conflicting, submission.

    Returns the updated session dict on success, RESULT_SESSION_NOT_FOUND if
    no such session exists, or RESULT_SESSION_ALREADY_COMPLETED if the
    session is no longer PENDING.
    """
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT status FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return RESULT_SESSION_NOT_FOUND
        if row["status"] != STATUS_PENDING:
            return RESULT_SESSION_ALREADY_COMPLETED

        completed_at = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """
            UPDATE sessions
            SET status = ?, head_turn_outcome = ?, light_challenge_outcome = ?, completed_at = ?
            WHERE session_id = ?
            """,
            (outcome, head_turn_outcome, light_challenge_outcome, completed_at, session_id),
        )
        conn.commit()
    finally:
        conn.close()

    return get_session(session_id)
