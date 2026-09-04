from app import models


def test_submit_result_marks_session_verified(client):
    created = client.post("/sessions").json()
    response = client.post(
        f"/sessions/{created['sessionId']}/result",
        json={
            "outcome": "VERIFIED",
            "headTurnOutcome": "SUCCESS",
            "lightChallengeOutcome": "LIGHT_PASS",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "VERIFIED"
    assert body["headTurnOutcome"] == "SUCCESS"
    assert body["lightChallengeOutcome"] == "LIGHT_PASS"
    assert body["completedAt"] is not None


def test_submit_result_marks_session_incomplete_retry(client):
    created = client.post("/sessions").json()
    response = client.post(
        f"/sessions/{created['sessionId']}/result",
        json={
            "outcome": "INCOMPLETE_RETRY",
            "headTurnOutcome": "TIMEOUT",
            "lightChallengeOutcome": "NOT_ATTEMPTED",
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "INCOMPLETE_RETRY"


def test_submit_result_persists_to_storage(client):
    created = client.post("/sessions").json()
    client.post(
        f"/sessions/{created['sessionId']}/result",
        json={"outcome": "VERIFIED"},
    )
    persisted = models.get_session(created["sessionId"])
    assert persisted["status"] == "VERIFIED"
    assert persisted["completed_at"] is not None


def test_submit_result_optional_fields_default_to_null(client):
    created = client.post("/sessions").json()
    response = client.post(
        f"/sessions/{created['sessionId']}/result",
        json={"outcome": "VERIFIED"},
    )
    body = response.json()
    assert body["headTurnOutcome"] is None
    assert body["lightChallengeOutcome"] is None


def test_submit_result_unknown_session_returns_404(client):
    response = client.post(
        "/sessions/does-not-exist/result",
        json={"outcome": "VERIFIED"},
    )
    assert response.status_code == 404


def test_submit_result_rejects_invalid_outcome(client):
    created = client.post("/sessions").json()
    response = client.post(
        f"/sessions/{created['sessionId']}/result",
        json={"outcome": "DEFINITELY_REAL_PERSON"},
    )
    assert response.status_code == 422
    # Rejected before touching storage — session must remain untouched.
    unchanged = models.get_session(created["sessionId"])
    assert unchanged["status"] == "PENDING"


def test_submit_result_rejects_missing_outcome(client):
    created = client.post("/sessions").json()
    response = client.post(f"/sessions/{created['sessionId']}/result", json={})
    assert response.status_code == 422


def test_submit_result_cannot_be_submitted_twice(client):
    created = client.post("/sessions").json()
    session_id = created["sessionId"]

    first = client.post(f"/sessions/{session_id}/result", json={"outcome": "VERIFIED"})
    assert first.status_code == 200

    second = client.post(
        f"/sessions/{session_id}/result",
        json={"outcome": "INCOMPLETE_RETRY"},
    )
    assert second.status_code == 409
    # The first, legitimate verdict must not be overwritten by the rejected second call.
    unchanged = models.get_session(session_id)
    assert unchanged["status"] == "VERIFIED"


def test_get_session_reflects_submitted_result(client):
    created = client.post("/sessions").json()
    client.post(
        f"/sessions/{created['sessionId']}/result",
        json={"outcome": "VERIFIED", "headTurnOutcome": "SUCCESS"},
    )
    response = client.get(f"/sessions/{created['sessionId']}")
    body = response.json()
    assert body["status"] == "VERIFIED"
    assert body["headTurnOutcome"] == "SUCCESS"
