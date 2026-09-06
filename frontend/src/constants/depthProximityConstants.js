/**
 * Depth / Proximity Challenge (Reality Check) — state machine and
 * configuration constants.
 *
 * Challenge #3 in the Reality Check continuous-session challenge pool
 * (Phase 10), alongside the existing Head Turn (pose/rotation) and Light
 * Challenge (skin-reflectance/colour response). This challenge tests a
 * third, independent physical property: whether the observed face responds
 * to a "move closer to the camera" instruction with a physically plausible,
 * progressive change in apparent face scale.
 *
 * Fully additive and independent of challengeConstants.js/headTurn.js/
 * useChallengeEngine.js and lightChallengeConstants.js/lightChallenge.js/
 * useLightChallengeEngine.js — nothing here is read by or modifies those
 * code paths. The one deliberate exception is challenges/headTurn.js's
 * extractYawFromMatrix(), reused (not reimplemented) as a pose-stability
 * cross-check — see challenges/depthProximity.js.
 *
 * PROVISIONAL: every timing, ratio, and threshold constant below is a
 * placeholder needed to make the state machine runnable before any real
 * webcam calibration has happened (see the Phase 10 report's "Data
 * Collection Mode" / "Known limitations" sections). None of these values
 * have been validated against real forward-movement telemetry across
 * devices, focal lengths, lighting, or distances. Do not treat any of them
 * as tuned — change them only after capturing real baseline/movement
 * telemetry (the diagnostics exposed via useDepthProximityEngine's
 * `telemetry.measurements`) across multiple devices and subjects.
 */

export const DEPTH_PROXIMITY_STATE = {
  IDLE: 'DEPTH_IDLE',
  PREPARING: 'DEPTH_PREPARING',
  BASELINE: 'DEPTH_BASELINE',
  ACTIVE: 'DEPTH_ACTIVE',
  PASS: 'DEPTH_PASS',
  FAILED: 'DEPTH_FAILED',
  INCONCLUSIVE: 'DEPTH_INCONCLUSIVE',
  TIMEOUT: 'DEPTH_TIMEOUT'
};

/** Terminal (result) states. */
export const DEPTH_TERMINAL_STATES = [
  DEPTH_PROXIMITY_STATE.PASS,
  DEPTH_PROXIMITY_STATE.FAILED,
  DEPTH_PROXIMITY_STATE.INCONCLUSIVE,
  DEPTH_PROXIMITY_STATE.TIMEOUT
];

/**
 * Canonical landmark indices. Same indices already used/validated by
 * lightChallengeConstants.js's ROI_LANDMARKS and headTurn.js's
 * CHEEK_LANDMARKS — redeclared locally rather than imported, per each
 * challenge module's documented independence from the others.
 */
export const DEPTH_LANDMARKS = {
  RIGHT_EYE_INNER: 133,
  LEFT_EYE_INNER: 362,
  RIGHT_CHEEK: 234,
  LEFT_CHEEK: 454
};

/** PROVISIONAL — minimum valid frames required before a baseline is accepted as usable. Mirrors Light Challenge's requiredBaselineFrames convention. */
export const PROVISIONAL_REQUIRED_BASELINE_FRAMES = 20;

/**
 * PROVISIONAL — scale-ratio thresholds, expressed as
 * currentInterocularPx / baselineInterocularPx. Interocular pixel distance
 * grows roughly in inverse proportion to camera distance under a
 * pinhole/weak-perspective camera model, so a ratio > 1 indicates the face
 * has moved closer. Not yet calibrated against real focal lengths/webcam
 * fields of view — see the Phase 10 report.
 */
export const PROVISIONAL_REQUIRED_SCALE_RATIO = 1.25; // must reach >= 25% larger than baseline to PASS
export const PROVISIONAL_MOVEMENT_START_RATIO = 1.08; // smallest change counted as "movement has begun" (timing measurement only, not a decision threshold)
export const PROVISIONAL_FAIL_SCALE_RATIO = 0.85; // sustained <= this (moved away) -> FAILED

/** PROVISIONAL — sustained-hold requirement once a scale-ratio threshold is reached. Mirrors headTurn.js's requiredHoldDurationMs/minConsecutiveFrames convention (temporal shape, not an instantaneous check). */
export const PROVISIONAL_REQUIRED_HOLD_DURATION_MS = 200;
export const PROVISIONAL_MIN_CONSECUTIVE_FRAMES = 5;

