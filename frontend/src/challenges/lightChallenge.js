/**
 * Light Challenge (Reality Check) — pure measurement & evaluation logic.
 *
 * No React, no DOM access here (the sampling canvas lives in
 * useLightChallengeEngine.js). This module only turns already-extracted
 * Canvas2D ImageData and MediaPipe landmarks into the measurement vectors,
 * aggregates, deltas, and PASS/INCONCLUSIVE decision described in the
 * approved Light Challenge technical design.
 *
 * Explicitly out of scope, per design: no deepfake probability, no risk
 * score, no ML model. The evaluator below returns a categorical
 * PASS/INCONCLUSIVE outcome plus a human-readable reason string only.
 *
 * Independent of, and not read by, the head-turn motion challenge code
 * (headTurn.js / headTurnLeft.js / useChallengeEngine.js).
 */

import { ROI_LANDMARKS } from '../constants/lightChallengeConstants';

/**
 * Converts a MediaPipe normalized landmark ({x,y} in [0,1]) to pixel
 * coordinates in the source video's resolution.
 */
function normalizedToPixel(landmark, videoWidth, videoHeight) {
  return { x: landmark.x * videoWidth, y: landmark.y * videoHeight };
}

/**
 * Computes the left/right cheek ROI pixel rects for the current frame.
 * Reuses landmarks 234/454 (already validated/used by headTurn.js's
 * computeFaceCenterX) as ROI centers, sized relative to interocular
 * distance so the patch scales with face-to-camera distance.
 *
 * @returns {{ right: {x,y,w,h}, left: {x,y,w,h}, interocularPx: number } | null}
 */
export function computeCheekROIs(landmarks, videoWidth, videoHeight, config) {
  if (!landmarks || landmarks.length < 468 || !videoWidth || !videoHeight) return null;

  const rightCheek = landmarks[ROI_LANDMARKS.RIGHT_CHEEK];
  const leftCheek = landmarks[ROI_LANDMARKS.LEFT_CHEEK];
  const rightEye = landmarks[ROI_LANDMARKS.RIGHT_EYE_INNER];
  const leftEye = landmarks[ROI_LANDMARKS.LEFT_EYE_INNER];
  if (!rightCheek || !leftCheek || !rightEye || !leftEye) return null;

  const rightEyePx = normalizedToPixel(rightEye, videoWidth, videoHeight);
  const leftEyePx = normalizedToPixel(leftEye, videoWidth, videoHeight);
  const interocularPx = Math.hypot(leftEyePx.x - rightEyePx.x, leftEyePx.y - rightEyePx.y);
  const side = Math.min(
    Math.max(4, interocularPx * config.roiPatchSizeRatio),
    Math.min(videoWidth, videoHeight)
  );

  const rightCheekPx = normalizedToPixel(rightCheek, videoWidth, videoHeight);
  const leftCheekPx = normalizedToPixel(leftCheek, videoWidth, videoHeight);

  const clampRect = (cx, cy) => {
    let x = cx - side / 2;
    let y = cy - side / 2;
    x = Math.max(0, Math.min(x, videoWidth - side));
    y = Math.max(0, Math.min(y, videoHeight - side));
    return { x: Math.round(x), y: Math.round(y), w: Math.round(side), h: Math.round(side) };
  };

  return {
    right: clampRect(rightCheekPx.x, rightCheekPx.y),
    left: clampRect(leftCheekPx.x, leftCheekPx.y),
    interocularPx
  };
}

/**
 * Reduces a Canvas2D ImageData patch to a single measurement vector.
 * Gamma-encoded (sRGB) averaging — no linearization — per MVP scope;
 * flagged PROVISIONAL in the design doc pending empirical comparison.
 *
 * @param {ImageData} imageData
 * @returns {{meanR:number, meanG:number, meanB:number, luminance:number, chromaR:number, chromaG:number, clippedRatio:number, pixelCount:number}}
 */
export function measureImageData(imageData) {
  const data = imageData.data;
  const pixelCount = data.length / 4;
  let sumR = 0, sumG = 0, sumB = 0, clipped = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    sumR += r; sumG += g; sumB += b;
    if ((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)) {
      clipped += 1;
    }
  }

  const meanR = pixelCount > 0 ? sumR / pixelCount : 0;
  const meanG = pixelCount > 0 ? sumG / pixelCount : 0;
  const meanB = pixelCount > 0 ? sumB / pixelCount : 0;
  // Rec.709 luma weights (matches sRGB primaries). PROVISIONAL vs Rec.601 — unconfirmed against real footage.
  const luminance = 0.2126 * meanR + 0.7152 * meanG + 0.0722 * meanB;
  const channelSum = meanR + meanG + meanB;
  const chromaR = channelSum > 0 ? meanR / channelSum : 0;
  const chromaG = channelSum > 0 ? meanG / channelSum : 0;

  return {
    meanR, meanG, meanB, luminance, chromaR, chromaG,
    clippedRatio: pixelCount > 0 ? clipped / pixelCount : 0,
    pixelCount
  };
}

