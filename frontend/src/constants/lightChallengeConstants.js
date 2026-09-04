/**
 * Light Challenge (Reality Check) — state machine and configuration constants.
 *
 * MVP scope: Option 1 — skin reflectance / colour-match response. A single
 * flash colour is displayed full-viewport; the pre-flash baseline ROI pixel
 * statistics are compared against ROI statistics sampled WHILE the flash is
 * still on screen (not after it ends).
 *
 * This module is fully additive and independent of the head-turn motion
 * challenge system (challengeConstants.js, headTurn.js, useChallengeEngine.js)
 * — nothing here is read by or modifies that code path.
 *
 * PROVISIONAL: every timing, sizing, and threshold constant below is a
 * placeholder needed to make the state machine runnable before any real
 * webcam calibration has happened. None of these values have been validated
 * against real skin-reflectance measurements yet. Do not treat any of them
 * as tuned. Change them only after capturing real baseline/response
 * telemetry (exposed via useLightChallengeEngine) across multiple devices,
 * lighting conditions, and skin tones.
 */

export const LIGHT_CHALLENGE_STATE = {
  IDLE: 'LIGHT_IDLE',
  PREPARING: 'LIGHT_PREPARING',
  BASELINE: 'LIGHT_BASELINE',
  FLASH: 'LIGHT_FLASH',       // Flash on screen, settle delay — not yet sampling
  RESPONSE: 'LIGHT_RESPONSE', // Flash still on screen, actively sampling
  EVALUATE: 'LIGHT_EVALUATE', // Momentary — aggregation + rule evaluation
  PASS: 'LIGHT_PASS',
  INCONCLUSIVE: 'LIGHT_INCONCLUSIVE',
  TIMEOUT: 'LIGHT_TIMEOUT',
  INVALID: 'LIGHT_INVALID'
};

/** Terminal (result) states — used by the UI to know when to show the result card. */
export const LIGHT_TERMINAL_STATES = [
  LIGHT_CHALLENGE_STATE.PASS,
  LIGHT_CHALLENGE_STATE.INCONCLUSIVE,
  LIGHT_CHALLENGE_STATE.TIMEOUT,
  LIGHT_CHALLENGE_STATE.INVALID
];

/**
 * PROVISIONAL — flash colour used for the MVP single-colour flash.
 * Red chosen only as an initial candidate (large, well-separated R-channel
 * shift expected relative to G/B). Not validated against real footage.
 */
export const PROVISIONAL_FLASH_COLOR = { r: 255, g: 32, b: 32 };
export const PROVISIONAL_FLASH_COLOR_CSS = `rgb(${PROVISIONAL_FLASH_COLOR.r}, ${PROVISIONAL_FLASH_COLOR.g}, ${PROVISIONAL_FLASH_COLOR.b})`;

/** Which raw channel + chromaticity component the evaluator treats as "the expected direction" for this flash colour. PROVISIONAL — only correct for a red-dominant flash. */
export const PROVISIONAL_EXPECTED_RESPONSE_CHANNEL = 'r';

/**
 * PROVISIONAL — ROI patch geometry.
 * Side length of the square sampling patch, expressed as a multiple of the
 * interocular distance (distance between landmarks 133 and 362), centered
 * on cheek landmarks 234 (subject-right) / 454 (subject-left). Reuses the
 * same two anchor landmarks already used by headTurn.js's computeFaceCenterX
 * to avoid introducing new, unverified MediaPipe topology indices.
 */
export const PROVISIONAL_ROI_PATCH_SIZE_RATIO = 0.35;
export const ROI_LANDMARKS = {
  RIGHT_CHEEK: 234,
  LEFT_CHEEK: 454,
  RIGHT_EYE_INNER: 133,
  LEFT_EYE_INNER: 362
};

/** PROVISIONAL — minimum valid frames required before a baseline/response window is accepted as usable. */
export const PROVISIONAL_REQUIRED_BASELINE_FRAMES = 24;
export const PROVISIONAL_MIN_RESPONSE_FRAMES = 8;

/** PROVISIONAL — timing windows (ms). */
export const PROVISIONAL_SETTLE_DELAY_MS = 120;       // Flash on screen, not yet sampled (camera/display catch-up)
export const PROVISIONAL_RESPONSE_WINDOW_MS = 700;    // Sampled WHILE flash is active, after settle
export const PROVISIONAL_POST_FLASH_DECAY_MS = 250;   // Diagnostic-only, NOT used in the PASS decision

