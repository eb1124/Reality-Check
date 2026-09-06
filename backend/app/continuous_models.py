"""
Continuous-session (Phase 7) data access. Deliberately a separate model
from the Phase 1/2 one-shot `sessions` table (see app/models.py) rather
than an extension of it — a continuous session runs zero or more
challenges of possibly different types over an open-ended duration, which
doesn't fit the one-shot table's "one assigned direction, one verdict"
shape. This is a documented deviation from the original Phase 7 brief's
"extend the existing session model" instruction; see the Phase 7 final
report for the full reasoning. The existing one-shot session code
(app/models.py, app/routes.py) is untouched by any of this.

Lifecycle: CREATED -> ACTIVE -> ENDED | CANCELLED | ERROR. The last three
are terminal and irreversible — every write function below re-checks the
session's current state before mutating anything (the backend half of the
existing teardown-race protection; see useVerificationOrchestrator.js's
orchPhaseRef check for the frontend half).
"""
import json
import secrets
from datetime import datetime, timezone
from typing import Optional

from .config import get_config, get_fusion_config
from .continuous_types import CHALLENGE_TYPES, GROUND_TRUTH_LABELS, TERMINAL_SESSION_STATES
from .database import get_connection
from .fusion import apply_fusion_adjustment, compute_fusion
from .risk import compute_risk

STATE_CREATED = "CREATED"
STATE_ACTIVE = "ACTIVE"
STATE_ENDED = "ENDED"
STATE_CANCELLED = "CANCELLED"
STATE_ERROR = "ERROR"

CHALLENGE_STATUS_PENDING = "PENDING"
CHALLENGE_STATUS_PASSED = "PASSED"
CHALLENGE_STATUS_FAILED = "FAILED"
CHALLENGE_STATUS_TIMEOUT = "TIMEOUT"
CHALLENGE_STATUS_ABORTED = "ABORTED"

# Sentinels returned by write functions on failure, mirroring the plain-
# string style already used by app/models.py's submit_result() rather than
# introducing custom exception types.
NOT_FOUND = "NOT_FOUND"
INVALID_TRANSITION = "INVALID_TRANSITION"
TERMINAL = "TERMINAL"
NONCE_MISMATCH = "NONCE_MISMATCH"
CHALLENGE_NOT_FOUND = "CHALLENGE_NOT_FOUND"
CHALLENGE_NOT_PENDING = "CHALLENGE_NOT_PENDING"

_END_EVENT_TYPE_BY_REASON = {
    STATE_ENDED: "session_ended",
    STATE_CANCELLED: "session_cancelled",
    STATE_ERROR: "session_error",
}

_RESULT_EVENT_TYPE_BY_OUTCOME = {
    CHALLENGE_STATUS_PASSED: "challenge_passed",
    CHALLENGE_STATUS_FAILED: "challenge_failed",
    CHALLENGE_STATUS_TIMEOUT: "challenge_timeout",
    CHALLENGE_STATUS_ABORTED: "challenge_aborted",
}

