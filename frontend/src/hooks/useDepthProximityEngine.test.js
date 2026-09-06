globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDepthProximityEngine } from './useDepthProximityEngine';
import { DEPTH_PROXIMITY_STATE } from '../constants/depthProximityConstants';

// Direct state-machine coverage for the new (Phase 10) engine — unlike
// Head Turn/Light (which have no dedicated unit tests of their own; only
// useContinuousVerification.test.js exercises them, via mocks), this
// engine's thresholds are brand new and explicitly PROVISIONAL, so its
// per-frame decision logic (baseline capture, hold-to-pass, the
// discontinuity/abruptness/pose guards that downgrade a would-be PASS to
// INCONCLUSIVE, and the FAILED/TIMEOUT/face-loss paths) is verified here
// with fully synthetic, deterministic landmark frames — no real camera or
// MediaPipe involved.

const IDENTITY_MATRIX = { rows: 4, columns: 4, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
const VIDEO_WIDTH = 1000;
const VIDEO_HEIGHT = 800;

function makeLandmarksAtScale(scale) {
  const landmarks = Array.from({ length: 468 }, () => ({ x: 0, y: 0, z: 0 }));
  landmarks[133] = { x: 0.5 - scale * 0.05, y: 0.5 }; // RIGHT_EYE_INNER
  landmarks[362] = { x: 0.5 + scale * 0.05, y: 0.5 }; // LEFT_EYE_INNER
  landmarks[234] = { x: 0.5 - scale * 0.15, y: 0.5 }; // RIGHT_CHEEK
  landmarks[454] = { x: 0.5 + scale * 0.15, y: 0.5 }; // LEFT_CHEEK
  return landmarks;
}

function renderHook(props) {
  let hookResult;
  function Harness({ hookProps }) {
    hookResult = useDepthProximityEngine(hookProps);
    return null;
  }
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness, { hookProps: props }));
  });
  return {
    get current() {
      return hookResult;
    },
    rerender(nextProps) {
      act(() => {
        renderer.update(React.createElement(Harness, { hookProps: nextProps }));
      });
    }
  };
}

const baseProps = { isSessionActive: true, isCameraActive: true, videoRef: { current: { videoWidth: VIDEO_WIDTH, videoHeight: VIDEO_HEIGHT } } };

function feedBaseline(hook, count = 20) {
  // First frame: PREPARING -> BASELINE.
  act(() => {
    hook.current.processFrame({ landmarks: makeLandmarksAtScale(1), transformationMatrix: IDENTITY_MATRIX, faceCount: 1, timestamp: 0 });
  });
  for (let i = 0; i < count; i++) {
    act(() => {
      hook.current.processFrame({
        landmarks: makeLandmarksAtScale(1),
        transformationMatrix: IDENTITY_MATRIX,
        faceCount: 1,
        timestamp: 10 * (i + 1)
      });
    });
  }
}

beforeEach(() => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDepthProximityEngine: baseline capture', () => {
  it('transitions PREPARING -> BASELINE -> ACTIVE and captures the required number of baseline frames', () => {
    const hook = renderHook(baseProps);
    act(() => hook.current.startDepthProximityChallenge());
    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.PREPARING);

    feedBaseline(hook, 20);

    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.ACTIVE);
    expect(hook.current.telemetry.baselineFrameCount).toBe(20);
    expect(hook.current.baselineProgress).toBe(100);
  });

  it('flags an already-too-close baseline as INCONCLUSIVE instead of starting the movement phase', () => {
    const hook = renderHook(baseProps);
    act(() => hook.current.startDepthProximityChallenge());

    act(() => {
      hook.current.processFrame({ landmarks: makeLandmarksAtScale(4), transformationMatrix: IDENTITY_MATRIX, faceCount: 1, timestamp: 0 });
    });
    for (let i = 0; i < 20; i++) {
      act(() => {
        hook.current.processFrame({
          landmarks: makeLandmarksAtScale(4), // interocular/width ratio 0.4 > 0.35 guard
          transformationMatrix: IDENTITY_MATRIX,
          faceCount: 1,
          timestamp: 10 * (i + 1)
        });
      });
    }

    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.INCONCLUSIVE);
    expect(hook.current.invalidReason).toMatch(/already very close/i);
  });
});

