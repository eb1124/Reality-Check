import { useEffect, useState } from 'react';
import { vi } from 'vitest';
import { DEPTH_PROXIMITY_STATE } from '../../constants/depthProximityConstants';

/**
 * Test double for the real (unmodified) useDepthProximityEngine — see
 * useLightChallengeEngine's mock (sibling file) for the rationale.
 */
let state = { challengeState: DEPTH_PROXIMITY_STATE.IDLE, invalidReason: '', telemetry: null };
const listeners = new Set();

export function __setDepthProximityState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function __resetDepthProximityMock() {
  state = { challengeState: DEPTH_PROXIMITY_STATE.IDLE, invalidReason: '', telemetry: null };
  listeners.clear();
}

export const __startDepthProximityChallenge = vi.fn(() =>
  __setDepthProximityState({ challengeState: DEPTH_PROXIMITY_STATE.IDLE })
);
export const __resetEngine = vi.fn(() =>
  __setDepthProximityState({ challengeState: DEPTH_PROXIMITY_STATE.IDLE, invalidReason: '' })
);
export const __processFrame = vi.fn();

export function useDepthProximityEngine() {
  const [, tick] = useState(0);
  useEffect(() => {
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  return {
    challengeState: state.challengeState,
    invalidReason: state.invalidReason,
    telemetry: state.telemetry,
    startDepthProximityChallenge: __startDepthProximityChallenge,
    resetEngine: __resetEngine,
    processFrame: __processFrame
  };
}
