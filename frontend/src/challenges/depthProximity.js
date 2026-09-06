/**
 * Depth / Proximity Challenge (Reality Check) — pure measurement logic.
 *
 * No React, no canvas/pixel sampling here — unlike Light Challenge, this
 * challenge only needs MediaPipe's landmark geometry (already extracted by
 * useFaceLandmarker.js for every other challenge), not raw video pixels.
 * The temporal state machine (baseline capture, sustained-hold-to-pass,
 * timeout, discontinuity/pose guards) lives in useDepthProximityEngine.js,
 * mirroring headTurn.js/useChallengeEngine.js's split of "pure per-frame
 * math here, temporal orchestration in the hook".
 *
 * Explicitly out of scope, per Phase 10 instructions: no deepfake
 * probability, no risk score, no ML model, and no claim that this
 * measurement alone proves genuine 3D depth versus e.g. a 2D digital
 * zoom/scale spoof — see the Phase 10 report's "Known limitations". This
 * module returns a scale-ratio signal and a categorical PASS/FAIL
 * direction only.
 */

/**
 * Canonical landmark indices, reused from the existing, already-validated
 * ROI_LANDMARKS/CHEEK_LANDMARKS conventions (lightChallengeConstants.js,
 * headTurn.js) — same indices, redeclared locally rather than imported, per
 * each challenge module's documented independence from the others.
 */
export const DEPTH_LANDMARKS = {
  RIGHT_EYE_INNER: 133,
  LEFT_EYE_INNER: 362,
  RIGHT_CHEEK: 234,
  LEFT_CHEEK: 454
};

function normalizedToPixel(landmark, videoWidth, videoHeight) {
  return { x: landmark.x * videoWidth, y: landmark.y * videoHeight };
}

/**
 * Extracts the current frame's proximity-relevant measurements from
 * MediaPipe landmarks:
 *
 * - interocularPx: the primary proximity proxy. Under a pinhole/weak-
 *   perspective camera model, the pixel distance between two fixed facial
 *   landmarks grows roughly in inverse proportion to camera distance, so an
 *   increase indicates the face has moved closer.
 * - faceWidthPx / widthToInterocularRatio: a secondary, diagnostic-only
 *   "perspective feature" (Phase 10 spec §10D-3). If forward translation
 *   scales all facial linear dimensions uniformly, this ratio should stay
 *   roughly constant; a 2D zoom/scale spoof would plausibly do the same,
 *   so this is recorded as evidence only, never as a PASS/FAIL input.
 *
 * @returns {{interocularPx:number, faceWidthPx:number, widthToInterocularRatio:number|null}|null}
 */
export function computeDepthSample(landmarks, videoWidth, videoHeight) {
  if (!landmarks || landmarks.length < 468 || !videoWidth || !videoHeight) return null;

  const rightEye = landmarks[DEPTH_LANDMARKS.RIGHT_EYE_INNER];
  const leftEye = landmarks[DEPTH_LANDMARKS.LEFT_EYE_INNER];
  const rightCheek = landmarks[DEPTH_LANDMARKS.RIGHT_CHEEK];
  const leftCheek = landmarks[DEPTH_LANDMARKS.LEFT_CHEEK];
  if (!rightEye || !leftEye || !rightCheek || !leftCheek) return null;

  const rightEyePx = normalizedToPixel(rightEye, videoWidth, videoHeight);
  const leftEyePx = normalizedToPixel(leftEye, videoWidth, videoHeight);
  const rightCheekPx = normalizedToPixel(rightCheek, videoWidth, videoHeight);
  const leftCheekPx = normalizedToPixel(leftCheek, videoWidth, videoHeight);

  const interocularPx = Math.hypot(leftEyePx.x - rightEyePx.x, leftEyePx.y - rightEyePx.y);
  const faceWidthPx = Math.hypot(leftCheekPx.x - rightCheekPx.x, leftCheekPx.y - rightCheekPx.y);

  return {
    interocularPx,
    faceWidthPx,
    widthToInterocularRatio: interocularPx > 0 ? faceWidthPx / interocularPx : null
  };
}

/**
 * Directional evaluator, evaluated every ACTIVE frame against the
 * calibrated baseline — mirrors headTurn.js's evaluateHeadTurn() shape
 * (pure function, no temporal state) even though the underlying signal
 * (scale ratio) differs from yaw.
 *
 * @param {number|null} smoothedScaleRatio - EMA-smoothed currentInterocularPx / baselineInterocularPx
 * @param {{requiredScaleRatio:number, failScaleRatio:number}} config
 * @returns {{isCloserPass:boolean, isFartherFail:boolean, progressRatio:number}}
 */
export function evaluateDepthProgress(smoothedScaleRatio, config) {
  if (smoothedScaleRatio == null) {
    return { isCloserPass: false, isFartherFail: false, progressRatio: 0 };
  }
  const isCloserPass = smoothedScaleRatio >= config.requiredScaleRatio;
  const isFartherFail = smoothedScaleRatio <= config.failScaleRatio;
  const span = config.requiredScaleRatio - 1;
  const progressRatio = span > 0 ? Math.min(Math.max((smoothedScaleRatio - 1) / span, 0), 1) : 0;
  return { isCloserPass, isFartherFail, progressRatio };
}
