/**
 * Canonical string-literal vocabulary for Phase 7 continuous sessions —
 * the frontend's single reference point for every enum-like string used
 * across the passive monitor, challenge scheduler, and the public
 * `createRealityCheckSession` interface (Stage 3/4).
 *
 * This project is plain JS, not TypeScript, so there is no shared type
 * package between frontend and backend. The canonical values live in
 * backend/app/continuous_types.py — that Python module is the source of
 * truth (it's what actually validates every request via Pydantic). This
 * file is the frontend mirror: if a value changes in continuous_types.py,
 * it must change here too, in the same commit, or the frontend will start
 * sending strings the backend's field_validators reject with 422.
 */

/**
 * @typedef {'CREATED'|'ACTIVE'|'ENDED'|'CANCELLED'|'ERROR'} SessionState
 * Continuous-session lifecycle. ENDED, CANCELLED, and ERROR are terminal
 * and irreversible — mirrors backend/app/continuous_models.py's
 * TERMINAL_SESSION_STATES.
 */
export const SESSION_STATES = /** @type {const} */ ([
  'CREATED', 'ACTIVE', 'ENDED', 'CANCELLED', 'ERROR'
]);
export const TERMINAL_SESSION_STATES = /** @type {const} */ (['ENDED', 'CANCELLED', 'ERROR']);

/**
 * @typedef {(
 *   'session_started'|'session_ended'|'session_cancelled'|'session_error'|
 *   'monitoring_started'|'monitoring_stopped'|
 *   'face_missing'|'face_restored'|'multiple_faces_detected'|'multiple_faces_cleared'|
 *   'landmark_discontinuity'|'frozen_frame_suspected'|
 *   'camera_track_ended'|'camera_stream_interrupted'|'camera_device_changed'|
 *   'challenge_requested'|'challenge_started'|'challenge_passed'|
 *   'challenge_failed'|'challenge_aborted'|'challenge_timeout'|
 *   'risk_state_changed'|'technical_error'
 * )} EventType
 * Fixed vocabulary — see Phase 7 spec §5. Must exactly match
 * backend/app/continuous_types.py's EVENT_TYPES tuple (validated there via
 * a Pydantic field_validator; an unrecognized value is rejected with 422).
 */
export const EVENT_TYPES = /** @type {const} */ ([
  'session_started', 'session_ended', 'session_cancelled', 'session_error',
  'monitoring_started', 'monitoring_stopped',
  'face_missing', 'face_restored', 'multiple_faces_detected', 'multiple_faces_cleared',
  'landmark_discontinuity', 'frozen_frame_suspected',
  'camera_track_ended', 'camera_stream_interrupted', 'camera_device_changed',
  'challenge_requested', 'challenge_started', 'challenge_passed',
  'challenge_failed', 'challenge_aborted', 'challenge_timeout',
  'risk_state_changed', 'technical_error'
]);

/**
 * @typedef {'info'|'warning'|'suspicious'|'error'} Severity
 */
export const SEVERITIES = /** @type {const} */ (['info', 'warning', 'suspicious', 'error']);

/**
 * @typedef {'TURN_HEAD_LEFT'|'TURN_HEAD_RIGHT'|'LIGHT'|'DEPTH_PROXIMITY'} ChallengeType
 * TURN_HEAD_LEFT/TURN_HEAD_RIGHT reuse the existing
 * constants/challengeConstants.js CHALLENGE_TYPES values verbatim — Phase 7
 * does not introduce a new challenge type. DEPTH_PROXIMITY ("move closer to
 * the camera") is added in Phase 10 — see
 * constants/depthProximityConstants.js.
 */
export const CHALLENGE_TYPES = /** @type {const} */ (['TURN_HEAD_LEFT', 'TURN_HEAD_RIGHT', 'LIGHT', 'DEPTH_PROXIMITY']);

/**
 * @typedef {'RANDOM'|'EVENT'} ChallengeTrigger
 */
export const CHALLENGE_TRIGGERS = /** @type {const} */ (['RANDOM', 'EVENT']);

/**
 * @typedef {'PENDING'|'PASSED'|'FAILED'|'TIMEOUT'|'ABORTED'} ChallengeStatus
 * PENDING is server-only (the state a freshly-issued challenge starts in);
 * the client only ever reports one of CHALLENGE_CLIENT_OUTCOMES.
 */
export const CHALLENGE_STATUSES = /** @type {const} */ (['PENDING', 'PASSED', 'FAILED', 'TIMEOUT', 'ABORTED']);

/** @typedef {'PASSED'|'FAILED'|'TIMEOUT'|'ABORTED'} ChallengeOutcome */
export const CHALLENGE_CLIENT_OUTCOMES = /** @type {const} */ (['PASSED', 'FAILED', 'TIMEOUT', 'ABORTED']);

/**
 * @typedef {'LOW_RISK'|'REVIEW_RECOMMENDED'|'INCONCLUSIVE'} RiskState
 * INCONCLUSIVE means "we cannot say", not "high risk" — see
 * backend/app/risk.py's module docstring. UI copy must not treat it as a
 * risk tier.
 */
export const RISK_STATES = /** @type {const} */ (['LOW_RISK', 'REVIEW_RECOMMENDED', 'INCONCLUSIVE']);

/**
 * @typedef {Object} ChallengeResultSubmission
 * The exact shape POSTed to
 * `/sessions/continuous/{sessionId}/challenges/{challengeId}/result`
 * (see backend/app/continuous_schemas.py's ChallengeResultRequest).
 * @property {string} nonce - Must match the nonce issued with this challenge.
 * @property {ChallengeOutcome} outcome
 * @property {Object|null} [detail] - Free-form diagnostic detail (e.g. challenge telemetry summary).
 */

/**
 * @typedef {Object} NextChallenge
 * The shape returned by `GET /sessions/continuous/{sessionId}/next-challenge`
 * when a challenge is issued.
 * @property {string} challengeId
 * @property {ChallengeType} type
 * @property {string} nonce
 * @property {string} expiresAt - ISO 8601 UTC.
 */

/**
 * @typedef {Object} NoNextChallenge
 * The shape returned when no challenge is issued yet.
 * @property {true} none
 * @property {number|null} retryAfterMs
 * @property {string} reason - e.g. "COOLDOWN", "CHALLENGE_IN_FLIGHT", "MAX_CHALLENGES_REACHED".
 */
