# Reality Check — External Integration Guide (Phase 9)

This is the guide for a **separate application** (e.g. an online-assessment
platform) that wants to embed Reality Check's continuous liveness
monitoring alongside its own candidate experience. It assumes no knowledge
of Reality Check's internals.

If you are working *inside* this repository, see `backend/README.md` for
the backend's own endpoint reference. This document is the one to hand to
another team.

## What Reality Check does and does not own

Reality Check provides:

- continuous liveness monitoring (passive: face presence, multiple faces,
  frozen frame, camera interruption)
- challenge scheduling (Head Turn, Light Challenge, Depth/Proximity) at
  unpredictable times
- a session integrity report at the end

Reality Check does **not** provide, and will never render:

- the assessment itself (questions, editor, timer, submit button, navigation)
- candidate video recording (that's your job — see "Camera ownership" below)
- a recruiter dashboard

The only UI Reality Check ever puts on screen is a full-viewport colour
flash during the Light Challenge (a physical requirement of that
challenge — it has to actually illuminate the candidate's face) and,
optionally, a mirrored `<video>` preview if you ask for one. Head Turn and
Depth/Proximity have no visual of their own; you display the instruction
text yourself, driven by the `challenge` event (see below) — this keeps
Reality Check out of your UI entirely.

## Install / import

This is not yet published to npm (deliberately — see the engineering
report's "Remaining limitations"). Import it as a local module from within
this repo, or copy `frontend/src/realityCheck/` and `frontend/src/hooks/`
into your own build if you are integrating from a genuinely separate
codebase:

```js
import { createRealityCheckSession } from './realityCheck/index';
```

`realityCheck/index.js` is the **only** file you should import from. Every
other file under `realityCheck/` and every file under `hooks/` is an
internal implementation detail (MediaPipe, the challenge engines, the
scheduler, risk scoring) and is not part of the supported surface.

## Camera ownership — read this first

**Your application owns the camera.** If you are also recording the
candidate (the normal case for an OA), open the camera yourself and pass
the resulting `MediaStream` to Reality Check:

```js
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

const rc = createRealityCheckSession({ mediaStream: stream });
```

With `mediaStream` supplied, Reality Check:

- never calls `getUserMedia` itself
- never calls `track.stop()` on any of that stream's tracks — not on
  `end()`, not on cleanup, not ever
- ignores the audio track entirely (visual liveness only, this phase — see
  "What Reality Check ignores" below)

**You** decide when the camera actually turns off, and you do it yourself,
strictly after `rc.end()` has resolved:

```js
await rc.end();                 // Reality Check has released its own resources
stream.getTracks().forEach(t => t.stop()); // you release the camera
```

If you omit `mediaStream`, Reality Check falls back to acquiring and owning
its own camera (the original, still fully-supported standalone mode used
by this repo's own `demo-interview.html`). Don't mix the two: either you
own the camera and pass it in, or Reality Check owns it — never both.

### What Reality Check ignores

Only the video track is read. If your `MediaStream` also carries an audio
track (normal for a recording use case), Reality Check does not inspect,
process, or forward it. No audio-based liveness signal exists in this
phase.

## Full lifecycle

```js
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
const recorder = new MediaRecorder(stream);
recorder.start();

const rc = createRealityCheckSession({
  mediaStream: stream,
  externalRef: assessmentAttemptId,      // optional — see "Session mapping"
  apiBaseUrl: 'https://reality-check.example.com' // optional — see "Backend origin"
});

rc.on('event', (e) => { /* face_missing, camera_stream_interrupted, ... */ });
rc.on('challenge', (c) => {
  if (c.status === 'started') showBanner(c.type); // 'TURN_HEAD_LEFT' | 'TURN_HEAD_RIGHT' | 'LIGHT' | 'DEPTH_PROXIMITY'
  else hideBanner();
});

const { sessionId } = await rc.start();
saveToYourDatabase({ assessmentAttemptId, realityCheckSessionId: sessionId });

// ... the assessment runs; the candidate is periodically challenged ...

// On submission:
const report = await rc.end();          // 1. end Reality Check, get the report
recorder.stop();                        // 2. stop your own recording
stream.getTracks().forEach(t => t.stop()); // 3. release the camera
persistReport(assessmentAttemptId, report);
```

`rc.end()` is **idempotent** — calling it a second time (or calling it when
`start()` was never called) resolves to `null` without contacting the
backend again or re-running teardown. No scheduled challenge and no
in-flight event can revive a session after `end()`.

## Backend origin (`apiBaseUrl`)

By default, Reality Check's frontend calls a same-origin `/api` proxy
(useful only when your app happens to be served from the same Vite dev
server as this repo — not a real integration scenario). A genuinely
separate application should pass `apiBaseUrl` pointing at wherever the
Reality Check backend is actually deployed:

```js
createRealityCheckSession({ mediaStream: stream, apiBaseUrl: 'https://reality-check.example.com' });
```

The backend enables permissive CORS specifically to support this (see
`backend/app/main.py`) — there is no authentication or cookie-based session
anywhere in this backend today, so this widens no existing trust boundary.

## Session mapping (`externalRef`)

To associate your own `assessmentAttemptId` with the Reality Check session
without Reality Check depending on your database, pass it once at creation:

```js
createRealityCheckSession({ mediaStream: stream, externalRef: assessmentAttemptId });
```

It's stored verbatim (max 200 characters, plain string — not an arbitrary
object) and echoed back as `externalRef` on the session record and in the
final report. You still get the authoritative `realityCheckSessionId` back
from `rc.start()` — `externalRef` is a convenience tag, not a replacement
for storing that ID yourself.

## Public API reference

### `createRealityCheckSession(options)`

| option | type | default | meaning |
|---|---|---|---|
| `mediaStream` | `MediaStream` | none | externally-owned camera stream to analyze (see above) |
| `videoElement` | `HTMLVideoElement` | none | if given, the live stream is mirrored onto it for your own preview |
| `apiBaseUrl` | `string` | same-origin `/api` | backend origin override |
| `externalRef` | `string` (≤200 chars) | none | your own correlation id |
| `disableLightChallenge` | `boolean` | `false` | set true when the candidate has disclosed photosensitive epilepsy or a sensitivity to flashing/bright lights — the backend then never draws a LIGHT challenge for this session (see `ContinuousConsentGate.jsx` for the reference consent-UI pattern) |

Returns `{ start, on, getStatus, end }`.

### `rc.start()`

```ts
start(): Promise<{ sessionId: string | null }>
```

Starts continuous monitoring. Idempotent against a second call. Resolves
once the backend session exists and monitoring is active.
`sessionId` is also always available afterwards via `getStatus().sessionId`.

### `rc.on(type, handler)`

```ts
on(type: 'event' | 'challenge', handler: (payload) => void): void
```

No `off` — this integration is one session per `createRealityCheckSession()`
call. Call `end()` (which tears down everything, listeners included)
rather than unsubscribing individual handlers mid-session.

### `rc.getStatus()`

```ts
getStatus(): {
  state: 'IDLE' | 'STARTING' | 'ACTIVE' | 'CHALLENGE_ACTIVE' | 'ENDED' | 'ERROR',
  riskState: 'LOW_RISK' | 'REVIEW_RECOMMENDED' | 'INCONCLUSIVE' | null,
  challengesRun: number,
  sessionId: string | null
}
```

Pull-based (poll it, e.g. every second, for a persistent status indicator).
Events and challenges are push-based via `on()`.

### `rc.end(reason?)`

```ts
end(reason?: 'ENDED' | 'CANCELLED' | 'ERROR'): Promise<Report | null>
```

Ends the session and returns the final integrity report (see below).
Idempotent — see "Full lifecycle" above. Always releases Reality Check's
own resources (MediaPipe, timers, listeners, its hidden React root). Never
stops an externally-supplied `mediaStream`.

### Cleanup

`end()` is the only cleanup step you need to call. If your page can be torn
down (navigated away, component unmounted) before the candidate explicitly
finishes, call `rc.end('CANCELLED')` from your own unmount/teardown path —
exactly as this repo's own demos do:

```js
useEffect(() => () => { rc.end('CANCELLED'); }, []);
```

### Error handling

- `rc.start()` never throws for a camera/backend failure; check
  `rc.getStatus().state` (`'IDLE'` after a failed start) if you need to
  detect it. `useContinuousVerification`'s `startError` is not part of the
  public surface — check `state` instead.
- `rc.on(type, handler)` throws synchronously for an unrecognized `type`
  (only `'event'` and `'challenge'` are valid) — this is a programming
  error, not a runtime condition to recover from.
- A listener that throws is caught and logged (`console.error`); it never
  crashes the session or other listeners.

## Event contract

Subscribe via `rc.on('event', handler)`. Each payload is
`{ eventType: string, severity: 'info' | 'warning' | 'suspicious' | 'error' }`.
The fixed vocabulary (see `frontend/src/realityCheck/continuousTypes.js` /
`backend/app/continuous_types.py` for the authoritative list):

| category | eventType |
|---|---|
| session lifecycle | `session_started`, `session_ended`, `session_cancelled`, `session_error`, `monitoring_started`, `monitoring_stopped` |
| passive/informational | `face_missing`, `face_restored`, `multiple_faces_detected`, `multiple_faces_cleared`, `landmark_discontinuity`, `frozen_frame_suspected`, `camera_track_ended`, `camera_stream_interrupted`, `camera_device_changed`, `technical_error` |
| challenge lifecycle | `challenge_requested`, `challenge_started`, `challenge_passed`, `challenge_failed`, `challenge_aborted`, `challenge_timeout` |
| risk | `risk_state_changed` |

Not every event type above is necessarily emitted by the current
implementation — this table is the fixed vocabulary both frontend and
backend validate against (an unrecognized value is rejected outright), not
a guarantee every value will occur in practice. As of this phase:
`camera_track_ended`, `camera_stream_interrupted`, `camera_device_changed`,
`challenge_started`, `technical_error`, and `risk_state_changed` are
reserved vocabulary with no current emitter wired up to a real browser
condition (their `usePassiveMonitor.js` report-methods exist but nothing
calls them yet — e.g. no `track.onended`/`oninactive` listener is attached
to the camera stream). Handle them if you like, but don't depend on
receiving them today; see "Remaining limitations" in the Phase 9 report.

Subscribe via `rc.on('challenge', handler)` for the challenge lifecycle
specifically. Each payload is `{ status: 'started' | 'passed' | 'failed', type: 'TURN_HEAD_LEFT' | 'TURN_HEAD_RIGHT' | 'LIGHT' | 'DEPTH_PROXIMITY' }`.
This is how you know **which instruction to display** for Head Turn and
Depth/Proximity — Reality Check does not render that instruction itself:

```js
rc.on('challenge', (c) => {
  if (c.status !== 'started') return setBanner(null);
  setBanner({
    TURN_HEAD_LEFT: 'Please turn your head to the LEFT and hold briefly.',
    TURN_HEAD_RIGHT: 'Please turn your head to the RIGHT and hold briefly.',
    LIGHT: 'Please look directly at your screen for a moment.',
    DEPTH_PROXIMITY: 'Please move closer to the camera and hold briefly.'
  }[c.type]);
});
```

The backend's 4-value outcome (`PASSED` / `FAILED` / `TIMEOUT` / `ABORTED`)
is collapsed to 3 states here (`TIMEOUT`/`ABORTED` both surface as
`'failed'`); the full outcome is still in the final report's timeline.

### Timestamps and video alignment

Every event stored server-side (and present in the report's `timeline`)
carries both `serverTimestamp` (wall-clock, ISO 8601 UTC) and
`clientOffsetMs` — milliseconds since Reality Check's monitoring actually
started on the client. If your recording starts at roughly the same moment
you call `rc.start()`, `clientOffsetMs` is directly usable as a seek offset
into your own recording (e.g. "jump to `clientOffsetMs / 1000` seconds").
`clientOffsetMs` can be `null` for events recorded before monitoring
reached the active state; fall back to `serverTimestamp` in that case.

## Integrity report contract

Returned by `rc.end()`, and independently re-fetchable from the backend at
`GET /sessions/continuous/{sessionId}/report` while you still have the ID:

```ts
{
  sessionId: string,
  state: 'ENDED' | 'CANCELLED' | 'ERROR',
  durationMs: number | null,
  riskState: 'LOW_RISK' | 'REVIEW_RECOMMENDED' | 'INCONCLUSIVE' | null,
  riskScore: number,
  riskEscalated: boolean,
  challenges: { requested: number, passed: number, failed: number },
  suspiciousEventCount: number,
  externalRef: string | null,
  // Phase 11 — see "Head Turn / Light fusion" below.
  fusion: {
    sHeadTurn: number | null, sLight: number | null, vLight: number,
    fusedScore: number | null, decisiveHeadTurnPass: boolean,
    headTurnWeight: number, lightWeight: number
  },
  challengeEvidence: Array<{
    type: string, status: string,
    lightScore: number | null, lightValidity: number | null,
    diagnostics: object | null
  }>,
  groundTruthLabel: string | null,  // engineering/calibration only — see below
  timeline: Array<{
    eventType: string,
    severity: 'info' | 'warning' | 'suspicious' | 'error',
    serverTimestamp: string,   // ISO 8601 UTC
    clientOffsetMs: number | null
  }>
}
```

Notes:

- `riskState: 'INCONCLUSIVE'` means "not enough evidence to say," **not** a
  risk finding — don't style it as a warning in your recruiter UI.
- There is no confidence percentage or numeric score meant for display —
  `riskScore` is an internal input to `riskState`/`riskEscalated`, not a
  polished metric. Show `riskState` (and, if useful, the challenge
  pass/fail counts and `suspiciousEventCount`), not `riskScore` itself.
- `fusion` and `challengeEvidence` are diagnostic/calibration fields (Phase
  11) — engineering/reporting inputs, not additional candidate-facing
  scores. Do not surface `sLight`/`fusedScore` as a percentage in a
  recruiter UI; show `riskState` as before.
- Nothing here is raw biometric data — no landmarks, no frames, no pixels.

### Head Turn / Light fusion (Phase 11)

`riskState`/`riskEscalated` now reflect a validity-scaled fusion of Head
Turn and Light evidence, not just the raw event-severity score:

- Light's effective authority in a session scales with `vLight` (0–1), a
  per-session validity computed client-side from real capture-quality
  signals (screen contribution, face coverage, delivered FPS, a
  suspected-AWB/exposure-drift check) — see `backend/app/fusion.py` and
  `frontend/src/challenges/lightChallenge.js`'s `computeLightValidity`.
  `vLight = 0` (unusable Light data) makes the session's risk state
  depend on Head Turn evidence alone, exactly as if Light had never run.
- Light is deliberately **weighted below** Head Turn
  (`lightWeight: 0.3` vs `headTurnWeight: 1.0`, both configurable in
  `backend/app/config.py`'s `get_fusion_config()`) — these are provisional
  engineering priors, not calibrated coefficients (see that function's
  docstring).
- Light can lift a marginal/under-review result to `LOW_RISK`, or push a
  clean result to `REVIEW_RECOMMENDED`, but it can never — by itself —
  push a decisive Head Turn pass into the `escalated` tier, the most
  severe state this system has. There is no automated hard-fail tier at
  all; the worst outcome is always "recommend human review."

### Ground-truth labeling (engineering/development only)

`POST /sessions/continuous/{sessionId}/label` with `{"label": "GENUINE" |
"PRINT_ATTACK" | "PHONE_REPLAY" | "FACE_SWAP" | "MASK" | "OTHER"}` attaches
a ground-truth label to an already-ended session, for later offline
calibration (`backend/scripts/calibrate.py`). **This is not part of the
candidate/OA-facing contract** — nothing in the browser UI or this
integration calls it; it exists purely for a researcher/QA process
building a labeled dataset to eventually replace the provisional fusion
weights with measured ones.

## Security boundary — read before you rely on this for anything

Reality Check gives you active liveness evidence (a server-random,
client-unpredictable Head Turn direction and Light Challenge), continuous
camera/session monitoring, and a challenge-response record. **It does not
detect or prevent a compromised client, a virtual camera, or a browser
running under a debugger/automation harness feeding it fabricated video.**
All of the analysis described in this document runs in JavaScript inside
an environment the candidate fully controls. Treat the integrity report as
one input to a human review decision, not as a pass/fail security gate on
its own.

## Testing the integration boundary

`frontend/src/realityCheck/createRealityCheckSession.test.js` and
`frontend/src/hooks/useCamera.test.js` are automated regression tests
against exactly this public contract (creation, start, session id
availability, event/challenge subscription, idempotent end, no
post-`end()` resurrection, cleanup, and — critically — that an
externally-supplied `MediaStream`'s tracks are never stopped by Reality
Check). Run them with `npm test` from `frontend/`.
