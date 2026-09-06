import { useEffect, useState } from 'react';
import { vi } from 'vitest';
import { CHALLENGE_STATE, CHALLENGE_TYPES } from '../../constants/challengeConstants';

/**
 * Test double for the real (unmodified) useChallengeEngine, used by
 * useContinuousVerification's Phase 8 composition-root tests. Exposes a
 * tiny pub/sub bus (__setChallengeEngineState/__resetChallengeEngineMock)
 * so a test can drive the engine to a terminal state and observe how the
 * composition hook reacts, without needing real MediaPipe frames.
 */
let state = { challengeState: CHALLENGE_STATE.IDLE, currentChallengeType: CHALLENGE_TYPES.TURN_HEAD_LEFT, invalidReason: '' };
const listeners = new Set();

export function __setChallengeEngineState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function __resetChallengeEngineMock() {
  state = { challengeState: CHALLENGE_STATE.IDLE, currentChallengeType: CHALLENGE_TYPES.TURN_HEAD_LEFT, invalidReason: '' };
  listeners.clear();
}

export const __selectChallengeType = vi.fn((type) => __setChallengeEngineState({ currentChallengeType: type }));
export const __resetEngine = vi.fn(() => __setChallengeEngineState({ challengeState: CHALLENGE_STATE.IDLE, invalidReason: '' }));
export const __processFrame = vi.fn();
export const __retryChallenge = vi.fn();

export function useChallengeEngine() {
  const [, tick] = useState(0);
  useEffect(() => {
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  return {
    challengeState: state.challengeState,
    currentChallengeType: state.currentChallengeType,
    invalidReason: state.invalidReason,
    baselineProgress: 0,
    remainingTime: 0,
    responseTime: null,
    progressRatio: 0,
    telemetry: null,
    selectChallengeType: __selectChallengeType,
    resetEngine: __resetEngine,
    processFrame: __processFrame,
    retryChallenge: __retryChallenge
  };
}
