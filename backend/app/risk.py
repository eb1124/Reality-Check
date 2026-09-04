"""
Deterministic Phase 7 risk model. One pure function, no ML, no percentages,
no "DEEPFAKE DETECTED" — a categorical state plus the integer score that
produced it, so the derivation is always inspectable.

Score starts at 0. Walking the session's events in chronological order:
  - a challenge_failed or challenge_timeout event: +2
  - any OTHER event with severity == "suspicious": +1
    (challenge_failed/challenge_timeout are scored by the rule above only —
    even though their own severity is "suspicious", they are not also
    counted under this second rule; that would double-count the same
    underlying signal)
  - a challenge_passed event whose immediately preceding scored event was
    either severity == "suspicious" or a challenge_failed/challenge_timeout:
    -1, floored at 0 (a clean recovery partially offsets recent suspicion)
  - technical_error events never change the score; they're counted
    separately and only ever affect the INCONCLUSIVE check below

INCONCLUSIVE overrides the score-based state entirely when the evidence is
too thin to judge:
  - zero completed challenges (no challenge ever reached PASSED, FAILED,
    TIMEOUT, or ABORTED — i.e. no challenge data exists at all), OR
  - the face/camera was absent for more than 40% of session duration, OR
  - more than 3 technical_error events occurred.
INCONCLUSIVE means "we cannot say", not "high risk" — callers must not
treat it as a risk tier when rendering it.

Otherwise: score 0-1 -> LOW_RISK; score 2-4 -> REVIEW_RECOMMENDED;
score >= 5 -> REVIEW_RECOMMENDED with escalated=True.
"""

FAILURE_EVENT_TYPES = ("challenge_failed", "challenge_timeout")

LOW_RISK = "LOW_RISK"
REVIEW_RECOMMENDED = "REVIEW_RECOMMENDED"
INCONCLUSIVE = "INCONCLUSIVE"

INCONCLUSIVE_NO_COMPLETED_CHALLENGES = "no_completed_challenges"
INCONCLUSIVE_FACE_ABSENT = "face_absent_over_40_percent"
INCONCLUSIVE_TECHNICAL_ERRORS = "excessive_technical_errors"


def compute_risk(
    events: list,
    completed_challenges: int,
    session_duration_ms: float,
    face_absent_ms: float,
    technical_error_count: int,
) -> dict:
    """
    events: chronologically ordered list of {"event_type": str, "severity": str}.
    Returns {"score": int, "state": str, "escalated": bool, "inconclusiveReason": str|None}.
    """
    score = 0
    previous_was_suspicious = False

    for event in events:
        event_type = event.get("event_type")
        severity = event.get("severity")

        is_failure = event_type in FAILURE_EVENT_TYPES
        is_other_suspicious = severity == "suspicious" and not is_failure

        if is_failure:
            score += 2
            previous_was_suspicious = True
        elif is_other_suspicious:
            score += 1
            previous_was_suspicious = True
        elif event_type == "challenge_passed":
            if previous_was_suspicious:
                score = max(0, score - 1)
            previous_was_suspicious = False
        else:
            previous_was_suspicious = False

    absent_ratio = (
        face_absent_ms / session_duration_ms if session_duration_ms > 0 else 1.0
    )

    inconclusive_reason = None
    if completed_challenges == 0:
        inconclusive_reason = INCONCLUSIVE_NO_COMPLETED_CHALLENGES
    elif absent_ratio > 0.4:
        inconclusive_reason = INCONCLUSIVE_FACE_ABSENT
    elif technical_error_count > 3:
        inconclusive_reason = INCONCLUSIVE_TECHNICAL_ERRORS

    if inconclusive_reason is not None:
        return {
            "score": score,
            "state": INCONCLUSIVE,
            "escalated": False,
            "inconclusiveReason": inconclusive_reason,
        }

    if score <= 1:
        return {"score": score, "state": LOW_RISK, "escalated": False, "inconclusiveReason": None}
    if score <= 4:
        return {"score": score, "state": REVIEW_RECOMMENDED, "escalated": False, "inconclusiveReason": None}
    return {"score": score, "state": REVIEW_RECOMMENDED, "escalated": True, "inconclusiveReason": None}