/** PROVISIONAL — overall per-attempt timeout budget (seconds), mirrors the head-turn challenge's timeoutSeconds convention. */
export const PROVISIONAL_ATTEMPT_TIMEOUT_SECONDS = 6.0;

/**
 * Grace period (ms) for transient 0-face detector flicker during the Light
 * Challenge. Deliberately a separate constant from the head-turn engine's
 * FACE_LOSS_GRACE_MS — this module must not read or modify that constant.
 */
export const LIGHT_FACE_LOSS_GRACE_MS = 400;

/**
 * PROVISIONAL — noise-floor multiplier: a channel/chromaticity delta must exceed
 * (multiplier x baseline stddev) to count as signal rather than sensor noise.
 * Calibrated from real telemetry: webcam AWB compresses chroma-R shifts to ~0.003–0.007
 * absolute, while baseline stddev can vary 0.005–0.013 between runs. At 3.0x the floor
 * was unreachable; even at 0.5x the variable stddev can swamp a genuine tiny shift.
 * Set to 0.1x as a minimal sanity check; bilateral same-sign agreement is the real gate.
 */
export const PROVISIONAL_NOISE_FLOOR_MULTIPLIER = 0.1;

/**
 * PROVISIONAL — confident-pass threshold (must be >= this to PASS).
 * Set to 0.3x: slightly above the noise-floor sanity check.
 * Bilateral same-sign guard is the primary protection against random-noise false-positives.
 */
export const PROVISIONAL_CONFIDENT_PASS_MULTIPLIER = 0.3;

/** PROVISIONAL — bilateral (left cheek vs right cheek) agreement tolerance. Max allowed relative difference in delta magnitude between the two ROIs while still counting as "consistent". */
export const PROVISIONAL_BILATERAL_TOLERANCE_RATIO = 0.6;

/** PROVISIONAL — pixel value saturation guard. A ROI mean at or beyond these bounds is treated as clipped/unreliable. */
export const PROVISIONAL_SATURATION_LOW = 4;
export const PROVISIONAL_SATURATION_HIGH = 251;

/** PROVISIONAL — minimum ambient (pre-flash baseline) combined luminance required before chromaticity math is considered numerically trustworthy. Below this, the attempt is INVALID ("insufficient ambient light"). */
export const PROVISIONAL_MIN_AMBIENT_LUMINANCE = 12;

/**
 * PROVISIONAL — global full-frame drift guard. If the full-frame (non-ROI)
 * reference luminance changes by more than this many times the ROI's own
 * expected-channel delta, auto-exposure/white-balance compensation is
 * suspected of dominating the measurement, and the result is downgraded to
 * INCONCLUSIVE rather than asserting a clean PASS.
 */
export const PROVISIONAL_GLOBAL_DRIFT_SUSPECT_RATIO = 1.5;

export const LIGHT_CHALLENGE_CONFIG = {
  flashColor: PROVISIONAL_FLASH_COLOR,
  flashColorCss: PROVISIONAL_FLASH_COLOR_CSS,
  expectedResponseChannel: PROVISIONAL_EXPECTED_RESPONSE_CHANNEL,
  roiPatchSizeRatio: PROVISIONAL_ROI_PATCH_SIZE_RATIO,
  requiredBaselineFrames: PROVISIONAL_REQUIRED_BASELINE_FRAMES,
  minResponseFrames: PROVISIONAL_MIN_RESPONSE_FRAMES,
  settleDelayMs: PROVISIONAL_SETTLE_DELAY_MS,
  responseWindowMs: PROVISIONAL_RESPONSE_WINDOW_MS,
  postFlashDecayMs: PROVISIONAL_POST_FLASH_DECAY_MS,
  timeoutSeconds: PROVISIONAL_ATTEMPT_TIMEOUT_SECONDS,
  faceLossGraceMs: LIGHT_FACE_LOSS_GRACE_MS,
  noiseFloorMultiplier: PROVISIONAL_NOISE_FLOOR_MULTIPLIER,
  confidentPassMultiplier: PROVISIONAL_CONFIDENT_PASS_MULTIPLIER,
  bilateralToleranceRatio: PROVISIONAL_BILATERAL_TOLERANCE_RATIO,
  saturationLow: PROVISIONAL_SATURATION_LOW,
  saturationHigh: PROVISIONAL_SATURATION_HIGH,
  minAmbientLuminance: PROVISIONAL_MIN_AMBIENT_LUMINANCE,
  globalDriftSuspectRatio: PROVISIONAL_GLOBAL_DRIFT_SUSPECT_RATIO
};
