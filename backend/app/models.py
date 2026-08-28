"""
Session data access — Phase 1 scope only: create and read. No update/delete,
no event ingestion, no verdict derivation (those are later phases).

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
            SELECT session_id, assigned_head_turn_direction, status, created_at, completed_at
            FROM sessions
            WHERE session_id = ?
            """,
            (session_id,),
        ).fetchone()
    finally:
        conn.close()

    return dict(row) if row is not None else None
