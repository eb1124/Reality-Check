# Reality Check — Backend (Phase 1: Session Foundation)

This is the first backend phase. Its only job is to be the authoritative
source for **session identity** and **challenge assignment** — the two
things that must live outside the browser for the client-side liveness
checks to mean anything to a third party. Everything else (camera capture,
MediaPipe, head-turn detection, light-response detection) still runs
entirely in the browser, unchanged.

**This backend does not make the client-side liveness measurements
tamper-proof.** It gives sessions a server-issued identity and a
server-random challenge assignment that the client cannot see in advance
or override — that closes the "the client can just decide it passed"
gap, but the actual chroma/yaw measurements are still computed by
JavaScript running in an environment the person being verified fully
controls. Verifying the measurements themselves is a later phase (see
"Deliberately not implemented" below).

## Install

From the `backend/` directory:

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
```

## Run the server

```bash
uvicorn app.main:app --reload
```

Server starts at `http://127.0.0.1:8000`. The SQLite database file is
created automatically on startup at `backend/data/verification.db` (the
`data/` directory is created if it doesn't exist, and is gitignored).

To use a different database file (e.g. for a second local instance),
set `REALITY_CHECK_DB_PATH` before starting the server:

```bash
REALITY_CHECK_DB_PATH=/tmp/other.db uvicorn app.main:app --reload
```

## Run tests

```bash
pytest
```

Each test runs against its own fresh, isolated temporary SQLite file
(via a `conftest.py` fixture) — tests never touch the dev database and
never depend on state left over from a previous run.

## Endpoints

### `POST /sessions`

Creates a new verification session. Takes **no request body** — there is
no field a client could use to supply or influence the assigned
direction, by construction, not just by convention. The server:

- generates an opaque, cryptographically strong session ID (`secrets.token_urlsafe`)
- randomly assigns `LEFT` or `RIGHT` (`secrets.choice`)
- persists the session with status `PENDING`

Response `201`:
```json
{
  "sessionId": "…",
  "headTurnDirection": "LEFT",
  "status": "PENDING"
}
```

### `GET /sessions/{session_id}`

Reads a persisted session. Read-only — no other HTTP method is registered
on this path, so `PUT`/`PATCH`/`DELETE` return `405` automatically.

Response `200`:
```json
{
  "sessionId": "…",
  "headTurnDirection": "LEFT",
  "status": "PENDING",
  "createdAt": "2026-…",
  "completedAt": null
}
```

Unknown session ID → `404`.

### `GET /health`

Trivial liveness check for the server process itself (`{"status": "ok"}`).

## Database schema

Single SQLite table, `sessions`:

| column                          | type | notes                              |
|----------------------------------|------|-------------------------------------|
| `session_id`                     | TEXT | primary key                        |
| `assigned_head_turn_direction`   | TEXT | `CHECK IN ('LEFT', 'RIGHT')`       |
| `status`                         | TEXT | `PENDING` only, in this phase       |
| `created_at`                     | TEXT | ISO 8601 UTC                        |
| `completed_at`                   | TEXT | nullable; always `NULL` in Phase 1  |

## What Phase 1 deliberately does NOT implement

- **No event ingestion** — there's no endpoint yet for the client to report
  a Head-Turn or Light Challenge outcome. Sessions are created and can be
  read back, and that's all.
- **No verdict derivation** — `status` never leaves `PENDING` in this phase.
- **No WebRTC / media transport** — no video or audio ever reaches the
  server.
- **No ML / computer vision** — the server never looks at pixels. It has
  no idea what the camera saw.
- **No authentication** — endpoints are unauthenticated and unauthorized;
  anyone who can reach the server can create and read sessions.
- **No raw video/frame storage.**
- **No risk score / confidence score** — this backend, like the frontend
  it will eventually integrate with, never produces a probability. Only
  categorical state.
- **No frontend integration** — the React app does not call this backend
  yet. `useVerificationOrchestrator.js` still generates its own direction
  client-side. Wiring the two together is a separate, later step.

## Future phases (unchanged from the original plan, for reference)

- **Phase 2**: event ingestion (`POST /sessions/{id}/events`) + server-side
  verdict derivation from recorded events, replacing the client-computed
  verdict as the authoritative one.
- **Phase 3**: real evidence transport (WebRTC) and independent server-side
  liveness computation.
- **Phase 4**: risk scoring / policy, audit log, alerting — only after the
  above are real.