const AGGREGATE_FIELDS = ['meanR', 'meanG', 'meanB', 'luminance', 'chromaR', 'chromaG'];

/**
 * Aggregates a window of per-frame measurement vectors into a mean (trimmed,
 * to reduce sensitivity to single-frame outliers/flicker) and a stddev
 * (computed over the full, untrimmed window — used as the noise floor).
 *
 * @param {Array<object>} samples - per-frame measureImageData() outputs
 * @param {number} trimRatio - fraction trimmed from each tail (PROVISIONAL, default 0.1)
 */
export function aggregateMeasurements(samples, trimRatio = 0.1) {
  if (!samples || samples.length === 0) return null;

  const mean = {};
  const stddev = {};

  for (const field of AGGREGATE_FIELDS) {
    const values = samples.map((s) => s[field]).sort((a, b) => a - b);
    const trimCount = Math.floor(values.length * trimRatio);
    let lo = trimCount, hi = values.length - trimCount;
    if (hi <= lo) { lo = 0; hi = values.length; }
    const kept = values.slice(lo, hi);
    const m = kept.reduce((acc, v) => acc + v, 0) / kept.length;
    mean[field] = m;

    const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
    stddev[field] = Math.sqrt(variance);
  }

  const avgClippedRatio = samples.reduce((acc, s) => acc + (s.clippedRatio || 0), 0) / samples.length;

  return { mean, stddev, frameCount: samples.length, clippedRatio: avgClippedRatio };
}

/**
 * Computes absolute and baseline-luminance-relative deltas between two
 * aggregates (response vs baseline).
 */
export function computeDelta(baselineAgg, responseAgg) {
  const delta = {};
  const relativeDelta = {};
  const baselineLuminance = baselineAgg.mean.luminance;

  for (const field of AGGREGATE_FIELDS) {
    const d = responseAgg.mean[field] - baselineAgg.mean[field];
    delta[field] = d;
    relativeDelta[field] = baselineLuminance > 0 ? d / baselineLuminance : 0;
  }

  return { delta, relativeDelta };
}

function isSaturated(meanVector, config) {
  return (
    meanVector.meanR <= config.saturationLow || meanVector.meanR >= config.saturationHigh ||
    meanVector.meanG <= config.saturationLow || meanVector.meanG >= config.saturationHigh ||
    meanVector.meanB <= config.saturationLow || meanVector.meanB >= config.saturationHigh
  );
}

/**
 * PASS / INCONCLUSIVE rule evaluator. Deterministic threshold checks only —
 * no probability, no risk score, no ML model. Returns a categorical outcome
 * plus a human-readable reason and the full numeric breakdown (for
 * telemetry/calibration, not for any additional automated decision).
 *
 * Requires BOTH an illumination-channel shift AND a chromaticity shift in
 * the expected direction (not brightness alone), per design.
 */
