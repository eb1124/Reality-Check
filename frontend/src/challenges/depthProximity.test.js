import { describe, it, expect } from 'vitest';
import { computeDepthSample, evaluateDepthProgress, DEPTH_LANDMARKS } from './depthProximity';

function makeLandmarks(overrides) {
  const landmarks = Array.from({ length: 468 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [index, point] of Object.entries(overrides)) {
    landmarks[index] = point;
  }
  return landmarks;
}

describe('computeDepthSample', () => {
  it('returns null when landmarks are missing or too short', () => {
    expect(computeDepthSample(null, 1000, 800)).toBeNull();
    expect(computeDepthSample([{ x: 0, y: 0 }], 1000, 800)).toBeNull();
  });

  it('returns null when video dimensions are not yet available', () => {
    const landmarks = makeLandmarks({
      [DEPTH_LANDMARKS.RIGHT_EYE_INNER]: { x: 0.4, y: 0.5 },
      [DEPTH_LANDMARKS.LEFT_EYE_INNER]: { x: 0.6, y: 0.5 }
    });
    expect(computeDepthSample(landmarks, 0, 0)).toBeNull();
  });

  it('computes interocular and face-width pixel distances from normalized landmarks', () => {
    const landmarks = makeLandmarks({
      [DEPTH_LANDMARKS.RIGHT_EYE_INNER]: { x: 0.4, y: 0.5 },
      [DEPTH_LANDMARKS.LEFT_EYE_INNER]: { x: 0.6, y: 0.5 },
      [DEPTH_LANDMARKS.RIGHT_CHEEK]: { x: 0.2, y: 0.5 },
      [DEPTH_LANDMARKS.LEFT_CHEEK]: { x: 0.8, y: 0.5 }
    });

    const sample = computeDepthSample(landmarks, 1000, 800);
    expect(sample.interocularPx).toBeCloseTo(200, 5);
    expect(sample.faceWidthPx).toBeCloseTo(600, 5);
    expect(sample.widthToInterocularRatio).toBeCloseTo(3, 5);
  });

  it('a uniform forward-movement scale-up (all four landmarks move symmetrically outward) increases interocularPx proportionally', () => {
    const near = (spread) =>
      makeLandmarks({
        [DEPTH_LANDMARKS.RIGHT_EYE_INNER]: { x: 0.5 - spread * 0.1, y: 0.5 },
        [DEPTH_LANDMARKS.LEFT_EYE_INNER]: { x: 0.5 + spread * 0.1, y: 0.5 },
        [DEPTH_LANDMARKS.RIGHT_CHEEK]: { x: 0.5 - spread * 0.3, y: 0.5 },
        [DEPTH_LANDMARKS.LEFT_CHEEK]: { x: 0.5 + spread * 0.3, y: 0.5 }
      });

    const baselineSample = computeDepthSample(near(1), 1000, 800);
    const closerSample = computeDepthSample(near(1.25), 1000, 800);

    expect(closerSample.interocularPx / baselineSample.interocularPx).toBeCloseTo(1.25, 5);
    // The perspective feature (width/interocular ratio) stays constant under
    // a pure uniform scale — this is precisely why it is documented as
    // diagnostic-only, not a PASS/FAIL input: a 2D zoom spoof would produce
    // the same invariance.
    expect(closerSample.widthToInterocularRatio).toBeCloseTo(baselineSample.widthToInterocularRatio, 5);
  });
});

describe('evaluateDepthProgress', () => {
  const config = { requiredScaleRatio: 1.25, failScaleRatio: 0.85 };

  it('treats a null ratio as no signal', () => {
    expect(evaluateDepthProgress(null, config)).toEqual({ isCloserPass: false, isFartherFail: false, progressRatio: 0 });
  });

  it('passes once the ratio reaches the required threshold', () => {
    const result = evaluateDepthProgress(1.3, config);
    expect(result.isCloserPass).toBe(true);
    expect(result.isFartherFail).toBe(false);
  });

  it('flags moving away once the ratio drops to the fail threshold', () => {
    const result = evaluateDepthProgress(0.8, config);
    expect(result.isFartherFail).toBe(true);
    expect(result.isCloserPass).toBe(false);
  });

  it('does not pass or fail in the neutral band between thresholds', () => {
    const result = evaluateDepthProgress(1.0, config);
    expect(result.isCloserPass).toBe(false);
    expect(result.isFartherFail).toBe(false);
  });

  it('computes progress toward the required ratio', () => {
    expect(evaluateDepthProgress(1.1, config).progressRatio).toBeCloseTo(0.4, 5);
    expect(evaluateDepthProgress(1.25, config).progressRatio).toBeCloseTo(1, 5);
    expect(evaluateDepthProgress(0.5, config).progressRatio).toBe(0); // clamped, not negative
  });
});
