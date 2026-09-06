globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useContinuousVerification, CONTINUOUS_STATE } from './useContinuousVerification';
import * as api from '../realityCheck/continuousSessionApi';
import { __resetChallengeEngineMock } from './__mocks__/useChallengeEngine';
import { __resetDepthProximityMock } from './__mocks__/useDepthProximityEngine';

/**
 * Regression test for a real stale-closure race: useVerificationOrchestrator
 * used to call lightChallengeEngine.startLightChallenge() SYNCHRONOUSLY, in
 * the same tick as the setIsChallengeRunning(true) that's supposed to make
 * the engine's own isSessionActive guard pass. Because React batches that
 * state update, the engine closure this call used still reflected the
 * PRE-update (false) value, so startLightChallenge() silently no-op'd: the
 * engine stayed in LIGHT_IDLE forever, no flash ever appeared, and the
 * challenge never resolved (matching a real, reported symptom — a
 * "Light Challenge — please respond now" banner that never went away and
 * no visible screen flash).
 *
 * Deliberately does NOT mock useLightChallengeEngine (unlike
 * useContinuousVerification.test.js) — the bug only exists in the
 * interaction between the REAL engine's guard and the orchestrator's
 * timing, and is invisible behind the manual mock used elsewhere in this
 * file's sibling suite.
 */
vi.mock('./useChallengeEngine');
vi.mock('./useDepthProximityEngine');
vi.mock('../realityCheck/continuousSessionApi');

function renderHook(initialProps) {
  let hookResult;
  function Harness({ hookProps }) {
    hookResult = useContinuousVerification(hookProps);
    return null;
  }
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness, { hookProps: initialProps }));
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

function makeFakeScheduler() {
  let now = 0;
  let tickFn = null;
  return {
    clock: () => now,
    random: () => 0,
    advance(ms) {
      now += ms;
    },
    setIntervalFn: (fn) => {
      tickFn = fn;
      return 1;
    },
    clearIntervalFn: () => {
      tickFn = null;
    },
    fireTick() {
      tickFn?.();
    }
  };
}

const baseProps = { isCameraActive: true, videoRef: { current: null }, faceCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  __resetChallengeEngineMock();
  __resetDepthProximityMock();
  api.createContinuousSession.mockResolvedValue({ sessionId: 'test-session-id' });
  api.startContinuousSession.mockResolvedValue({});
  api.submitChallengeResult.mockResolvedValue({});
  api.endContinuousSession.mockResolvedValue({ riskState: 'INCONCLUSIVE' });
});

describe('LIGHT challenge with the real useLightChallengeEngine actually starts (not stuck in IDLE)', () => {
  it('reaches a terminal outcome (via the engine\'s own attempt timeout) instead of hanging forever with isChallengeRunning stuck true', async () => {
    const sched = makeFakeScheduler();
    const hook = renderHook({
      ...baseProps,
      clock: sched.clock,
      schedulerRandom: sched.random,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn
    });

    await act(async () => {
      await hook.current.start();
    });

    api.getNextChallenge.mockResolvedValueOnce({
      challengeId: 'c1',
      type: 'LIGHT',
      nonce: 'n1',
      expiresAt: new Date(Date.now() + 45_000).toISOString()
    });

    sched.advance(60_000);
    await act(async () => {
      sched.fireTick();
      await Promise.resolve(); // let getNextChallenge's promise settle
    });

    expect(hook.current.state).toBe(CONTINUOUS_STATE.CHALLENGE_ACTIVE);
    expect(hook.current.isChallengeRunning).toBe(true);

    // No real MediaPipe frames are fed here — the point of this test is
    // that the Light engine's own internal attempt-timeout budget (6s,
    // LIGHT_CHALLENGE_CONFIG.timeoutSeconds) fires as long as the engine
    // actually STARTED (attemptStartTimeRef got set). Under the bug, the
    // engine never left LIGHT_IDLE, so processFrame's very first guard
    // (`currentState === LIGHT_CHALLENGE_STATE.IDLE`) always short-circuited
    // and this timeout could never fire, no matter how much time passed.
    const farFuture = performance.now() + 7000;
    await act(async () => {
      hook.current.processFrame({ landmarks: null, faceCount: 0, timestamp: farFuture });
      await Promise.resolve();
    });

    expect(hook.current.isChallengeRunning).toBe(false);
    expect(hook.current.challengesRun).toBe(1);
    expect(hook.current.state).toBe(CONTINUOUS_STATE.ACTIVE);
    expect(api.submitChallengeResult).toHaveBeenCalledWith(
      'test-session-id',
      'c1',
      expect.objectContaining({ outcome: 'TIMEOUT' }),
    );
  });
});
