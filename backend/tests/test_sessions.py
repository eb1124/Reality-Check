from app import models


def test_create_session_succeeds(client):
    response = client.post("/sessions")
    assert response.status_code == 201
    body = response.json()
    assert set(body.keys()) == {"sessionId", "headTurnDirection", "status"}
    assert body["status"] == "PENDING"
    assert body["headTurnDirection"] in ("LEFT", "RIGHT")
    assert isinstance(body["sessionId"], str) and len(body["sessionId"]) > 0


def test_session_ids_are_unique(client):
    ids = {client.post("/sessions").json()["sessionId"] for _ in range(25)}
    assert len(ids) == 25


def test_assigned_direction_always_left_or_right(client):
    directions = {client.post("/sessions").json()["headTurnDirection"] for _ in range(40)}
    assert directions <= {"LEFT", "RIGHT"}
    # With 40 independent draws, both values should appear if truly random
    # (probability of a false failure here is astronomically small: ~2 * 0.5^40).
    assert directions == {"LEFT", "RIGHT"}


def test_client_cannot_override_assigned_direction(client):
    # An attacker tries to force RIGHT every time by supplying it in the body.
    # POST /sessions has no request-body schema at all, so this must be ignored.
    observed = set()
    for _ in range(20):
        response = client.post("/sessions", json={"headTurnDirection": "RIGHT"})
        assert response.status_code == 201
        observed.add(response.json()["headTurnDirection"])
    assert observed == {"LEFT", "RIGHT"}, (
        "Server appears influenced by client-supplied direction — "
        "with 20 draws both values should appear if truly server-random."
    )


def test_created_session_is_persisted(client):
    created = client.post("/sessions").json()
    persisted = models.get_session(created["sessionId"])
    assert persisted is not None
    assert persisted["assigned_head_turn_direction"] == created["headTurnDirection"]
    assert persisted["status"] == "PENDING"
    assert persisted["completed_at"] is None


def test_get_returns_created_session(client):
    created = client.post("/sessions").json()
    response = client.get(f"/sessions/{created['sessionId']}")
    assert response.status_code == 200
    body = response.json()
    assert body["sessionId"] == created["sessionId"]
    assert body["headTurnDirection"] == created["headTurnDirection"]
    assert body["status"] == "PENDING"
    assert body["completedAt"] is None
    assert isinstance(body["createdAt"], str) and len(body["createdAt"]) > 0


def test_get_unknown_session_returns_404(client):
    response = client.get("/sessions/does-not-exist")
    assert response.status_code == 404


def test_get_endpoint_does_not_allow_modification(client):
    created = client.post("/sessions").json()
    session_id = created["sessionId"]
    for method in ("put", "patch", "delete"):
        response = getattr(client, method)(f"/sessions/{session_id}")
        assert response.status_code == 405
    unchanged = models.get_session(session_id)
    assert unchanged["status"] == "PENDING"
