# Reality Check — Backend (Session Foundation + Result Persistence)

The backend is the authoritative source for **session identity**,
**challenge assignment**, and — as of Phase 2 — **finalized verification
outcomes**. Everything else (camera capture, MediaPipe, head-turn detection,
light-response detection, and the pass/fail decision itself) still runs
entirely in the browser: this backend records that decision, it does not
compute it.

The frontend (`frontend/src/api/sessionApi.js`,
`frontend/src/hooks/useVerificationOrchestrator.js`) is wired up to this
backend: it creates a session before every verification attempt (including
every retry — a retry is a brand-new session, never a reused one) and
submits the resulting verdict once the orchestrated Head-Turn → Light
Challenge sequence reaches a result.

**This backend does not make the client-side liveness measurements
tamper-proof.** It gives sessions a server-issued identity and a
server-random challenge assignment that the client cannot see in advance
or override — that closes the "the client can just decide it passed" gap.
The actual yaw/chroma measurements, and the PASS/INCOMPLETE decision derived
from them, are still computed by JavaScript running in an environment the
person being verified fully controls; `POST /sessions/{id}/result` records
that client-reported verdict, it does not independently re-derive or
audit it. Independent server-side verification of the measurements
themselves is a later phase (see "Deliberately not implemented" below).

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

### `POST /sessions/{session_id}/result`

Finalizes a session with the client's already-computed verdict, once the
orchestrated Head-Turn → Light Challenge sequence reaches a result. This is
evidence recording, not re-verification — see the trust-boundary note above.

Request body:
```json
{
  "outcome": "VERIFIED",
  "headTurnOutcome": "SUCCESS",
  "lightChallengeOutcome": "LIGHT_PASS"
}
```
- `outcome` — required, one of `"VERIFIED"` / `"INCOMPLETE_RETRY"` (the exact
  two values `useVerificationOrchestrator.js`'s `VERIFICATION_VERDICT`
  produces — no numeric score or probability field exists here, deliberately).
- `headTurnOutcome` / `lightChallengeOutcome` — optional, free-form status
  strings for display/diagnostics (e.g. `"TIMEOUT"`, `"LIGHT_INCONCLUSIVE"`,
  `"DECLINED"`, `"NOT_ATTEMPTED"`); not validated against a closed enum since
  the decision was already made client-side.

Response `200`: the updated session (same shape as `GET /sessions/{id}`).

Errors:
- Unknown session ID → `404`.
- Session already finalized (status is no longer `PENDING`) → `409` — a
  session's verdict can be submitted exactly once; a second submission never
  silently overwrites the first.
- Malformed/missing `outcome` → `422`.

### `GET /health`

Trivial liveness check for the server process itself (`{"status": "ok"}`).

## Database schema

Single SQLite table, `sessions`:

| column                          | type | notes                              |
|----------------------------------|------|-------------------------------------|
| `session_id`                     | TEXT | primary key                        |
| `assigned_head_turn_direction`   | TEXT | `CHECK IN ('LEFT', 'RIGHT')`       |
| `status`                         | TEXT | `PENDING`, then `VERIFIED` or `INCOMPLETE_RETRY` once finalized |
| `created_at`                     | TEXT | ISO 8601 UTC                        |
| `completed_at`                   | TEXT | nullable; set when the result is submitted |
| `head_turn_outcome`              | TEXT | nullable; set when the result is submitted |
| `light_challenge_outcome`        | TEXT | nullable; set when the result is submitted |

`head_turn_outcome` and `light_challenge_outcome` were added after the
original three-column schema; `database.py`'s `init_db()` migrates any
existing database file in place (via `ALTER TABLE`) rather than requiring a
fresh database — historical rows keep their original data with `NULL` in
the new columns until/unless they're later finalized.

## What this backend deliberately does NOT implement

- **No independent server-side verification** — `POST /sessions/{id}/result`
  records the client's verdict; it does not recompute or audit the
  underlying yaw/chroma measurements.
- **No WebRTC / media transport** — no video or audio ever reaches the
  server.
- **No ML / computer vision** — the server never looks at pixels. It has
  no idea what the camera saw.
- **No authentication** — endpoints are unauthenticated and unauthorized;
  anyone who can reach the server can create, read, and finalize sessions.
- **No raw video/frame storage.**
- **No risk score / confidence score** — only the categorical `outcome`
  the frontend already computes (`VERIFIED` / `INCOMPLETE_RETRY`) is stored.

## Future phases (unchanged from the original plan, for reference)

- **Phase 3**: real evidence transport (WebRTC) and independent server-side
  liveness computation.
- **Phase 4**: risk scoring / policy, audit log, alerting — only after the
  above are real.
