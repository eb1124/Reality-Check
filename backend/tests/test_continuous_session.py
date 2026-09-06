"""
Integration tests for Phase 7 continuous-session endpoints
(app/continuous_routes.py, app/continuous_models.py).

No real waiting: tests that need to simulate elapsed cooldown time
backdate the stored `requested_at` timestamp directly via SQL (see
`_backdate_last_challenge` below) rather than sleeping. The backend has no
injectable-clock mechanism (that requirement is frontend-scheduler-specific
per the Phase 7 spec §8); direct timestamp manipulation is the backend-side
equivalent for these tests.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app import database


def _create_active(client):
    session = client.post("/sessions/continuous").json()
    client.post(f"/sessions/continuous/{session['sessionId']}/start")
    return session["sessionId"]


def _backdate_last_challenge(session_id: str, ms_ago: float):
    """Pushes the most recently requested challenge's requested_at back in
    time so a subsequent next-challenge call sees the cooldown as elapsed,
    without any real waiting."""
    conn = database.get_connection()
    try:
        new_time = (datetime.now(timezone.utc) - timedelta(milliseconds=ms_ago)).isoformat()
        conn.execute(
            """
            UPDATE session_challenges SET requested_at = ?
            WHERE continuous_session_id = ?
            AND id = (
                SELECT id FROM session_challenges
                WHERE continuous_session_id = ?
                ORDER BY requested_at DESC LIMIT 1
            )
            """,
            (new_time, session_id, session_id),
        )
        conn.commit()
    finally:
        conn.close()


# --- lifecycle -----------------------------------------------------------

def test_create_continuous_session_starts_in_created(client):
    response = client.post("/sessions/continuous")
    assert response.status_code == 201
    body = response.json()
    assert body["state"] == "CREATED"
    assert body["riskScore"] == 0
    assert body["riskState"] is None


def test_start_transitions_created_to_active(client):
    session = client.post("/sessions/continuous").json()
    response = client.post(f"/sessions/continuous/{session['sessionId']}/start")
    assert response.status_code == 200
    assert response.json()["state"] == "ACTIVE"


def test_cannot_start_twice(client):
    session_id = _create_active(client)
    response = client.post(f"/sessions/continuous/{session_id}/start")
    assert response.status_code == 409


def test_start_unknown_session_404(client):
    response = client.post("/sessions/continuous/does-not-exist/start")
    assert response.status_code == 404


def test_session_remains_active_after_a_challenge_passes(client):
    session_id = _create_active(client)
    challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={"nonce": challenge["nonce"], "outcome": "PASSED"},
    )
    session = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert session["state"] == "ACTIVE"


def test_session_remains_active_after_a_challenge_fails(client):
    session_id = _create_active(client)
    challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={"nonce": challenge["nonce"], "outcome": "FAILED"},
    )
    session = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert session["state"] == "ACTIVE"


# --- terminal-state guard (backend half of the stale-async protection) --

def test_events_rejected_after_session_ended(client):
    session_id = _create_active(client)
    client.post(f"/sessions/continuous/{session_id}/end")
    response = client.post(
        f"/sessions/continuous/{session_id}/events",
        json={"events": [{"eventType": "face_missing", "severity": "warning"}]},
    )
    assert response.status_code == 409


def test_events_do_not_mutate_state_when_rejected(client):
    session_id = _create_active(client)
    client.post(f"/sessions/continuous/{session_id}/end")
    before = client.get(f"/sessions/continuous/{session_id}/report").json()
    client.post(
        f"/sessions/continuous/{session_id}/events",
        json={"events": [{"eventType": "face_missing", "severity": "warning"}]},
    )
    after = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert before == after


def test_next_challenge_rejected_after_session_ended(client):
    session_id = _create_active(client)
    client.post(f"/sessions/continuous/{session_id}/end")
    response = client.get(f"/sessions/continuous/{session_id}/next-challenge")
    assert response.status_code == 409


def test_no_challenge_issued_after_end(client):
    session_id = _create_active(client)
    # issue and resolve one challenge so the session has real evidence
    challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={"nonce": challenge["nonce"], "outcome": "PASSED"},
    )
    client.post(f"/sessions/continuous/{session_id}/end")
    response = client.get(f"/sessions/continuous/{session_id}/next-challenge")
    assert response.status_code == 409


def test_challenge_result_rejected_after_session_ended_and_does_not_mutate(client):
    # The failure mode that matters isn't the 409 itself, it's a handler that
    # returns 409 but has already written the challenge resolution/event
    # before the terminal-state check short-circuits. Assert the challenge
    # stays PENDING (and the report's pass/fail counts stay at zero) after
    # the rejected attempt, not just that the HTTP call returned an error.
    session_id = _create_active(client)
    challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    client.post(f"/sessions/continuous/{session_id}/end")
    before = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert before["challenges"] == {"requested": 1, "passed": 0, "failed": 0}

    response = client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={"nonce": challenge["nonce"], "outcome": "PASSED"},
    )
    assert response.status_code == 409

    after = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert after == before
    assert after["challenges"] == {"requested": 1, "passed": 0, "failed": 0}


def test_events_rejected_after_cancelled_and_does_not_mutate(client):
    # The terminal-state guard is a single `state != ACTIVE` check shared by
    # every write function (see continuous_models.py) — not special-cased
    # per terminal state. This confirms it actually fires for CANCELLED too,
    # not only for the ENDED path every other test in this file exercises.
    session_id = _create_active(client)
    client.post(f"/sessions/continuous/{session_id}/end", json={"reason": "CANCELLED"})
    before = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert before["state"] == "CANCELLED"

    response = client.post(
        f"/sessions/continuous/{session_id}/events",
        json={"events": [{"eventType": "face_missing", "severity": "warning"}]},
    )
    assert response.status_code == 409

    after = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert after == before


def test_second_end_call_rejected_and_does_not_mutate(client):
    # Covers the third write verb (§7): a second end call against an
    # already-terminal session must be rejected AND must not overwrite the
    # first, legitimate terminal state/report.
    session_id = _create_active(client)
    first = client.post(f"/sessions/continuous/{session_id}/end")
    assert first.status_code == 200
    first_report = client.get(f"/sessions/continuous/{session_id}/report").json()

    second = client.post(f"/sessions/continuous/{session_id}/end", json={"reason": "CANCELLED"})
    assert second.status_code == 409

    unchanged = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert unchanged == first_report
    assert unchanged["state"] == "ENDED"  # not overwritten to CANCELLED


# --- challenge scheduling: server-decided, cooldown, single-flight, max -

def test_disable_light_challenge_is_stored_and_returned(client):
    response = client.post("/sessions/continuous", json={"disableLightChallenge": True})
    assert response.status_code == 201
    assert response.json()["lightChallengeDisabled"] is True


def test_disable_light_challenge_defaults_to_false(client):
    response = client.post("/sessions/continuous")
    assert response.json()["lightChallengeDisabled"] is False


def test_light_never_drawn_for_a_photosensitive_candidate():
    # Draw many challenges across many independent disabled-Light sessions
    # and confirm LIGHT never comes up.
    from app import continuous_models as models

    seen_types = set()
    for _ in range(40):
        session = models.create_continuous_session(disable_light_challenge=True)
        models.start_continuous_session(session["id"])
        challenge = models.request_next_challenge(session["id"])
        seen_types.add(challenge["type"])
    assert "LIGHT" not in seen_types
    assert seen_types <= {"TURN_HEAD_LEFT", "TURN_HEAD_RIGHT", "DEPTH_PROXIMITY"}


def test_challenge_type_comes_from_server_and_is_not_always_the_same():
    # Draw many challenge types across many independent sessions (avoids
    # cooldown/max-per-session entirely) and confirm more than one type appears.
    from app import continuous_models as models

    seen_types = set()
    for _ in range(40):
        session = models.create_continuous_session()
        models.start_continuous_session(session["id"])
        challenge = models.request_next_challenge(session["id"])
        seen_types.add(challenge["type"])
    assert seen_types <= {"TURN_HEAD_LEFT", "TURN_HEAD_RIGHT", "LIGHT", "DEPTH_PROXIMITY"}
    assert len(seen_types) > 1, "40 draws should not all be the same type if truly server-random"


def test_depth_proximity_can_be_selected_scheduled_and_resolved_with_evidence(client):
    # Phase 10: DEPTH_PROXIMITY is a first-class challenge type alongside
    # Head Turn/Light — the scheduler must be able to draw it, and its rich
    # measurement evidence (a free-form dict, same contract as every other
    # challenge type's `detail`) must persist and count toward the report.
    from app import continuous_models as models

    session_id = None
    challenge = None
    for _ in range(60):
        session = models.create_continuous_session()
        models.start_continuous_session(session["id"])
        drawn = models.request_next_challenge(session["id"])
        if drawn["type"] == "DEPTH_PROXIMITY":
            session_id = session["id"]
            challenge = drawn
            break
    assert challenge is not None, "DEPTH_PROXIMITY should be selectable by the server within 60 draws"

    result = client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={
            "nonce": challenge["nonce"],
            "outcome": "PASSED",
            "detail": {
                "measurements": {
                    "peakScaleRatio": 1.31,
                    "movementDurationMs": 900,
                    "transitionFrameCount": 22,
                    "discontinuitySuspected": False,
                }
            },
        },
    )
    assert result.status_code == 200

    report = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert report["challenges"] == {"requested": 1, "passed": 1, "failed": 0}


def test_cooldown_suppresses_a_second_challenge(client):
    session_id = _create_active(client)
    first = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    client.post(
        f"/sessions/continuous/{session_id}/challenges/{first['challengeId']}/result",
        json={"nonce": first["nonce"], "outcome": "PASSED"},
    )
    second = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    assert second.get("none") is True
    assert second["reason"] == "COOLDOWN"
    assert second["retryAfterMs"] > 0


def test_cooldown_elapsed_allows_a_new_challenge(client):
    session_id = _create_active(client)
    first = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    client.post(
        f"/sessions/continuous/{session_id}/challenges/{first['challengeId']}/result",
        json={"nonce": first["nonce"], "outcome": "PASSED"},
    )
    _backdate_last_challenge(session_id, ms_ago=25_000)  # dev challengeCooldownMs = 20_000
    second = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    assert "challengeId" in second


def test_only_one_challenge_in_flight_at_a_time(client):
    session_id = _create_active(client)
    first = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    assert "challengeId" in first
    second = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    assert second.get("none") is True
    assert second["reason"] == "CHALLENGE_IN_FLIGHT"


def test_max_challenges_per_session_enforced(client):
    session_id = _create_active(client)
    # dev maxChallengesPerSession = 20
    for _ in range(20):
        challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
        assert "challengeId" in challenge
        client.post(
            f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
            json={"nonce": challenge["nonce"], "outcome": "PASSED"},
        )
        _backdate_last_challenge(session_id, ms_ago=25_000)

    response = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    assert response.get("none") is True
    assert response["reason"] == "MAX_CHALLENGES_REACHED"


def test_event_triggered_cooldown_differs_from_random_cooldown(client):
    session_id = _create_active(client)
    first = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    client.post(
        f"/sessions/continuous/{session_id}/challenges/{first['challengeId']}/result",
        json={"nonce": first["nonce"], "outcome": "PASSED"},
    )
    # 25s elapsed clears the RANDOM cooldown (20s dev) but not the
    # EVENT-triggered cooldown (30s dev).
    _backdate_last_challenge(session_id, ms_ago=25_000)
    event_triggered = client.get(f"/sessions/continuous/{session_id}/next-challenge?trigger=EVENT").json()
    assert event_triggered.get("none") is True
    assert event_triggered["reason"] == "COOLDOWN"


# --- nonce / result validation -------------------------------------------

def test_wrong_nonce_rejected(client):
    session_id = _create_active(client)
    challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    response = client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={"nonce": "not-the-real-nonce", "outcome": "PASSED"},
    )
    assert response.status_code == 403


def test_unknown_challenge_id_rejected(client):
    session_id = _create_active(client)
    response = client.post(
        f"/sessions/continuous/{session_id}/challenges/does-not-exist/result",
        json={"nonce": "whatever", "outcome": "PASSED"},
    )
    assert response.status_code == 404


def test_challenge_cannot_be_resolved_twice(client):
    session_id = _create_active(client)
    challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    first = client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={"nonce": challenge["nonce"], "outcome": "PASSED"},
    )
    assert first.status_code == 200
    second = client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={"nonce": challenge["nonce"], "outcome": "FAILED"},
    )
    assert second.status_code == 409


def test_invalid_outcome_rejected(client):
    session_id = _create_active(client)
    challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    response = client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={"nonce": challenge["nonce"], "outcome": "TOTALLY_VALID_I_SWEAR"},
    )
    assert response.status_code == 422


def test_invalid_event_type_rejected(client):
    session_id = _create_active(client)
    response = client.post(
        f"/sessions/continuous/{session_id}/events",
        json={"events": [{"eventType": "not_a_real_event", "severity": "info"}]},
    )
    assert response.status_code == 422


# --- events/challenges persist and read back in order ---------------------

def test_events_persist_and_read_back_in_order(client):
    session_id = _create_active(client)
    client.post(
        f"/sessions/continuous/{session_id}/events",
        json={
            "events": [
                {"eventType": "face_missing", "severity": "warning", "clientOffsetMs": 1000},
                {"eventType": "face_restored", "severity": "info", "clientOffsetMs": 2000},
            ]
        },
    )
    report = client.get(f"/sessions/continuous/{session_id}/report").json()
    event_types = [e["eventType"] for e in report["timeline"]]
    assert "face_missing" in event_types
    assert event_types.index("face_missing") < event_types.index("face_restored")


def test_challenge_results_persist_in_report_counts(client):
    session_id = _create_active(client)
    challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={"nonce": challenge["nonce"], "outcome": "FAILED"},
    )
    report = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert report["challenges"]["requested"] == 1
    assert report["challenges"]["failed"] == 1
    assert report["challenges"]["passed"] == 0


# --- end finalizes correctly -----------------------------------------------

def test_end_finalizes_with_low_risk_when_challenges_pass(client):
    session_id = _create_active(client)
    challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
    client.post(
        f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
        json={"nonce": challenge["nonce"], "outcome": "PASSED"},
    )
    report = client.post(f"/sessions/continuous/{session_id}/end").json()
    assert report["state"] == "ENDED"
    assert report["riskState"] == "LOW_RISK"


def test_end_reports_inconclusive_with_no_completed_challenges(client):
    session_id = _create_active(client)
    report = client.post(f"/sessions/continuous/{session_id}/end").json()
    assert report["riskState"] == "INCONCLUSIVE"


def _draw_and_resolve_until(client, session_id, wanted_types, outcome_by_type, detail_by_type=None):
    """
    Test helper (Phase 11): repeatedly draws the next challenge (server
    picks the type randomly) until every type in `wanted_types` has been
    resolved with its configured outcome/detail at least once, resolving
    any other drawn type as PASSED (a neutral no-op for fusion, since it's
    neither Head Turn nor Light) so it doesn't distort the risk score.
    Backdates the cooldown after every draw so this never has to sleep.
    """
    detail_by_type = detail_by_type or {}
    remaining = set(wanted_types)
    for _ in range(20):  # dev maxChallengesPerSession
        if not remaining:
            break
        challenge = client.get(f"/sessions/continuous/{session_id}/next-challenge").json()
        assert "challengeId" in challenge, challenge
        ctype = challenge["type"]
        # Gate on `remaining`, not the original `wanted_types` — a type can
        # be drawn again by the server's random scheduler after it's already
        # been satisfied once (e.g. LIGHT drawn twice before every wanted
        # type has come up). Re-applying the same score/validity detail a
        # second time would silently double-count that evidence in fusion's
        # aggregation (score_light's validity-weighted mean over N identical
        # entries), which is a test-fixture bug, not a fusion bug — so any
        # already-satisfied type is resolved as a neutral PASSED with no
        # detail from here on.
        outcome = outcome_by_type.get(ctype, "PASSED") if ctype in remaining else "PASSED"
        body = {"nonce": challenge["nonce"], "outcome": outcome}
        if ctype in remaining and ctype in detail_by_type:
            body["detail"] = detail_by_type[ctype]
        client.post(
            f"/sessions/continuous/{session_id}/challenges/{challenge['challengeId']}/result",
            json=body,
        )
        remaining.discard(ctype)
        _backdate_last_challenge(session_id, ms_ago=25_000)
    assert not remaining, f"Could not draw every wanted type within budget; missing {remaining}"


def test_report_includes_fusion_breakdown_and_challenge_evidence(client):
    session_id = _create_active(client)
    _draw_and_resolve_until(
        client,
        session_id,
        wanted_types=("TURN_HEAD_LEFT", "TURN_HEAD_RIGHT", "LIGHT"),
        outcome_by_type={"TURN_HEAD_LEFT": "PASSED", "TURN_HEAD_RIGHT": "PASSED", "LIGHT": "PASSED"},
        detail_by_type={
            "LIGHT": {
                "lightScore": 0.9,
                "lightValidity": 0.95,
                "diagnostics": {"deliveredFps": 30, "faceCoverage": 0.2, "screenContribution": 0.05},
            }
        },
    )
    report = client.post(f"/sessions/continuous/{session_id}/end").json()

    assert report["riskState"] == "LOW_RISK"
    assert report["fusion"]["sHeadTurn"] == pytest.approx(1.0)
    assert report["fusion"]["sLight"] == pytest.approx(0.9)
    assert report["fusion"]["vLight"] == pytest.approx(0.95)
    assert report["fusion"]["headTurnWeight"] == 1.0
    assert report["fusion"]["lightWeight"] == 0.3

    light_evidence = [e for e in report["challengeEvidence"] if e["type"] == "LIGHT"]
    assert light_evidence[0]["lightScore"] == 0.9
    assert light_evidence[0]["lightValidity"] == 0.95
    assert light_evidence[0]["diagnostics"]["deliveredFps"] == 30


def test_suspicious_light_escalates_an_otherwise_clean_session_via_http(client):
    session_id = _create_active(client)
    _draw_and_resolve_until(
        client,
        session_id,
        wanted_types=("TURN_HEAD_LEFT", "TURN_HEAD_RIGHT", "LIGHT"),
        outcome_by_type={"TURN_HEAD_LEFT": "PASSED", "TURN_HEAD_RIGHT": "PASSED", "LIGHT": "ABORTED"},
        detail_by_type={
            "LIGHT": {"lightScore": 0.0, "lightValidity": 1.0, "diagnostics": {"resultReason": "no directional shift"}}
        },
    )
    report = client.post(f"/sessions/continuous/{session_id}/end").json()

    assert report["riskState"] == "REVIEW_RECOMMENDED"
    assert report["riskEscalated"] is False  # never a hard fail from Light alone


# --- ground-truth labeling (Phase 11, Step 15 — engineering/research only) -

def test_label_rejected_before_session_is_terminal(client):
    session_id = _create_active(client)
    response = client.post(f"/sessions/continuous/{session_id}/label", json={"label": "GENUINE"})
    assert response.status_code == 409


def test_label_accepted_after_end_and_appears_in_report(client):
    session_id = _create_active(client)
    client.post(f"/sessions/continuous/{session_id}/end")
    response = client.post(f"/sessions/continuous/{session_id}/label", json={"label": "PRINT_ATTACK"})
    assert response.status_code == 200
    assert response.json()["groundTruthLabel"] == "PRINT_ATTACK"

    report = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert report["groundTruthLabel"] == "PRINT_ATTACK"


def test_label_rejects_unrecognized_value(client):
    session_id = _create_active(client)
    client.post(f"/sessions/continuous/{session_id}/end")
    response = client.post(f"/sessions/continuous/{session_id}/label", json={"label": "NOT_A_REAL_LABEL"})
    assert response.status_code == 422


def test_end_with_cancelled_reason(client):
    session_id = _create_active(client)
    response = client.post(f"/sessions/continuous/{session_id}/end", json={"reason": "CANCELLED"})
    assert response.status_code == 200
    assert response.json()["state"] == "CANCELLED"


# --- Phase 9: external-consumer correlation id (externalRef) --------------

def test_create_without_body_still_works_and_external_ref_is_none(client):
    # No JSON body at all — the pre-Phase-9 call shape must keep working.
    response = client.post("/sessions/continuous")
    assert response.status_code == 201
    assert response.json()["externalRef"] is None


def test_external_ref_is_stored_and_returned_on_create(client):
    response = client.post("/sessions/continuous", json={"externalRef": "assessment-attempt-42"})
    assert response.status_code == 201
    assert response.json()["externalRef"] == "assessment-attempt-42"


def test_external_ref_survives_start_and_appears_in_report(client):
    session = client.post("/sessions/continuous", json={"externalRef": "assessment-attempt-42"}).json()
    session_id = session["sessionId"]
    started = client.post(f"/sessions/continuous/{session_id}/start").json()
    assert started["externalRef"] == "assessment-attempt-42"

    report = client.post(f"/sessions/continuous/{session_id}/end").json()
    assert report["externalRef"] == "assessment-attempt-42"

    reread = client.get(f"/sessions/continuous/{session_id}/report").json()
    assert reread["externalRef"] == "assessment-attempt-42"


def test_external_ref_too_long_is_rejected(client):
    response = client.post("/sessions/continuous", json={"externalRef": "x" * 201})
    assert response.status_code == 422
