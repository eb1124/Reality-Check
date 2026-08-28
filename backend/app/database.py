"""
SQLite connection and schema setup for the Reality Check verification backend.

Deliberately minimal: no ORM, one table, a fresh sqlite3 connection per
operation (safe under FastAPI's threadpool-executed sync route handlers,
since each thread gets its own connection object — no shared mutable state).

The database file location is the one piece of "configuration" Phase 1
needs; it's read fresh from the environment on every call (not cached at
import time) so tests can point it at an isolated temp file per test run.
"""
import os
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "verification.db"
ENV_VAR = "REALITY_CHECK_DB_PATH"


def get_db_path() -> Path:
    override = os.environ.get(ENV_VAR)
    return Path(override) if override else DEFAULT_DB_PATH


def get_connection() -> sqlite3.Connection:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                assigned_head_turn_direction TEXT NOT NULL
                    CHECK (assigned_head_turn_direction IN ('LEFT', 'RIGHT')),
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                completed_at TEXT
            )
            """
        )
        conn.commit()
    finally:
        conn.close()
