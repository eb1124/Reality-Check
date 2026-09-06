import { useEffect, useState } from 'react';
import { vi } from 'vitest';
import { LIGHT_CHALLENGE_STATE } from '../../constants/lightChallengeConstants';

/**
 * Test double for the real (unmodified) useLightChallengeEngine — see
 * useChallengeEngine's mock (sibling file) for the rationale.
 */
let state = { challengeState: LIGHT_CHALLENGE_STATE.IDLE, invalidReason: '', telemetry: null, isFlashActive: false, flashColorCss: null };
const listeners = new Set();

export function __setLightChallengeState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function __resetLightChallengeMock() {
  state = { challengeState: LIGHT_CHALLENGE_STATE.IDLE, invalidReason: '', telemetry: null, isFlashActive: false, flashColorCss: null };
  listeners.clear();
}

export const __startLightChallenge = vi.fn(() => __setLightChallengeState({ challengeState: LIGHT_CHALLENGE_STATE.IDLE }));
export const __resetEngine = vi.fn(() => __setLightChallengeState({ challengeState: LIGHT_CHALLENGE_STATE.IDLE, invalidReason: '' }));
export const __processFrame = vi.fn();

export function useLightChallengeEngine() {
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
    isFlashActive: state.isFlashActive,
    flashColorCss: state.flashColorCss,
    startLightChallenge: __startLightChallenge,
    resetEngine: __resetEngine,
    processFrame: __processFrame
  };
}
