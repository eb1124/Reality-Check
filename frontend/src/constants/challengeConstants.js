/**
 * Challenge state machine constants
 */
export const CHALLENGE_STATE = {
  IDLE: 'IDLE',
  PREPARING: 'PREPARING',
  BASELINE: 'BASELINE',
  CHALLENGE_ACTIVE: 'CHALLENGE_ACTIVE',
  SUCCESS: 'SUCCESS',
  TIMEOUT: 'TIMEOUT',
  INVALID: 'INVALID'
};

/**
 * Challenge type identifiers (Motion Challenge category)
 */
export const CHALLENGE_TYPES = {
  TURN_HEAD_LEFT: 'TURN_HEAD_LEFT',
  TURN_HEAD_RIGHT: 'TURN_HEAD_RIGHT'
};

/**
 * PROVISIONAL CALIBRATION THRESHOLD — NOT YET VALIDATED.
 *
 * This is a placeholder only, needed to make the matrix-based yaw challenge
 * runnable before real telemetry exists. It is NOT derived from observed
 * neutral/LEFT/RIGHT/lateral yaw ranges — those have not been measured yet.
 * Change ONLY this constant once real telemetry (see the Developer Telemetry
 * panel: raw R02/R22, extracted yaw, baseline yaw, signed delta) has been
 * captured for neutral, physical LEFT, physical RIGHT, and lateral-slide
 * conditions. Do not treat this value as calibrated.
 */
const PROVISIONAL_YAW_THRESHOLD_DEG = 15;

/**
 * Grace period (ms) for transient 0-face detector flicker during
 * CHALLENGE_ACTIVE before treating tracking loss as a real invalidation.
 * Starting value only — not yet tuned against real dropout data.
 */
export const FACE_LOSS_GRACE_MS = 400;

/**
 * Challenge configuration parameters — matrix-derived head yaw (degrees) with
 * temporal hold validation. See frontend/src/challenges/headTurn.js for the
 * yaw extraction math and sign-convention derivation.
 */
export const CHALLENGE_CONFIG = {
  [CHALLENGE_TYPES.TURN_HEAD_LEFT]: {
    id: 'TURN_HEAD_LEFT',
    category: 'MOTION',
    direction: 'LEFT',
    title: 'Turn Head Left',
    instruction: 'TURN YOUR HEAD LEFT',
    hint: 'Turn your head toward your left shoulder and hold momentarily.',
    timeoutSeconds: 6.0,
    requiredBaselineFrames: 15,
    requiredHoldDurationMs: 280, // Minimum continuous sustained hold duration in ms
    minConsecutiveFrames: 6,      // Minimum consecutive valid frames
    yawDeltaThresholdDeg: PROVISIONAL_YAW_THRESHOLD_DEG, // Matrix-derived yaw change from baseline, in degrees — SEE WARNING ABOVE
    smoothingAlpha: 0.40          // Exponential Moving Average filter factor (0 < alpha <= 1)
  },
  [CHALLENGE_TYPES.TURN_HEAD_RIGHT]: {
    id: 'TURN_HEAD_RIGHT',
    category: 'MOTION',
    direction: 'RIGHT',
    title: 'Turn Head Right',
    instruction: 'TURN YOUR HEAD RIGHT',
    hint: 'Turn your head toward your right shoulder and hold momentarily.',
    timeoutSeconds: 6.0,
    requiredBaselineFrames: 15,
    requiredHoldDurationMs: 280,
    minConsecutiveFrames: 6,
    yawDeltaThresholdDeg: PROVISIONAL_YAW_THRESHOLD_DEG, // SEE WARNING ABOVE
    smoothingAlpha: 0.40
  }
};