/**
 * PROVISIONAL — temporal-shape guards, so a single-frame jump (e.g. a
 * spliced/substituted frame, or a tracking glitch) cannot be mistaken for
 * genuine gradual physical movement. A PASS reached while either guard is
 * violated is downgraded to INCONCLUSIVE rather than asserted as a clean
 * pass — never silently upgraded to a confident result.
 */
export const PROVISIONAL_MIN_MOVEMENT_DURATION_MS = 400;
export const PROVISIONAL_MIN_TRANSITION_FRAMES = 8;
export const PROVISIONAL_MAX_PER_FRAME_SCALE_JUMP = 0.15; // max plausible |scaleRatio(t) - scaleRatio(t-1)| between consecutive frames

/**
 * PROVISIONAL — head-pose stability guard. Reuses headTurn.js's yaw
 * extraction (not reimplemented) so a large simultaneous head turn isn't
 * mistaken for camera-relative proximity change (a rotating face's
 * landmarks also shift scale/spacing somewhat). A PASS reached while this
 * is exceeded is downgraded to INCONCLUSIVE.
 */
export const PROVISIONAL_MAX_POSE_DELTA_DEG = 12;

/**
 * PROVISIONAL — "already too close" baseline guard. If the baseline
 * interocular distance already occupies more than this fraction of the
 * video frame's width, there is likely not enough room left in frame for a
 * further forward movement to be measured reliably before the face leaves
 * frame or the camera can no longer focus.
 */
export const PROVISIONAL_MAX_BASELINE_INTEROCULAR_TO_WIDTH_RATIO = 0.35;

/** Grace period (ms) for transient 0-face detector flicker. Same value as Light Challenge's LIGHT_FACE_LOSS_GRACE_MS, kept as its own constant per each engine's independence convention. */
export const DEPTH_FACE_LOSS_GRACE_MS = 400;

/** PROVISIONAL — EMA smoothing factor for the scale-ratio signal. Mirrors headTurn.js's smoothingAlpha convention for yaw. */
export const PROVISIONAL_SMOOTHING_ALPHA = 0.35;

/** PROVISIONAL — overall per-attempt timeout budget (seconds). A deliberate forward movement plus a brief hold plausibly takes longer than a head turn's rotation, so this is somewhat longer than Head Turn's/Light's 6.0s. Must stay comfortably under the backend's authoritative challengeTimeoutMs (45s dev/prod — see backend/app/config.py) or a slow-but-genuine attempt could be downgraded server-side to TIMEOUT before the client even declares it. */
export const PROVISIONAL_ATTEMPT_TIMEOUT_SECONDS = 9.0;

export const DEPTH_PROXIMITY_CONFIG = {
  requiredBaselineFrames: PROVISIONAL_REQUIRED_BASELINE_FRAMES,
  requiredScaleRatio: PROVISIONAL_REQUIRED_SCALE_RATIO,
  movementStartRatio: PROVISIONAL_MOVEMENT_START_RATIO,
  failScaleRatio: PROVISIONAL_FAIL_SCALE_RATIO,
  requiredHoldDurationMs: PROVISIONAL_REQUIRED_HOLD_DURATION_MS,
  minConsecutiveFrames: PROVISIONAL_MIN_CONSECUTIVE_FRAMES,
  minMovementDurationMs: PROVISIONAL_MIN_MOVEMENT_DURATION_MS,
  minTransitionFrames: PROVISIONAL_MIN_TRANSITION_FRAMES,
  maxPerFrameScaleJump: PROVISIONAL_MAX_PER_FRAME_SCALE_JUMP,
  maxPoseDeltaDeg: PROVISIONAL_MAX_POSE_DELTA_DEG,
  maxBaselineInterocularToWidthRatio: PROVISIONAL_MAX_BASELINE_INTEROCULAR_TO_WIDTH_RATIO,
  faceLossGraceMs: DEPTH_FACE_LOSS_GRACE_MS,
  smoothingAlpha: PROVISIONAL_SMOOTHING_ALPHA,
  timeoutSeconds: PROVISIONAL_ATTEMPT_TIMEOUT_SECONDS
};
