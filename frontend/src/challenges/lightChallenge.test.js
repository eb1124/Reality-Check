import { describe, it, expect } from 'vitest';
import { evaluateLightResponse, computeLightValidity } from './lightChallenge';
import { LIGHT_CHALLENGE_CONFIG } from '../constants/lightChallengeConstants';

// Non-saturated, non-zero defaults (isSaturated() would otherwise trigger
// on an all-zero meanG/meanB, which real aggregateMeasurements() output
// never produces but a hand-built test fixture can if not careful).
function aggregate(overrides = {}, stddevOverrides = {}) {
  return {
    mean: { meanR: 80, meanG: 80, meanB: 80, luminance: 80, chromaR: 0.333, chromaG: 0.333, ...overrides },
    stddev: { meanR: 1, meanG: 1, meanB: 1, luminance: 1, chromaR: 0.01, chromaG: 0.01, ...stddevOverrides }
  };
}

const CONFIG = LIGHT_CHALLENGE_CONFIG;

// A realistic-shaped "clean, confident PASS" fixture: R channel and its
// chromaticity both rise from baseline to response, in the same direction,
// bilaterally consistent, with a small baseline noise floor and no
// full-frame drift.
function confidentPassArgs(overrides = {}) {
  return {
    channel: 'r',
    baselineCombined: aggregate({ meanR: 80, luminance: 80, chromaR: 0.34 }, { chromaR: 0.01 }),
    responseCombined: aggregate({ meanR: 90, luminance: 81, chromaR: 0.40 }),
    baselineLeft: aggregate({ chromaR: 0.34 }),
    responseLeft: aggregate({ chromaR: 0.40 }),
    baselineRight: aggregate({ chromaR: 0.34 }),
    responseRight: aggregate({ chromaR: 0.40 }),
    fullFrameBaseline: aggregate({ luminance: 50 }),
    fullFrameResponse: aggregate({ luminance: 50.3 }),
    config: CONFIG,
    ...overrides
  };
}

describe('evaluateLightResponse — continuous score (Phase 11)', () => {
  it('a confident PASS carries a score of 1.0 (well above 2x the confident threshold)', () => {
    const result = evaluateLightResponse(confidentPassArgs());
    expect(result.outcome).toBe('PASS');
    expect(result.score).toBe(1);
  });

  it('score is 0 whenever the categorical outcome fails a structural gate (no directional shift)', () => {
    const result = evaluateLightResponse(
      confidentPassArgs({
        responseCombined: aggregate({ meanR: 80, luminance: 81, chromaR: 0.30 }) // chromaR went DOWN, not up
      })
    );
    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.score).toBe(0);
  });

  it('score is 0 when the response does not exceed the baseline noise floor', () => {
    const result = evaluateLightResponse(
      confidentPassArgs({
        baselineCombined: aggregate({ meanR: 80, luminance: 80, chromaR: 0.34 }, { chromaR: 0.05 }), // high stddev -> high noise floor
        responseCombined: aggregate({ meanR: 80.2, luminance: 80.1, chromaR: 0.341 })
      })
    );
    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.score).toBe(0);
  });

  it('score is graded (strictly between 0 and 1) for a directionally-correct but weak response', () => {
    const result = evaluateLightResponse(
      confidentPassArgs({
        baselineCombined: aggregate({ meanR: 80, luminance: 80, chromaR: 0.34 }, { chromaR: 0.01 }),
        responseCombined: aggregate({ meanR: 80.5, luminance: 80.1, chromaR: 0.342 }), // small, above noise floor, below confident threshold
        baselineLeft: aggregate({ chromaR: 0.34 }),
        responseLeft: aggregate({ chromaR: 0.342 }),
        baselineRight: aggregate({ chromaR: 0.34 }),
        responseRight: aggregate({ chromaR: 0.342 }),
        // No full-frame drift, so the (much larger, relatively) global-drift
        // guard doesn't intercept this before the magnitude check below runs.
        fullFrameBaseline: aggregate({ luminance: 50 }),
        fullFrameResponse: aggregate({ luminance: 50 })
      })
    );
    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });
});

describe('computeLightValidity (Phase 11)', () => {
  const good = {
    deliveredFps: 30,
    faceCoverageRatio: 0.2,
    screenContributionRatio: 0.1,
    globalDriftSuspect: false,
    config: CONFIG
  };

  it('is 1.0 when every gate clears its threshold comfortably', () => {
    const { validity } = computeLightValidity(good);
    expect(validity).toBe(1);
  });

  it('degrades toward 0 as delivered FPS falls below the minimum (Step 4D)', () => {
    const { validity, diagnostics } = computeLightValidity({ ...good, deliveredFps: 8 });
    expect(validity).toBeLessThan(1);
    expect(validity).toBeGreaterThanOrEqual(0);
    expect(diagnostics.deliveredFps).toBe(8);
  });

  it('collapses toward 0 when face coverage is far below the minimum (Step 4C)', () => {
    const { validity } = computeLightValidity({ ...good, faceCoverageRatio: 0.001 });
    expect(validity).toBeLessThan(0.05);
  });

  it('collapses toward 0 when the screen does not meaningfully affect observed brightness (Step 4A)', () => {
    const { validity } = computeLightValidity({ ...good, screenContributionRatio: 0.0001 });
    expect(validity).toBeLessThan(0.05);
  });

  it('is exactly 0 when a global luminance drift is suspected, regardless of the other gates (Step 4B)', () => {
    const { validity, diagnostics } = computeLightValidity({ ...good, globalDriftSuspect: true });
    expect(validity).toBe(0);
    expect(diagnostics.cameraControlGate).toBe(0);
  });

  it('reports an honest (not fabricated) camera control mode, since no manual AWB/exposure control is attempted', () => {
    const { diagnostics } = computeLightValidity(good);
    expect(diagnostics.cameraControlMode).toBe('AUTO_UNVERIFIED');
  });

  it('is multiplicative: one badly-failing gate outweighs three good ones', () => {
    const { validity: allGood } = computeLightValidity(good);
    const { validity: oneBad } = computeLightValidity({ ...good, faceCoverageRatio: 0.001 });
    expect(oneBad).toBeLessThan(allGood * 0.1);
  });
});
