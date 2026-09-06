globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useContinuousVerification, CONTINUOUS_STATE, mapToClientOutcome } from './useContinuousVerification';
import { CHALLENGE_STATE } from '../constants/challengeConstants';
import { LIGHT_CHALLENGE_STATE } from '../constants/lightChallengeConstants';
import * as api from '../realityCheck/continuousSessionApi';
import { __setChallengeEngineState, __resetChallengeEngineMock } from './__mocks__/useChallengeEngine';
import { __setLightChallengeState, __resetLightChallengeMock } from './__mocks__/useLightChallengeEngine';

// Phase 8: composition-root coverage. Both real bugs found in Stage 4 (the
// stale isCameraActive closure, and the demo not knowing a challenge's
// direction) lived in exactly this untested layer — the pure scheduler/
// monitor/eventBatcher classes were already covered, but the hook that
// wires them together into a session lifecycle was not. The real (unmodified)
// useVerificationOrchestrator is used as-is here, matching production
// wiring; only the two challenge engines and the backend API client are
// replaced with controllable test doubles (see __mocks__ siblings).
vi.mock('./useChallengeEngine');
vi.mock('./useLightChallengeEngine');
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
    },
    unmount() {
      act(() => renderer.unmount());
    }
  };
}

// Manually-advanceable fake clock + a directly-invokable "tick" captured from
// setIntervalFn, matching the injectable-clock discipline used throughout
// Phase 7 — no test here waits out a real interval.
function makeFakeScheduler() {
  let now = 0;
  let tickFn = null;
  return {
    clock: () => now,
    // Pins the scheduler's random interval pick to exactly
    // randomChallengeMinIntervalMs (span * 0 = 0) instead of the real
    // 30-90s spread, so tests don't have to tolerate a random window.
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

const baseProps = { isCameraActive: true, videoRef: { current: null }, faceCount: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  __resetChallengeEngineMock();
  __resetLightChallengeMock();
  api.createContinuousSession.mockResolvedValue({ sessionId: 'test-session-id' });
  api.startContinuousSession.mockResolvedValue({});
  api.getNextChallenge.mockResolvedValue({ none: true, reason: 'COOLDOWN' });
  api.endContinuousSession.mockResolvedValue({ riskState: 'INCONCLUSIVE' });
});

describe('mapToClientOutcome', () => {
  it('maps head-turn terminal states to the fixed 4-value vocabulary', () => {
    expect(mapToClientOutcome('TURN_HEAD_LEFT', CHALLENGE_STATE.SUCCESS)).toBe('PASSED');
    expect(mapToClientOutcome('TURN_HEAD_LEFT', CHALLENGE_STATE.TIMEOUT)).toBe('TIMEOUT');
    expect(mapToClientOutcome('TURN_HEAD_LEFT', CHALLENGE_STATE.INVALID)).toBe('FAILED');
  });

  it('maps LIGHT_INCONCLUSIVE to ABORTED, not FAILED (preserves "inconclusive is not a failure")', () => {
    expect(mapToClientOutcome('LIGHT', LIGHT_CHALLENGE_STATE.INCONCLUSIVE)).toBe('ABORTED');
  });

  it('maps the remaining LIGHT terminal states', () => {
    expect(mapToClientOutcome('LIGHT', LIGHT_CHALLENGE_STATE.PASS)).toBe('PASSED');
    expect(mapToClientOutcome('LIGHT', LIGHT_CHALLENGE_STATE.TIMEOUT)).toBe('TIMEOUT');
    expect(mapToClientOutcome('LIGHT', LIGHT_CHALLENGE_STATE.INVALID)).toBe('FAILED');
  });
});

describe('useContinuousVerification: start()', () => {
  it('creates and starts a backend session when the camera is already active', async () => {
    const hook = renderHook(baseProps);
    await act(async () => {
      await hook.current.start();
    });
    expect(api.createContinuousSession).toHaveBeenCalledTimes(1);
    expect(api.startContinuousSession).toHaveBeenCalledWith('test-session-id');
    expect(hook.current.state).toBe(CONTINUOUS_STATE.ACTIVE);
  });

  it('regression: a start() reference captured while isCameraActive was false still works once the camera comes up', async () => {
    // Mirrors EngineBridge's `await startCamera(); await continuous.start();`:
    // the `start` function reference is obtained from a render where
    // isCameraActive was still false (e.g. captured into a closure before
    // the camera finished acquiring), and only actually invoked later, once
    // isCameraActive has since flipped true. Before the fix, `start` closed
    // over the plain `isCameraActive` boolean as it was at first render —
    // permanently false — so calling this exact same reference later would
    // silently no-op and never call createContinuousSession. The fix reads
    // isCameraActiveRef.current live at call time instead, so the captured
    // reference's age must not matter.
    const hook = renderHook({ ...baseProps, isCameraActive: false });
    const earlyStartRef = hook.current.start;
    hook.rerender({ ...baseProps, isCameraActive: true });
    await act(async () => {
      await earlyStartRef();
    });
    expect(api.createContinuousSession).toHaveBeenCalledTimes(1);
    expect(hook.current.state).toBe(CONTINUOUS_STATE.ACTIVE);
  });

  it('does not create a session if the camera never becomes active', async () => {
    const hook = renderHook({ ...baseProps, isCameraActive: false });
    await act(async () => {
      await hook.current.start();
    });
    expect(api.createContinuousSession).not.toHaveBeenCalled();
    expect(hook.current.state).toBe(CONTINUOUS_STATE.IDLE);
  });

  it('reverts to IDLE and surfaces startError if session creation fails', async () => {
    api.createContinuousSession.mockRejectedValue(new Error('network down'));
    const hook = renderHook(baseProps);
    await act(async () => {
      await hook.current.start();
    });
    expect(hook.current.state).toBe(CONTINUOUS_STATE.IDLE);
    expect(hook.current.startError).toBeTruthy();
  });
});

describe('useContinuousVerification: scheduler-driven challenge lifecycle', () => {
  it('requests and runs a challenge when the scheduler decides, and does nothing when the backend says none', async () => {
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

    // Backend says none yet (default mock) — advance past the dev min
    // interval and fire a tick; nothing should happen.
    sched.advance(35_000);
    await act(async () => {
      sched.fireTick();
    });
    expect(api.getNextChallenge).toHaveBeenCalled();
    expect(hook.current.state).toBe(CONTINUOUS_STATE.ACTIVE);

    // Now the backend actually issues one.
    api.getNextChallenge.mockResolvedValueOnce({
      challengeId: 'c1',
      type: 'TURN_HEAD_RIGHT',
      nonce: 'n1',
      expiresAt: new Date().toISOString()
    });
    sched.advance(60_000);
    await act(async () => {
      sched.fireTick();
      await Promise.resolve(); // let getNextChallenge's promise settle
    });
    expect(hook.current.state).toBe(CONTINUOUS_STATE.CHALLENGE_ACTIVE);
    expect(hook.current.isChallengeRunning).toBe(true);
  });

  it('never issues a second challenge while one is already running (single-flight)', async () => {
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

    api.getNextChallenge.mockResolvedValue({
      challengeId: 'c1',
      type: 'TURN_HEAD_LEFT',
      nonce: 'n1',
      expiresAt: new Date().toISOString()
    });
    sched.advance(60_000);
    await act(async () => {
      sched.fireTick();
      await Promise.resolve();
    });
    expect(api.getNextChallenge).toHaveBeenCalledTimes(1);
    expect(hook.current.state).toBe(CONTINUOUS_STATE.CHALLENGE_ACTIVE);

    // Scheduler ticking again mid-challenge must not fire a second request —
    // runChallenge's own state-guard, independent of the scheduler's.
    await act(async () => {
      sched.fireTick();
      await Promise.resolve();
    });
    expect(api.getNextChallenge).toHaveBeenCalledTimes(1);
  });

  it('submits the mapped outcome once the challenge engine reaches a terminal state, then returns to ACTIVE', async () => {
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
      type: 'TURN_HEAD_RIGHT',
      nonce: 'n1',
      expiresAt: new Date().toISOString()
    });
    sched.advance(60_000);
    await act(async () => {
      sched.fireTick();
      await Promise.resolve();
    });
    expect(hook.current.state).toBe(CONTINUOUS_STATE.CHALLENGE_ACTIVE);

    // Drive the (mocked) engine to SUCCESS, as if the user actually turned
    // their head — this is the real useVerificationOrchestrator reacting to
    // it, not a simulated callback.
    await act(async () => {
      __setChallengeEngineState({ challengeState: CHALLENGE_STATE.SUCCESS });
    });

    expect(api.submitChallengeResult).toHaveBeenCalledWith(
      'test-session-id',
      'c1',
      expect.objectContaining({ nonce: 'n1', outcome: 'PASSED' })
    );
    expect(hook.current.state).toBe(CONTINUOUS_STATE.ACTIVE);
    expect(hook.current.challengesRun).toBe(1);
    expect(hook.current.isChallengeRunning).toBe(false);
  });

  it('runs a LIGHT challenge through the same lifecycle', async () => {
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
      challengeId: 'c2',
      type: 'LIGHT',
      nonce: 'n2',
      expiresAt: new Date().toISOString()
    });
    sched.advance(60_000);
    await act(async () => {
      sched.fireTick();
      await Promise.resolve();
    });
    expect(hook.current.state).toBe(CONTINUOUS_STATE.CHALLENGE_ACTIVE);

    await act(async () => {
      __setLightChallengeState({ challengeState: LIGHT_CHALLENGE_STATE.INCONCLUSIVE });
    });

    expect(api.submitChallengeResult).toHaveBeenCalledWith(
      'test-session-id',
      'c2',
      expect.objectContaining({ nonce: 'n2', outcome: 'ABORTED' })
    );
    expect(hook.current.state).toBe(CONTINUOUS_STATE.ACTIVE);
  });
});

