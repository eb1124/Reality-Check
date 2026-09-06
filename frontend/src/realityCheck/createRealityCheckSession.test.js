// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRealityCheckSession } from './createRealityCheckSession';
import * as api from './continuousSessionApi';
import { __setChallengeEngineState, __resetChallengeEngineMock } from '../hooks/__mocks__/useChallengeEngine';
import { __setLightChallengeState, __resetLightChallengeMock } from '../hooks/__mocks__/useLightChallengeEngine';
import { __setFaceCount, __resetFaceLandmarkerMock } from '../hooks/__mocks__/useFaceLandmarker';
import { CHALLENGE_STATE } from '../constants/challengeConstants';

/**
 * Phase 9: automated coverage for the PUBLIC integration bridge
 * (createRealityCheckSession / EngineBridge), which the Phase 7/8 reports
 * explicitly flagged as untested. Everything here goes through the exact
 * same public function an embedding OA would call — never
 * useContinuousVerification or EngineBridge directly — so a passing suite
 * is direct evidence the documented contract (see INTEGRATION.md) actually
 * holds.
 *
 * Runs in jsdom (unlike the rest of this project's node-environment tests)
 * because createRealityCheckSession genuinely mounts a React DOM root via
 * ReactDOM.createRoot — the one thing about this module a fake renderer
 * can't stand in for. Deliberately does NOT wrap calls in React's `act()`:
 * createRealityCheckSession is written for real browsers, where
 * ReactDOM.createRoot's scheduled work simply flushes on its own timing.
 * Under this project's jsdom test setup, wrapping a call that itself awaits
 * across that flush (e.g. `act(async () => { await rc.start(); ... })`)
 * was found to defer the underlying commit — and therefore ref/state
 * visibility — until the *outer* act() promise settles, which starves the
 * function under test of the very render it's waiting on. Calling the
 * public API directly and awaiting real (or fake, see the challenge-
 * lifecycle block below) timers instead reproduces actual browser timing;
 * the resulting "not wrapped in act" console warnings are expected noise,
 * not a correctness signal, and are silenced below.
 *
 * The three heavy dependencies EngineBridge composes are swapped for the
 * same kind of test doubles Phase 8's useContinuousVerification.test.js
 * already established: the real MediaPipe-backed useFaceLandmarker
 * (network + rAF loop) and the real useChallengeEngine/useLightChallengeEngine
 * (need actual video frames) are mocked; useVerificationOrchestrator,
 * useContinuousVerification, the scheduler/monitor/eventBatcher, and
 * EngineBridge itself are all real.
 */
vi.mock('../hooks/useChallengeEngine');
vi.mock('../hooks/useLightChallengeEngine');
vi.mock('../hooks/useFaceLandmarker');
vi.mock('./continuousSessionApi');
// The scheduler-lifecycle describe block below needs a real (not
// fake-timer) wait past the random-challenge window — ReactDOM.createRoot's
// initial commit goes through the Scheduler package's own MessageChannel
// queue, which vitest's fake timers don't intercept, so faking time instead
// would starve createRealityCheckSession.start() of the render it awaits.
// Shrinking the interval here keeps that wait real but short (~1s, bounded
// by the scheduler's own 1000ms poll — see useChallengeScheduler.js) rather
// than the dev profile's real 30s minimum.
vi.mock('./config', () => ({
  getRealityCheckConfig: () => ({
    env: 'test',
    randomChallengeMinIntervalMs: 10,
    randomChallengeMaxIntervalMs: 20,
    challengeCooldownMs: 10,
    eventTriggeredChallengeCooldownMs: 10,
    maxChallengesPerSession: 20,
    challengeTimeoutMs: 45_000,
    faceMissingWarningMs: 1_500,
    faceMissingSuspiciousMs: 5_000,
    frozenFrameSuspiciousMs: 3_000,
    suspiciousBurstCount: 3,
    suspiciousBurstWindowMs: 60_000,
    eventFlushIntervalMs: 5_000
  })
}));

function makeFakeStream(trackCount = 2) {
  const tracks = Array.from({ length: trackCount }, () => ({ stop: vi.fn(), kind: 'video' }));
  return { getTracks: () => tracks };
}