export function evaluateLightResponse({
  channel,
  baselineCombined,
  responseCombined,
  baselineLeft,
  responseLeft,
  baselineRight,
  responseRight,
  fullFrameBaseline,
  fullFrameResponse,
  config
}) {
  const chromaField = channel === 'g' ? 'chromaG' : 'chromaR';
  const rawField = channel === 'g' ? 'meanG' : channel === 'b' ? 'meanB' : 'meanR';

  const { delta: deltaCombined, relativeDelta: relDeltaCombined } = computeDelta(baselineCombined, responseCombined);
  const { delta: deltaLeft } = computeDelta(baselineLeft, responseLeft);
  const { delta: deltaRight } = computeDelta(baselineRight, responseRight);

  const details = {
    deltaCombined,
    relativeDeltaCombined: relDeltaCombined,
    deltaLeft,
    deltaRight
  };

  if (isSaturated(baselineCombined.mean, config) || isSaturated(responseCombined.mean, config)) {
    return { outcome: 'INCONCLUSIVE', reason: 'ROI pixel values saturated/clipped during baseline or response window — measurement unreliable.', details, score: 0 };
  }

  if (baselineCombined.mean.luminance < config.minAmbientLuminance) {
    return { outcome: 'INCONCLUSIVE', reason: 'Ambient (pre-flash) luminance below the minimum trustworthy floor.', details, score: 0 };
  }

  const chromaDelta = deltaCombined[chromaField];
  const rawRelDelta = relDeltaCombined[rawField];
  const directionOk = chromaDelta > 0 && rawRelDelta > 0;

  if (!directionOk) {
    return { outcome: 'INCONCLUSIVE', reason: 'No colour/chromaticity shift in the expected direction for this flash colour.', details, score: 0 };
  }

  const baselineStddevChroma = baselineCombined.stddev[chromaField] || 0;
  const noiseFloor = baselineStddevChroma * config.noiseFloorMultiplier;
  const confidentThreshold = baselineStddevChroma * config.confidentPassMultiplier;
  details.noiseFloor = noiseFloor;
  details.confidentThreshold = confidentThreshold;

  if (Math.abs(chromaDelta) <= noiseFloor) {
    return { outcome: 'INCONCLUSIVE', reason: 'Response delta did not exceed the baseline noise floor.', details, score: 0 };
  }

  const leftChroma = deltaLeft[chromaField];
  const rightChroma = deltaRight[chromaField];
  const bilateralSameSign = (leftChroma >= 0) === (rightChroma >= 0);
  const largerMag = Math.max(Math.abs(leftChroma), Math.abs(rightChroma));
  const smallerMag = Math.min(Math.abs(leftChroma), Math.abs(rightChroma));
  const bilateralMagRatio = largerMag > 0 ? smallerMag / largerMag : 1;
  // Magnitude-ratio requirement intentionally removed — controlled testing showed
  // cross-side chroma-R magnitude for a screen-based flash tracks the subject's
  // physical position/orientation relative to the screen, not liveness (real
  // same-sign responses were observed with ratios as low as ~0.13). Same-sign
  // agreement remains the bilateral consistency gate; bilateralMagRatio is still
  // computed and reported below for diagnostics only.
  const bilateralConsistent = bilateralSameSign;
  details.bilateralMagRatio = bilateralMagRatio;
  details.bilateralSameSign = bilateralSameSign;

  if (!bilateralConsistent) {
    return { outcome: 'INCONCLUSIVE', reason: 'Left/right cheek response inconsistent (asymmetric — possible localized artifact rather than global skin response).', details, score: 0 };
  }

  const globalDelta = fullFrameResponse.mean.luminance - fullFrameBaseline.mean.luminance;
  const globalDriftSuspect =
    Math.abs(deltaCombined.luminance) > 0 &&
    Math.abs(globalDelta) > Math.abs(deltaCombined.luminance) * config.globalDriftSuspectRatio;
  details.globalDelta = globalDelta;
  details.globalDriftSuspect = globalDriftSuspect;

  if (globalDriftSuspect) {
    // score: 0 here is defensive, not the primary protection — a suspected
    // AWB/exposure confound is properly handled as a VALIDITY problem (see
    // useLightChallengeEngine.js's cameraControlGate), which zeroes this
    // attempt's influence on fusion regardless of what score it carries.
    return { outcome: 'INCONCLUSIVE', reason: 'Full-frame reference shows a large simultaneous shift — possible auto-exposure/white-balance compensation dominating the local signal.', details, score: 0 };
  }

  if (Math.abs(chromaDelta) <= confidentThreshold) {
    return {
      outcome: 'INCONCLUSIVE',
      reason: 'Directionally-correct response observed but below the confident-pass magnitude.',
      details,
      score: continuousScore(chromaDelta, noiseFloor, confidentThreshold)
    };
  }

  return {
    outcome: 'PASS',
    reason: 'Directionally-consistent, bilateral, above-noise-floor colour/chromaticity response observed while the flash was active.',
    details,
    score: continuousScore(chromaDelta, noiseFloor, confidentThreshold)
  };
}