describe('useDepthProximityEngine: forward-movement evaluation', () => {
  it('PASSes on a clear, progressive, sustained forward movement and records measurement evidence', () => {
    const hook = renderHook(baseProps);
    act(() => hook.current.startDepthProximityChallenge());
    feedBaseline(hook, 20);

    // Gradual ramp 1.00 -> 1.30 (steps of 0.05, well under the 0.15
    // per-frame discontinuity guard), then held at 1.30 long enough to
    // satisfy both the hold-duration and minimum-transition-frame guards.
    const ramp = [1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3];
    let t = 300;
    for (const scale of ramp) {
      act(() => {
        hook.current.processFrame({ landmarks: makeLandmarksAtScale(scale), transformationMatrix: IDENTITY_MATRIX, faceCount: 1, timestamp: t });
      });
      t += 100;
      if (hook.current.challengeState !== DEPTH_PROXIMITY_STATE.ACTIVE) break;
    }

    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.PASS);
    expect(hook.current.telemetry.measurements).toBeTruthy();
    expect(hook.current.telemetry.measurements.discontinuitySuspected).toBe(false);
    expect(hook.current.telemetry.measurements.peakScaleRatio).toBeGreaterThanOrEqual(1.25);
    expect(hook.current.telemetry.measurements.transitionFrameCount).toBeGreaterThanOrEqual(8);
    expect(hook.current.telemetry.measurements.movementDurationMs).toBeGreaterThanOrEqual(400);
  });

  it('does not falsely pass on small jitter that never approaches the required scale ratio', () => {
    const hook = renderHook(baseProps);
    act(() => hook.current.startDepthProximityChallenge());
    feedBaseline(hook, 20);

    const jitter = [1.0, 1.03, 0.98, 1.04, 0.99, 1.02, 1.0, 1.01, 0.99, 1.03];
    let t = 300;
    for (const scale of jitter) {
      act(() => {
        hook.current.processFrame({ landmarks: makeLandmarksAtScale(scale), transformationMatrix: IDENTITY_MATRIX, faceCount: 1, timestamp: t });
      });
      t += 100;
    }

    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.ACTIVE);
  });

  it('does not falsely pass on a discontinuous single-frame jump — downgrades to INCONCLUSIVE', () => {
    const hook = renderHook(baseProps);
    act(() => hook.current.startDepthProximityChallenge());
    feedBaseline(hook, 20);

    // Frame 1 matches baseline (establishes a "previous raw ratio"), frame 2
    // jumps straight to 1.30 in one step (0.30 > the 0.15 guard) — as if a
    // frame had been substituted/spliced rather than genuinely moved
    // through — then holds there long enough to otherwise satisfy the
    // hold/duration/frame-count requirements.
    const sequence = [1.0, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3];
    let t = 300;
    for (const scale of sequence) {
      act(() => {
        hook.current.processFrame({ landmarks: makeLandmarksAtScale(scale), transformationMatrix: IDENTITY_MATRIX, faceCount: 1, timestamp: t });
      });
      t += 100;
      if (hook.current.challengeState !== DEPTH_PROXIMITY_STATE.ACTIVE) break;
    }

    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.INCONCLUSIVE);
    expect(hook.current.invalidReason).toMatch(/discontinuit/i);
  });

  it('reports FAILED on sustained movement away from the camera', () => {
    const hook = renderHook(baseProps);
    act(() => hook.current.startDepthProximityChallenge());
    feedBaseline(hook, 20);

    const sequence = [1.0, 0.95, 0.9, 0.85, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8];
    let t = 300;
    for (const scale of sequence) {
      act(() => {
        hook.current.processFrame({ landmarks: makeLandmarksAtScale(scale), transformationMatrix: IDENTITY_MATRIX, faceCount: 1, timestamp: t });
      });
      t += 100;
      if (hook.current.challengeState !== DEPTH_PROXIMITY_STATE.ACTIVE) break;
    }

    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.FAILED);
  });

  it('times out if the required movement never occurs within the attempt budget', () => {
    const hook = renderHook(baseProps);
    act(() => hook.current.startDepthProximityChallenge());
    feedBaseline(hook, 20);

    act(() => {
      hook.current.processFrame({ landmarks: makeLandmarksAtScale(1), transformationMatrix: IDENTITY_MATRIX, faceCount: 1, timestamp: 9_500 });
    });

    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.TIMEOUT);
  });
});

describe('useDepthProximityEngine: tracking-quality guards', () => {
  it('goes INCONCLUSIVE (not FAILED) after sustained face loss', () => {
    const hook = renderHook(baseProps);
    act(() => hook.current.startDepthProximityChallenge());
    feedBaseline(hook, 20);

    act(() => {
      hook.current.processFrame({ landmarks: null, transformationMatrix: null, faceCount: 0, timestamp: 300 });
    });
    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.ACTIVE); // still within grace period

    act(() => {
      hook.current.processFrame({ landmarks: null, transformationMatrix: null, faceCount: 0, timestamp: 800 });
    });

    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.INCONCLUSIVE);
    expect(hook.current.invalidReason).toMatch(/face tracking lost/i);
  });

  it('goes INCONCLUSIVE immediately on multiple faces', () => {
    const hook = renderHook(baseProps);
    act(() => hook.current.startDepthProximityChallenge());
    feedBaseline(hook, 20);

    act(() => {
      hook.current.processFrame({ landmarks: makeLandmarksAtScale(1), transformationMatrix: IDENTITY_MATRIX, faceCount: 2, timestamp: 300 });
    });

    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.INCONCLUSIVE);
    expect(hook.current.invalidReason).toMatch(/multiple faces/i);
  });
});

describe('useDepthProximityEngine: session lifecycle', () => {
  it('resets to IDLE when the camera/session becomes inactive', () => {
    const hook = renderHook(baseProps);
    act(() => hook.current.startDepthProximityChallenge());
    feedBaseline(hook, 20);
    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.ACTIVE);

    hook.rerender({ ...baseProps, isCameraActive: false });
    expect(hook.current.challengeState).toBe(DEPTH_PROXIMITY_STATE.IDLE);
  });
});