// Flushes the chain of `await new Promise(resolve => setTimeout(resolve, 0))`
// hops createRealityCheckSession.start()/EngineBridge's imperative start()
// use to let React commit a render before proceeding — see those two
// files' own comments on why each hop exists. Also sufficient to flush a
// plain React state update triggered from outside any timer/DOM event (e.g.
// the __set*State mock helpers below), which a real setTimeout's callback
// firing always waits behind.
async function flushStartupTicks() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

let consoleErrorSpy;

beforeEach(() => {
  vi.clearAllMocks();
  __resetChallengeEngineMock();
  __resetLightChallengeMock();
  __resetFaceLandmarkerMock();
  api.createContinuousSession.mockResolvedValue({ sessionId: 'test-session-id' });
  api.startContinuousSession.mockResolvedValue({});
  api.getNextChallenge.mockResolvedValue({ none: true, reason: 'COOLDOWN' });
  api.submitEvents.mockResolvedValue({ accepted: 0 });
  api.submitChallengeResult.mockResolvedValue({});
  api.endContinuousSession.mockResolvedValue({ riskState: 'INCONCLUSIVE', sessionId: 'test-session-id' });
  navigator.mediaDevices = { getUserMedia: vi.fn(async () => makeFakeStream()) };
  // See the module docstring: expected "not wrapped in act" noise from
  // exercising a browser-oriented API without a browser-oriented test
  // harness — not a signal this suite treats as a failure.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  consoleErrorSpy.mockRestore();
  vi.restoreAllMocks();
  delete navigator.mediaDevices;
  // Defensive: a test that threw before calling end() would otherwise leak
  // its hidden mount point into the next test's DOM.
  document.querySelectorAll('[data-reality-check-engine]').forEach((el) => el.remove());
});

describe('createRealityCheckSession: shape and lifecycle', () => {
  it('creating an integration returns exactly the documented start/on/getStatus/end contract', () => {
    const rc = createRealityCheckSession();
    expect(typeof rc.start).toBe('function');
    expect(typeof rc.on).toBe('function');
    expect(typeof rc.getStatus).toBe('function');
    expect(typeof rc.end).toBe('function');
    expect(rc.getStatus()).toEqual(
      expect.objectContaining({ state: 'IDLE', sessionId: null, challengesRun: 0 })
    );
  });

  it('rejects an unknown event type', () => {
    const rc = createRealityCheckSession();
    expect(() => rc.on('not-a-real-type', () => {})).toThrow(/Unknown Reality Check event type/);
  });

  it('start() creates and starts a backend session and returns its id; getStatus reflects it', async () => {
    const rc = createRealityCheckSession();
    const result = await rc.start();
    await flushStartupTicks();

    expect(api.createContinuousSession).toHaveBeenCalledTimes(1);
    expect(api.startContinuousSession).toHaveBeenCalledTimes(1);
    expect(result.sessionId).toBe('test-session-id');
    expect(rc.getStatus().sessionId).toBe('test-session-id');
    expect(rc.getStatus().state).toBe('ACTIVE');

    await rc.end();
  });

  it('end() returns the final integrity report and is idempotent against a second call', async () => {
    const rc = createRealityCheckSession();
    await rc.start();
    await flushStartupTicks();

    const report1 = await rc.end();
    expect(api.endContinuousSession).toHaveBeenCalledTimes(1);
    expect(report1).toEqual(expect.objectContaining({ riskState: 'INCONCLUSIVE' }));

    const report2 = await rc.end();
    expect(api.endContinuousSession).toHaveBeenCalledTimes(1); // not called again
    expect(report2).toBeNull(); // second call is a pure no-op, per the documented contract
  });

  it('disposes its hidden mount point on end() (no leaked DOM/React root)', async () => {
    const rc = createRealityCheckSession();
    await rc.start();
    await flushStartupTicks();
    expect(document.querySelector('[data-reality-check-engine]')).not.toBeNull();

    await rc.end();
    expect(document.querySelector('[data-reality-check-engine]')).toBeNull();
  });

  it('no challenge/event resurrects the session after end()', async () => {
    const rc = createRealityCheckSession();
    await rc.start();
    await flushStartupTicks();
    await rc.end();

    api.getNextChallenge.mockClear();
    __setFaceCount(2); // would normally raise multiple_faces_detected + request a challenge
    await flushStartupTicks();

    expect(rc.getStatus().state).toBe('ENDED');
    expect(api.getNextChallenge).not.toHaveBeenCalled();
  });
});