describe('useContinuousVerification: end() and teardown', () => {
  it('ends the session, returns the report, and is idempotent against a second call', async () => {
    const hook = renderHook(baseProps);
    await act(async () => {
      await hook.current.start();
    });

    let report1;
    await act(async () => {
      report1 = await hook.current.end('ENDED');
    });
    expect(api.endContinuousSession).toHaveBeenCalledWith('test-session-id', 'ENDED');
    expect(report1).toEqual({ riskState: 'INCONCLUSIVE' });
    expect(hook.current.state).toBe(CONTINUOUS_STATE.ENDED);

    let report2;
    await act(async () => {
      report2 = await hook.current.end('ENDED');
    });
    expect(api.endContinuousSession).toHaveBeenCalledTimes(1); // not called again
    expect(report2).toEqual(report1);
  });

  it('ends with CANCELLED if the camera drops mid-session', async () => {
    const hook = renderHook(baseProps);
    await act(async () => {
      await hook.current.start();
    });
    expect(hook.current.state).toBe(CONTINUOUS_STATE.ACTIVE);

    await act(async () => {
      hook.rerender({ ...baseProps, isCameraActive: false });
      await Promise.resolve();
    });
    expect(api.endContinuousSession).toHaveBeenCalledWith('test-session-id', 'CANCELLED');
    expect(hook.current.state).toBe(CONTINUOUS_STATE.ENDED);
  });
});