/**
 * Phase 11 — continuous [0,1] evidence score, derived from the SAME
 * already-computed values the categorical evaluator above uses for its
 * final PASS/INCONCLUSIVE threshold check (chromaDelta vs noiseFloor vs
 * confidentThreshold) — not a new/independent measurement, and not an
 * invented precision figure. Score convention: 1.0 = strong evidence of a
 * genuine liveness response, 0.0 = evidence inconsistent with one (see
 * backend/app/fusion.py's module docstring for the shared convention this
 * feeds). Every categorical gate above that returns INCONCLUSIVE for a
 * structural reason unrelated to magnitude (saturation, insufficient
 * ambient light, no directional shift, bilateral inconsistency, suspected
 * AWB/exposure drift) has ALREADY returned before reaching this function,
 * with no `score` field at all — those callers must treat a missing score
 * as 0 (see useLightChallengeEngine.js). This function only ever runs once
 * the direction/bilateral/saturation/drift gates have all already passed,
 * so it only has to grade "how far below/above the confident-pass
 * magnitude was the response" — a linear ramp from the noise floor (0) to
 * twice the confident-pass threshold (1), clamped. PROVISIONAL: the "2x"
 * multiplier is an unvalidated placeholder, not a calibrated curve.
 */
function continuousScore(chromaDelta, noiseFloor, confidentThreshold) {
  const magnitude = Math.abs(chromaDelta);
  if (magnitude <= noiseFloor) return 0;
  const span = confidentThreshold * 2 - noiseFloor;
  if (span <= 0) return magnitude > noiseFloor ? 1 : 0;
  return Math.max(0, Math.min(1, (magnitude - noiseFloor) / span));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Phase 11 — per-attempt Light validity (v_light), computed entirely from
 * real, already-measured capture-quality signals — never a constant (see
 * backend/app/fusion.py's module docstring for how this feeds fusion).
 *
 * Four independent gates, each graded [0,1] rather than a hard 0/1 cliff
 * where the underlying signal is itself continuous (screen contribution,
 * face coverage, delivered FPS), combined multiplicatively so any single
 * badly-failing dimension collapses overall validity toward 0 rather than
 * being averaged away by three good ones — a session shouldn't get credit
 * for "3 out of 4 quality checks passed" when the 4th means the
 * measurement isn't trustworthy at all.
 *
 *   screenContributionGate — relative luminance increase from the neutral
 *     baseline to the flash-response window (relativeDeltaCombined.luminance,
 *     already computed by evaluateLightResponse — not a separate dark/bright
 *     reference capture; see lightChallengeConstants.js's module comment on
 *     why this is a lightweight reuse of an existing measurement rather than
 *     a new two-step illumination sequence). Below
 *     config.minScreenContributionRatio, the screen isn't meaningfully
 *     affecting what the camera sees relative to ambient light.
 *   faceCoverageGate — mean interocular-distance/min(frame dimension) ratio
 *     across the response window (frame-relative, not absolute pixels).
 *   fpsGate — frames actually sampled during the response window divided by
 *     its real elapsed time (not the camera's requested/nominal FPS).
 *   cameraControlGate — this codebase does not attempt manual camera
 *     white-balance/exposure control (see useCamera.js — plain getUserMedia
 *     constraints only), and MediaStreamTrack manual AWB/exposure control is
 *     unreliable across browsers/devices even where attempted (per the
 *     Phase 11 brief — do not trust applyConstraints() resolving as proof of
 *     anything). The one thing actually verifiable is the EFFECT: if the
 *     full-frame reference shows a large simultaneous shift alongside the
 *     ROI response (globalDriftSuspect, already computed by
 *     evaluateLightResponse), auto-exposure/white-balance compensation is
 *     suspected of confounding the measurement, and this gate drops to 0 for
 *     the attempt. This detection-based check is this implementation's
 *     compensation path (see the Phase 11 brief's "reliable compensation
 *     path" language) — there is no manual-control path to fall back to.
 */
export function computeLightValidity({ deliveredFps, faceCoverageRatio, screenContributionRatio, globalDriftSuspect, config }) {
  const screenContributionGate = clamp01(screenContributionRatio / config.minScreenContributionRatio);
  const faceCoverageGate = clamp01(faceCoverageRatio / config.minFaceCoverageRatio);
  const fpsGate = clamp01(deliveredFps / config.minDeliveredFps);
  const cameraControlGate = globalDriftSuspect ? 0 : 1;

  const validity = screenContributionGate * faceCoverageGate * fpsGate * cameraControlGate;

  return {
    validity,
    diagnostics: {
      deliveredFps: Math.round(deliveredFps * 10) / 10,
      faceCoverage: Math.round(faceCoverageRatio * 1000) / 1000,
      screenContribution: Math.round(screenContributionRatio * 1000) / 1000,
      cameraControlMode: 'AUTO_UNVERIFIED',
      screenContributionGate: Math.round(screenContributionGate * 100) / 100,
      faceCoverageGate: Math.round(faceCoverageGate * 100) / 100,
      fpsGate: Math.round(fpsGate * 100) / 100,
      cameraControlGate
    }
  };
}