_RESULT_SEVERITY_BY_OUTCOME = {
    CHALLENGE_STATUS_PASSED: "info",
    CHALLENGE_STATUS_FAILED: "suspicious",
    CHALLENGE_STATUS_TIMEOUT: "suspicious",
    CHALLENGE_STATUS_ABORTED: "warning",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _insert_event(conn, session_id, event_type, severity, client_offset_ms, metadata, server_timestamp=None):
    conn.execute(
        """
        INSERT INTO session_events
            (continuous_session_id, event_type, severity, server_timestamp, client_offset_ms, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            event_type,
            severity,
            server_timestamp or _now_iso(),
            client_offset_ms,
            json.dumps(metadata) if metadata is not None else None,
        ),
    )


def create_continuous_session(external_ref: Optional[str] = None, disable_light_challenge: bool = False) -> dict:
    """
    disable_light_challenge: the candidate's own photosensitivity
    disclosure at the consent gate (see ContinuousConsentGate.jsx) — never
    inferred or defaulted server-side. True permanently excludes LIGHT from
    this session's drawn challenge pool (see request_next_challenge below);
    it does not change scoring/fusion, which already degrades cleanly to
    Head-Turn-only whenever no LIGHT challenge ran (app/fusion.py).
    """
    session_id = secrets.token_urlsafe(32)
    created_at = _now_iso()
    env = get_config()["env"]
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO continuous_sessions
                (id, state, env, created_at, started_at, ended_at, risk_score, risk_state, risk_escalated, external_ref, light_disabled)
            VALUES (?, ?, ?, ?, NULL, NULL, 0, NULL, 0, ?, ?)
            """,
            (session_id, STATE_CREATED, env, created_at, external_ref, 1 if disable_light_challenge else 0),
        )
        conn.commit()
    finally:
        conn.close()
    return get_continuous_session(session_id)


def get_continuous_session(session_id: str) -> Optional[dict]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM continuous_sessions WHERE id = ?", (session_id,)).fetchone()
    finally:
        conn.close()
    return dict(row) if row is not None else None


def start_continuous_session(session_id: str):
    conn = get_connection()
    try:
        row = conn.execute("SELECT state FROM continuous_sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return NOT_FOUND
        if row["state"] != STATE_CREATED:
            return INVALID_TRANSITION

        now = _now_iso()
        conn.execute(
            "UPDATE continuous_sessions SET state = ?, started_at = ? WHERE id = ?",
            (STATE_ACTIVE, now, session_id),
        )
        _insert_event(conn, session_id, "session_started", "info", None, None, now)
        _insert_event(conn, session_id, "monitoring_started", "info", None, None, now)
        conn.commit()
    finally:
        conn.close()
    return get_continuous_session(session_id)


def append_events(session_id: str, events: list):
    """
    All-or-nothing: if the session isn't ACTIVE, nothing is inserted (the
    terminal-state guard — a second/late batch after the session ended
    must not mutate stored state).
    """
    conn = get_connection()
    try:
        row = conn.execute("SELECT state FROM continuous_sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return NOT_FOUND
        if row["state"] != STATE_ACTIVE:
            return TERMINAL

        now = _now_iso()
        for ev in events:
            _insert_event(
                conn, session_id, ev["eventType"], ev["severity"],
                ev.get("clientOffsetMs"), ev.get("metadata"), now,
            )
        conn.commit()
    finally:
        conn.close()
    return {"accepted": len(events)}


def request_next_challenge(session_id: str, trigger: str = "RANDOM"):
    config = get_config()
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT state, light_disabled FROM continuous_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return NOT_FOUND
        if row["state"] != STATE_ACTIVE:
            return TERMINAL

        issued_count = conn.execute(
            "SELECT COUNT(*) AS n FROM session_challenges WHERE continuous_session_id = ?",
            (session_id,),
        ).fetchone()["n"]
        if issued_count >= config["maxChallengesPerSession"]:
            return {"none": True, "retryAfterMs": None, "reason": "MAX_CHALLENGES_REACHED"}

        # At most one challenge in flight at a time — server-enforced, mirrors
        # the frontend scheduler's own single-flight invariant (§8).
        in_flight = conn.execute(
            "SELECT 1 FROM session_challenges WHERE continuous_session_id = ? AND status = ? LIMIT 1",
            (session_id, CHALLENGE_STATUS_PENDING),
        ).fetchone()
        if in_flight:
            return {"none": True, "retryAfterMs": 1000, "reason": "CHALLENGE_IN_FLIGHT"}

        last = conn.execute(
            """
            SELECT requested_at FROM session_challenges
            WHERE continuous_session_id = ?
            ORDER BY requested_at DESC LIMIT 1
            """,
            (session_id,),
        ).fetchone()
        cooldown_ms = (
            config["eventTriggeredChallengeCooldownMs"] if trigger == "EVENT" else config["challengeCooldownMs"]
        )
        now_dt = _now()
        if last is not None:
            elapsed_ms = (now_dt - datetime.fromisoformat(last["requested_at"])).total_seconds() * 1000
            if elapsed_ms < cooldown_ms:
                return {"none": True, "retryAfterMs": int(cooldown_ms - elapsed_ms), "reason": "COOLDOWN"}

        # Server picks the type — secrets.choice, not random, so it can't be
        # predicted or influenced by the client (same rationale as the
        # existing one-shot session's direction assignment). LIGHT is
        # excluded from the pool entirely for a session whose candidate
        # disclosed photosensitivity at the consent gate (light_disabled) —
        # this is a candidate-safety accommodation, not a scoring decision,
        # so it happens at the draw itself rather than being handled as
        # every LIGHT attempt auto-failing/aborting.
        available_types = (
            tuple(t for t in CHALLENGE_TYPES if t != "LIGHT") if row["light_disabled"] else CHALLENGE_TYPES
        )
        challenge_type = secrets.choice(available_types)
        challenge_id = secrets.token_urlsafe(24)
        nonce = secrets.token_urlsafe(24)
        requested_at = now_dt.isoformat()
        expires_at = (now_dt.timestamp() + config["challengeTimeoutMs"] / 1000)
        expires_at_iso = datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat()

        conn.execute(
            """
            INSERT INTO session_challenges
                (id, continuous_session_id, challenge_type, trigger, nonce, status, requested_at, expires_at, resolved_at, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
            """,
            (challenge_id, session_id, challenge_type, trigger, nonce, CHALLENGE_STATUS_PENDING, requested_at, expires_at_iso),
        )
        _insert_event(
            conn, session_id, "challenge_requested", "info", None,
            {"challengeType": challenge_type, "trigger": trigger}, requested_at,
        )
        conn.commit()
    finally:
        conn.close()

    return {"challengeId": challenge_id, "type": challenge_type, "nonce": nonce, "expiresAt": expires_at_iso}


def submit_challenge_result(session_id: str, challenge_id: str, nonce: str, outcome: str, detail: Optional[dict]):
    """
    outcome: one of PASSED/FAILED/TIMEOUT/ABORTED (validated by the schema
    layer against continuous_types.CHALLENGE_CLIENT_OUTCOMES). Records the
    resolution and its matching session_event (challenge_passed/failed/
    timeout/aborted) in the same transaction, so the event stream the risk
    function reads is never out of sync with the challenge table.
    """
    conn = get_connection()
    try:
        session_row = conn.execute("SELECT state FROM continuous_sessions WHERE id = ?", (session_id,)).fetchone()
        if session_row is None:
            return NOT_FOUND
        if session_row["state"] != STATE_ACTIVE:
            return TERMINAL

        challenge_row = conn.execute(
            "SELECT * FROM session_challenges WHERE id = ? AND continuous_session_id = ?",
            (challenge_id, session_id),
        ).fetchone()
        if challenge_row is None:
            return CHALLENGE_NOT_FOUND
        if challenge_row["status"] != CHALLENGE_STATUS_PENDING:
            return CHALLENGE_NOT_PENDING
        if challenge_row["nonce"] != nonce:
            return NONCE_MISMATCH

        now_dt = _now()
        expires_dt = datetime.fromisoformat(challenge_row["expires_at"])
        # A late PASS/FAIL arriving after the challenge's own expiry doesn't
        # get to count as anything but a timeout server-side.
        effective_outcome = CHALLENGE_STATUS_TIMEOUT if now_dt > expires_dt else outcome

        now_iso = now_dt.isoformat()
        conn.execute(
            "UPDATE session_challenges SET status = ?, resolved_at = ?, detail = ? WHERE id = ?",
            (effective_outcome, now_iso, json.dumps(detail) if detail is not None else None, challenge_id),
        )
        _insert_event(
            conn, session_id,
            _RESULT_EVENT_TYPE_BY_OUTCOME[effective_outcome],
            _RESULT_SEVERITY_BY_OUTCOME[effective_outcome],
            None,
            {"challengeId": challenge_id, "challengeType": challenge_row["challenge_type"]},
            now_iso,
        )
        conn.commit()

        return {
            "challengeId": challenge_id,
            "status": effective_outcome,
            "resolvedAt": now_iso,
        }
    finally:
        conn.close()


def _compute_face_absent_ms(conn, session_id: str, ended_at_iso: str) -> float:
    rows = conn.execute(
        """
        SELECT event_type, server_timestamp FROM session_events
        WHERE continuous_session_id = ? AND event_type IN ('face_missing', 'face_restored')
        ORDER BY id ASC
        """,
        (session_id,),
    ).fetchall()

    total_ms = 0.0
    missing_since = None
    for r in rows:
        ts = datetime.fromisoformat(r["server_timestamp"])
        if r["event_type"] == "face_missing" and missing_since is None:
            missing_since = ts
        elif r["event_type"] == "face_restored" and missing_since is not None:
            total_ms += (ts - missing_since).total_seconds() * 1000
            missing_since = None
    if missing_since is not None:
        total_ms += (datetime.fromisoformat(ended_at_iso) - missing_since).total_seconds() * 1000
    return total_ms


def _load_challenges_for_fusion(conn, session_id: str) -> list:
    rows = conn.execute(
        "SELECT challenge_type, status, detail FROM session_challenges WHERE continuous_session_id = ? ORDER BY requested_at ASC",
        (session_id,),
    ).fetchall()
    return [
        {
            "challenge_type": r["challenge_type"],
            "status": r["status"],
            "detail": json.loads(r["detail"]) if r["detail"] else None,
        }
        for r in rows
    ]


def end_continuous_session(session_id: str, reason: str = STATE_ENDED):
    """
    reason: ENDED, CANCELLED, or ERROR — all three terminal states are
    finalized through this one function (§8 treats ending and cancelling
    as the same kind of teardown operation). Computes the deterministic
    risk result (risk.compute_risk, unmodified by Phase 11), then applies
    the Phase 11 validity-scaled Head-Turn/Light fusion adjustment
    (fusion.apply_fusion_adjustment) on top of it before storing the final
    risk_state/risk_escalated — see app/fusion.py for why this is a
    separate pass rather than a change to compute_risk itself.
    """
    if reason not in TERMINAL_SESSION_STATES:
        return INVALID_TRANSITION

    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM continuous_sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return NOT_FOUND
        if row["state"] in TERMINAL_SESSION_STATES:
            return TERMINAL

        now_dt = _now()
        now_iso = now_dt.isoformat()

        event_rows = conn.execute(
            "SELECT event_type, severity FROM session_events WHERE continuous_session_id = ? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
        events = [dict(e) for e in event_rows]

        completed_challenges = conn.execute(
            "SELECT COUNT(*) AS n FROM session_challenges WHERE continuous_session_id = ? AND status != ?",
            (session_id, CHALLENGE_STATUS_PENDING),
        ).fetchone()["n"]

        technical_error_count = sum(1 for e in events if e["event_type"] == "technical_error")

        session_duration_ms = 0.0
        if row["started_at"]:
            session_duration_ms = (now_dt - datetime.fromisoformat(row["started_at"])).total_seconds() * 1000

        face_absent_ms = _compute_face_absent_ms(conn, session_id, now_iso)

        risk = compute_risk(
            events=events,
            completed_challenges=completed_challenges,
            session_duration_ms=session_duration_ms,
            face_absent_ms=face_absent_ms,
            technical_error_count=technical_error_count,
        )

        challenges_for_fusion = _load_challenges_for_fusion(conn, session_id)
        fusion_config = get_fusion_config()
        fusion = compute_fusion(challenges_for_fusion, fusion_config)
        final_risk, adjustment = apply_fusion_adjustment(risk, fusion, fusion_config)

        conn.execute(
            """
            UPDATE continuous_sessions
            SET state = ?, ended_at = ?, risk_score = ?, risk_state = ?, risk_escalated = ?
            WHERE id = ?
            """,
            (reason, now_iso, final_risk["score"], final_risk["state"], 1 if final_risk["escalated"] else 0, session_id),
        )
        _insert_event(conn, session_id, _END_EVENT_TYPE_BY_REASON[reason], "info", None, None, now_iso)
        _insert_event(conn, session_id, "monitoring_stopped", "info", None, None, now_iso)
        conn.commit()
    finally:
        conn.close()

    return build_report(session_id)


INVALID_LABEL = "INVALID_LABEL"
NOT_TERMINAL = "NOT_TERMINAL"


def set_ground_truth_label(session_id: str, label: str):
    """
    Engineering/research-only: attaches a ground-truth label to an
    already-ended session for later calibration-dataset comparison (Phase
    11 Step 15). Never called by the production candidate-facing flow —
    see continuous_routes.py's docstring on the endpoint that calls this.
    Deliberately allowed on any terminal state (not just ENDED): a
    CANCELLED or ERROR session can still be a useful labeled data point
    (e.g. "candidate disconnected" is itself sometimes worth recording),
    and re-labeling is allowed (a researcher correcting a mistaken label)
    rather than one-shot-only like the verdict-finalizing writes above.
    """
    if label not in GROUND_TRUTH_LABELS:
        return INVALID_LABEL

    conn = get_connection()
    try:
        row = conn.execute("SELECT state FROM continuous_sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return NOT_FOUND
        if row["state"] not in TERMINAL_SESSION_STATES:
            return NOT_TERMINAL

        conn.execute(
            "UPDATE continuous_sessions SET ground_truth_label = ? WHERE id = ?",
            (label, session_id),
        )
        conn.commit()
    finally:
        conn.close()

    return get_continuous_session(session_id)


def build_report(session_id: str):
    conn = get_connection()
    try:
        session_row = conn.execute("SELECT * FROM continuous_sessions WHERE id = ?", (session_id,)).fetchone()
        if session_row is None:
            return NOT_FOUND
        session = dict(session_row)

        event_rows = conn.execute(
            """
            SELECT event_type, severity, server_timestamp, client_offset_ms
            FROM session_events WHERE continuous_session_id = ? ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()
        challenge_rows = conn.execute(
            """
            SELECT challenge_type, status, detail FROM session_challenges
            WHERE continuous_session_id = ? ORDER BY requested_at ASC
            """,
            (session_id,),
        ).fetchall()
    finally:
        conn.close()

    challenges = [dict(c) for c in challenge_rows]
    requested = len(challenges)
    passed = sum(1 for c in challenges if c["status"] == CHALLENGE_STATUS_PASSED)
    failed = sum(1 for c in challenges if c["status"] in (CHALLENGE_STATUS_FAILED, CHALLENGE_STATUS_TIMEOUT))

    challenges_for_fusion = [
        {**c, "detail": json.loads(c["detail"]) if c["detail"] else None} for c in challenges
    ]
    fusion = compute_fusion(challenges_for_fusion, get_fusion_config())

    # Phase 11 Step 14 — calibration data export. Per-challenge evidence
    # (type, outcome, and whatever score/validity/diagnostics that
    # challenge's own `detail` carries — derived measurements only, never
    # raw video) so an offline tool can later correlate these against a
    # ground-truth label without a second, separate export mechanism.
    challenge_evidence = [
        {
            "type": c["challenge_type"],
            "status": c["status"],
            "lightScore": (c["detail"] or {}).get("lightScore") if c["challenge_type"] == "LIGHT" else None,
            "lightValidity": (c["detail"] or {}).get("lightValidity") if c["challenge_type"] == "LIGHT" else None,
            "diagnostics": (c["detail"] or {}).get("diagnostics") if c["detail"] else None,
        }
        for c in challenges_for_fusion
    ]

    events = [dict(e) for e in event_rows]
    suspicious_event_count = sum(1 for e in events if e["severity"] == "suspicious")

    duration_ms = None
    if session["started_at"]:
        end_ref = session["ended_at"] or _now_iso()
        duration_ms = (
            datetime.fromisoformat(end_ref) - datetime.fromisoformat(session["started_at"])
        ).total_seconds() * 1000

    return {
        "sessionId": session["id"],
        "state": session["state"],
        "durationMs": duration_ms,
        "riskState": session["risk_state"],
        "riskScore": session["risk_score"],
        "riskEscalated": bool(session["risk_escalated"]),
        "challenges": {"requested": requested, "passed": passed, "failed": failed},
        "suspiciousEventCount": suspicious_event_count,
        "externalRef": session["external_ref"],
        "fusion": fusion,
        "challengeEvidence": challenge_evidence,
        "groundTruthLabel": session.get("ground_truth_label"),
        "timeline": [
            {
                "eventType": e["event_type"],
                "severity": e["severity"],
                "serverTimestamp": e["server_timestamp"],
                "clientOffsetMs": e["client_offset_ms"],
            }
            for e in events
        ],
    }
