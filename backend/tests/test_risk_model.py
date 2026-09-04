"""
Boundary tests for the deterministic Phase 7 risk model (app/risk.py). Pure
function, no DB, no server — every case here is a direct call.
"""
from app.risk import compute_risk


def _events(*type_severity_pairs):
    return [{"event_type": t, "severity": s} for t, s in type_severity_pairs]


def test_no_events_with_completed_challenge_is_low_risk():
    result = compute_risk(
        events=[],
        completed_challenges=1,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=0,
    )
    assert result == {"score": 0, "state": "LOW_RISK", "escalated": False, "inconclusiveReason": None}


def test_single_suspicious_event_stays_low_risk_boundary():
    # score 1 -> still LOW_RISK (0-1 boundary)
    result = compute_risk(
        events=_events(("landmark_discontinuity", "suspicious")),
        completed_challenges=1,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=0,
    )
    assert result["score"] == 1
    assert result["state"] == "LOW_RISK"


def test_two_suspicious_events_crosses_into_review_recommended():
    # score 2 -> REVIEW_RECOMMENDED (2-4 boundary)
    result = compute_risk(
        events=_events(
            ("landmark_discontinuity", "suspicious"),
            ("frozen_frame_suspected", "suspicious"),
        ),
        completed_challenges=1,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=0,
    )
    assert result["score"] == 2
    assert result["state"] == "REVIEW_RECOMMENDED"
    assert result["escalated"] is False


def test_score_four_is_review_recommended_not_escalated():
    result = compute_risk(
        events=_events(
            ("challenge_failed", "suspicious"),
            ("challenge_failed", "suspicious"),
        ),
        completed_challenges=2,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=0,
    )
    assert result["score"] == 4
    assert result["state"] == "REVIEW_RECOMMENDED"
    assert result["escalated"] is False


def test_score_five_escalates():
    result = compute_risk(
        events=_events(
            ("challenge_failed", "suspicious"),
            ("challenge_failed", "suspicious"),
            ("landmark_discontinuity", "suspicious"),
        ),
        completed_challenges=2,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=0,
    )
    assert result["score"] == 5
    assert result["state"] == "REVIEW_RECOMMENDED"
    assert result["escalated"] is True


def test_challenge_failed_is_not_double_counted_as_generic_suspicious():
    # A single challenge_failed event must score +2 only, not +2 then +1
    # again for also carrying severity="suspicious".
    result = compute_risk(
        events=_events(("challenge_failed", "suspicious")),
        completed_challenges=1,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=0,
    )
    assert result["score"] == 2


def test_challenge_passed_after_suspicious_event_reduces_score_floored_at_zero():
    result = compute_risk(
        events=_events(
            ("landmark_discontinuity", "suspicious"),  # +1 -> 1
            ("challenge_passed", "info"),               # -1 -> 0 (recovery)
        ),
        completed_challenges=1,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=0,
    )
    assert result["score"] == 0
    assert result["state"] == "LOW_RISK"


def test_challenge_passed_not_following_suspicion_does_not_reduce_score():
    result = compute_risk(
        events=_events(
            ("landmark_discontinuity", "suspicious"),  # +1 -> 1
            ("face_restored", "info"),                  # neutral, breaks the "immediately following" chain
            ("challenge_passed", "info"),               # no reduction
        ),
        completed_challenges=1,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=0,
    )
    assert result["score"] == 1


def test_technical_error_does_not_change_score():
    result = compute_risk(
        events=_events(("technical_error", "error")),
        completed_challenges=1,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=1,
    )
    assert result["score"] == 0
    assert result["state"] == "LOW_RISK"


def test_zero_completed_challenges_is_inconclusive_even_with_zero_score():
    result = compute_risk(
        events=[],
        completed_challenges=0,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=0,
    )
    assert result["state"] == "INCONCLUSIVE"
    assert result["inconclusiveReason"] == "no_completed_challenges"


def test_face_absent_over_forty_percent_is_inconclusive():
    result = compute_risk(
        events=[],
        completed_challenges=1,
        session_duration_ms=100_000,
        face_absent_ms=41_000,
        technical_error_count=0,
    )
    assert result["state"] == "INCONCLUSIVE"
    assert result["inconclusiveReason"] == "face_absent_over_40_percent"


def test_face_absent_exactly_forty_percent_is_not_inconclusive():
    result = compute_risk(
        events=[],
        completed_challenges=1,
        session_duration_ms=100_000,
        face_absent_ms=40_000,
        technical_error_count=0,
    )
    assert result["state"] != "INCONCLUSIVE"


def test_more_than_three_technical_errors_is_inconclusive():
    result = compute_risk(
        events=[],
        completed_challenges=1,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=4,
    )
    assert result["state"] == "INCONCLUSIVE"
    assert result["inconclusiveReason"] == "excessive_technical_errors"


def test_exactly_three_technical_errors_is_not_inconclusive():
    result = compute_risk(
        events=[],
        completed_challenges=1,
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=3,
    )
    assert result["state"] != "INCONCLUSIVE"


def test_inconclusive_overrides_a_high_score():
    # A session could rack up a high score AND still be inconclusive if
    # evidence is otherwise too thin — inconclusive wins.
    result = compute_risk(
        events=_events(
            ("challenge_failed", "suspicious"),
            ("challenge_failed", "suspicious"),
            ("challenge_failed", "suspicious"),
        ),
        completed_challenges=0,  # no challenge ever *completed* despite failure events
        session_duration_ms=60_000,
        face_absent_ms=0,
        technical_error_count=0,
    )
    assert result["state"] == "INCONCLUSIVE"
    assert result["score"] == 6