describe('createRealityCheckSession: camera ownership (Phase 9)', () => {
  it('internally-owned camera: acquires its own stream via getUserMedia (backward compatible)', async () => {
    const rc = createRealityCheckSession();
    await rc.start();
    await flushStartupTicks();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(rc.getStatus().state).toBe('ACTIVE');

    await rc.end();
  });

  it("externally-supplied MediaStream: never calls getUserMedia, and never stops the stream's tracks", async () => {
    const externalStream = makeFakeStream(2);
    const rc = createRealityCheckSession({ mediaStream: externalStream });

    await rc.start();
    await flushStartupTicks();

    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(rc.getStatus().state).toBe('ACTIVE');

    await rc.end();

    externalStream.getTracks().forEach((track) => expect(track.stop).not.toHaveBeenCalled());
  });
});

describe('createRealityCheckSession: event subscription', () => {
  it("delivers a real passively-observed event to on('event', ...) subscribers", async () => {
    const rc = createRealityCheckSession();
    const events = [];
    rc.on('event', (e) => events.push(e));

    await rc.start();
    await flushStartupTicks();

    // multiple_faces_detected fires immediately (no debounce window), unlike
    // face_missing/frozen_frame — see monitor.js — so it's the reliable way
    // to exercise the real PassiveMonitor end-to-end without fake-timing a
    // multi-second debounce window.
    __setFaceCount(2);
    await flushStartupTicks();

    expect(events).toContainEqual({ eventType: 'multiple_faces_detected', severity: 'suspicious' });

    await rc.end();
  });
});

describe('createRealityCheckSession: challenge lifecycle (Head Turn direction + Light flash)', () => {
  // Real timers throughout (no vi.useFakeTimers()): ReactDOM.createRoot's
  // initial commit is scheduled through the Scheduler package's own
  // MessageChannel-based queue, which fake timers do not intercept — under
  // fake time, the render that createRealityCheckSession.start() is
  // waiting on never actually flushes. Rather than fight that, the
  // scheduler's random-challenge window is shrunk via a mocked config so a
  // real (short) wait crosses it, exactly like the dev/production configs
  // do at their own timescales — see realityCheck/config.js.
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  it("exposes challenge start/pass through on('challenge', ...), with the assigned direction visible to the caller", async () => {
    const rc = createRealityCheckSession();
    const challengeEvents = [];
    rc.on('challenge', (c) => challengeEvents.push(c));

    await rc.start();
    await flushStartupTicks();
    expect(rc.getStatus().state).toBe('ACTIVE');

    api.getNextChallenge.mockResolvedValueOnce({
      challengeId: 'c1',
      type: 'TURN_HEAD_LEFT',
      nonce: 'n1',
      expiresAt: new Date().toISOString()
    });

    // The mocked fast config's randomChallengeMinIntervalMs is tiny; the
    // scheduler's own real 1000ms poll interval is what we're actually
    // waiting out here (see useChallengeScheduler.js's pollIntervalMs).
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(challengeEvents).toContainEqual({ status: 'started', type: 'TURN_HEAD_LEFT' });
    expect(rc.getStatus().state).toBe('CHALLENGE_ACTIVE');

    // Drive the real (unmodified) orchestrator to a pass via the mocked
    // engine, exactly as useContinuousVerification.test.js does.
    __setChallengeEngineState({ challengeState: CHALLENGE_STATE.SUCCESS });
    await flushStartupTicks();

    expect(challengeEvents).toContainEqual({ status: 'passed', type: 'TURN_HEAD_LEFT' });
    expect(api.submitChallengeResult).toHaveBeenCalledWith(
      'test-session-id',
      'c1',
      expect.objectContaining({ nonce: 'n1', outcome: 'PASSED' })
    );
    expect(rc.getStatus().state).toBe('ACTIVE');

    await rc.end();
  }, 10_000);

  it('Light Challenge screen flash renders as a real, visible, full-viewport DOM node', async () => {
    const rc = createRealityCheckSession();
    await rc.start();
    await flushStartupTicks();

    __setLightChallengeState({ isFlashActive: true, flashColorCss: 'rgb(10, 20, 30)' });
    await flushStartupTicks();

    const overlay = document.querySelector('.light-flash-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.style.position).toBe('fixed');
    expect(overlay.style.backgroundColor).toBe('rgb(10, 20, 30)');

    __setLightChallengeState({ isFlashActive: false });
    await flushStartupTicks();
    expect(document.querySelector('.light-flash-overlay')).toBeNull();

    await rc.end();
  });
});
