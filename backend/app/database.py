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
                completed_at TEXT,
                head_turn_outcome TEXT,
                light_challenge_outcome TEXT
            )
            """
        )
        # Migration for databases created before the two result-evidence
        # columns existed (Phase 2). SQLite has no "ADD COLUMN IF NOT
        # EXISTS", so existing columns are checked via PRAGMA first — this
        # must stay a no-op on a table that already has them, and must
        # never touch/reorder/drop existing rows or columns.
        existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(sessions)")}
        if "head_turn_outcome" not in existing_columns:
            conn.execute("ALTER TABLE sessions ADD COLUMN head_turn_outcome TEXT")
        if "light_challenge_outcome" not in existing_columns:
            conn.execute("ALTER TABLE sessions ADD COLUMN light_challenge_outcome TEXT")

        # Phase 7: continuous-session tables. Deliberately new tables, not an
        # extension of `sessions` above (see continuous_models.py's module
        # docstring for why) — so this is purely additive and never touches
        # the sessions table or its existing rows. Every existing `sessions`
        # row is entirely outside this new state machine and needs no
        # migration of its own; CREATE TABLE IF NOT EXISTS is itself the
        # complete, idempotent migration for these three tables.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS continuous_sessions (
                id TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                env TEXT NOT NULL,
                created_at TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                risk_score INTEGER NOT NULL DEFAULT 0,
                risk_state TEXT,
                risk_escalated INTEGER NOT NULL DEFAULT 0,
                external_ref TEXT
            )
            """
        )
        # Phase 9: optional external-consumer correlation id (e.g. an
        # assessmentAttemptId from an embedding OA), added after the table
        # above already existed for early Phase 7 databases — same
        # PRAGMA-then-ALTER migration style as the `sessions` table's own
        # post-hoc columns further up this file.
        existing_continuous_columns = {row["name"] for row in conn.execute("PRAGMA table_info(continuous_sessions)")}
        if "external_ref" not in existing_continuous_columns:
            conn.execute("ALTER TABLE continuous_sessions ADD COLUMN external_ref TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS session_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                continuous_session_id TEXT NOT NULL REFERENCES continuous_sessions(id),
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                server_timestamp TEXT NOT NULL,
                client_offset_ms INTEGER,
                metadata TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS session_challenges (
                id TEXT PRIMARY KEY,
                continuous_session_id TEXT NOT NULL REFERENCES continuous_sessions(id),
                challenge_type TEXT NOT NULL,
                trigger TEXT NOT NULL,
                nonce TEXT NOT NULL,
                status TEXT NOT NULL,
                requested_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                resolved_at TEXT,
                detail TEXT
            )
            """
        )
        conn.commit()
    finally:
        conn.close()
