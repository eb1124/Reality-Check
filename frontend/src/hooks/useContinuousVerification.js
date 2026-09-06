import { useCallback, useEffect, useRef, useState } from 'react';
import { useChallengeEngine } from './useChallengeEngine';
import { useLightChallengeEngine } from './useLightChallengeEngine';
import { useVerificationOrchestrator } from './useVerificationOrchestrator';
import { useChallengeScheduler } from './useChallengeScheduler';
import { usePassiveMonitor } from './usePassiveMonitor';
import {
  createContinuousSession,
  startContinuousSession,
  submitEvents,
  getNextChallenge,
  submitChallengeResult,
  endContinuousSession
} from '../realityCheck/continuousSessionApi';
import { getRealityCheckConfig } from '../realityCheck/config';
import { CHALLENGE_STATE } from '../constants/challengeConstants';
import { LIGHT_CHALLENGE_STATE } from '../constants/lightChallengeConstants';

export const CONTINUOUS_STATE = {
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  ACTIVE: 'ACTIVE',
  CHALLENGE_ACTIVE: 'CHALLENGE_ACTIVE',
  ENDED: 'ENDED',
  ERROR: 'ERROR'
};

// Maps the real (unmodified) challenge-engine terminal states onto the
// fixed backend vocabulary (continuous_types.CHALLENGE_CLIENT_OUTCOMES:
// PASSED/FAILED/TIMEOUT/ABORTED — no INCONCLUSIVE slot exists, per §5's
// fixed event vocabulary, which has no "challenge_inconclusive" event
// type). LIGHT_INCONCLUSIVE is deliberately mapped to ABORTED rather than
// FAILED: ABORTED carries 'warning' severity server-side (see
// continuous_models.py's _RESULT_SEVERITY_BY_OUTCOME), which does NOT
// contribute failure points to the risk score — preserving the existing
// Light Challenge design's own "inconclusive is not a failure, only a
// supplementary signal" intent (see lightChallenge.js's module docstring)
// even though continuous mode now scores challenges individually.
export function mapToClientOutcome(challengeKind, engineState) {
  if (challengeKind === 'LIGHT') {
    if (engineState === LIGHT_CHALLENGE_STATE.PASS) return 'PASSED';
    if (engineState === LIGHT_CHALLENGE_STATE.INCONCLUSIVE) return 'ABORTED';
    if (engineState === LIGHT_CHALLENGE_STATE.TIMEOUT) return 'TIMEOUT';
    return 'FAILED'; // LIGHT_INVALID
  }
  if (engineState === CHALLENGE_STATE.SUCCESS) return 'PASSED';
  if (engineState === CHALLENGE_STATE.TIMEOUT) return 'TIMEOUT';
  return 'FAILED'; // INVALID
}

/**
 * Composes the Phase 7 continuous-verification engine: creates/starts a
 * backend continuous session, runs the passive monitor and challenge
 * scheduler, and drives challenges through the SAME
 * useVerificationOrchestrator used by the one-shot flow (via its
 * `continuous` mode / runContinuousChallenge — see that hook's module
 * comment) rather than a second, independent state machine.
 *
 * Camera acquisition/teardown itself is NOT owned here — that's the
 * existing useCamera hook, reused unmodified by whatever component mounts
 * this (consistent with "keep camera teardown reliable... follow whatever
 * guard pattern already exists").
 */
export function useContinuousVerification({
  isCameraActive,
  videoRef,
  faceCount,
  onEvent,
  onChallenge,
  // Test-only timer overrides for the scheduler's polling loop, threaded
  // straight through to useChallengeScheduler (see that hook's own params).
  // Default to the real global timers, so this is a no-op in production —
  // exists purely so Phase 8's composition-root tests can fire scheduler
  // decisions deterministically instead of waiting out a real 30-90s window.
  clock = Date.now,
  schedulerRandom = Math.random,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  schedulerPollIntervalMs = 1000
}) {
  const config = getRealityCheckConfig();

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onChallengeRef = useRef(onChallenge);
  onChallengeRef.current = onChallenge;

  const [state, setState] = useState(CONTINUOUS_STATE.IDLE);
  const [sessionId, setSessionId] = useState(null);
  const [challengesRun, setChallengesRun] = useState(0);
  const [report, setReport] = useState(null);
  const [startError, setStartError] = useState(null);

  // Ref-mirrors-state guard, matching useVerificationOrchestrator's
  // orchPhaseRef pattern — async work (session creation, next-challenge
  // polls, result submission) that resolves after teardown must not
  // resurrect the session or start a challenge.
  const stateRef = useRef(state);
  stateRef.current = state;

  // isCameraActive is a plain boolean prop, not a ref — a closure that
  // captures it (e.g. start(), below) freezes whatever value it was at
  // closure-creation time. Across an `await` boundary (e.g. awaiting
  // startCamera() before calling start()), that snapshot goes stale: the
  // camera can genuinely become active in between, but the closure would
  // never see it. Mirrored into a ref, read live via .current, exactly
  // like stateRef above.
  const isCameraActiveRef = useRef(isCameraActive);
  isCameraActiveRef.current = isCameraActive;

  const [isChallengeRunning, setIsChallengeRunning] = useState(false);
  const isMonitoringActive = state === CONTINUOUS_STATE.ACTIVE || state === CONTINUOUS_STATE.CHALLENGE_ACTIVE;

  // The exact same, unmodified challenge engines the one-shot flow uses.
  // isSessionActive here is scoped to "a challenge is actually running"
  // (not the whole monitoring duration) — otherwise these engines' own
  // internal auto-arm effects (see useChallengeEngine.js) would sit in
  // CHALLENGE_ACTIVE the entire interview instead of only during a
  // scheduler-initiated challenge.
  const challengeEngine = useChallengeEngine({ isSessionActive: isChallengeRunning, isCameraActive });
  const lightChallengeEngine = useLightChallengeEngine({
    isSessionActive: isChallengeRunning,
    isCameraActive,
    videoRef
  });

  const pendingChallengeRef = useRef(null); // { challengeId, nonce, type }

  const onChallengeResolved = useCallback(
    (outcome) => {
      const pending = pendingChallengeRef.current;
      pendingChallengeRef.current = null;
      setIsChallengeRunning(false);
      schedulerControlsRef.current?.markChallengeResolved();
      setChallengesRun((n) => n + 1);

      if (stateRef.current === CONTINUOUS_STATE.ENDED || stateRef.current === CONTINUOUS_STATE.ERROR) {
        return; // torn down while the challenge was resolving — do not resurrect
      }
      setState(CONTINUOUS_STATE.ACTIVE);

      if (!pending) return;
      const clientOutcome = mapToClientOutcome(pending.type, outcome.state);
      // Public-interface challenge feed collapses the 4-value backend
      // outcome to the 3 states the interface documents ('started' |
      // 'passed' | 'failed') — TIMEOUT/ABORTED both surface as 'failed'
      // here; the full outcome is still in the eventual report's timeline
      // for anyone who needs the detail.
      onChallengeRef.current?.({ status: clientOutcome === 'PASSED' ? 'passed' : 'failed', type: pending.type });
      submitChallengeResult(pending.sessionId, pending.challengeId, {
        nonce: pending.nonce,
        outcome: clientOutcome,
        detail: outcome.reason ? { reason: outcome.reason } : null
      }).catch((err) => {
        // Best-effort, matching the one-shot flow's submitVerificationResult
        // handling — never blocks or alters what's already happened locally.
        console.warn('Failed to submit continuous challenge result:', err);
      });
    },
    []
  );

  const orchestrator = useVerificationOrchestrator({
    isCameraActive,
    isSessionActive: isMonitoringActive,
    startSession: () => setIsChallengeRunning(true),
    challengeEngine,
    lightChallengeEngine,
    continuous: { enabled: true, onChallengeResolved }
  });

  const runChallenge = useCallback(
    async (trigger) => {
      if (stateRef.current !== CONTINUOUS_STATE.ACTIVE) return; // single-flight guard
      try {
        const next = await getNextChallenge(sessionId, trigger);
        if (stateRef.current !== CONTINUOUS_STATE.ACTIVE) return; // torn down while awaiting
        if (next?.none) return; // backend is authoritative — its own cooldown/budget may disagree
        pendingChallengeRef.current = { ...next, sessionId, type: next.type };
        setState(CONTINUOUS_STATE.CHALLENGE_ACTIVE);
        schedulerControlsRef.current?.markChallengeStarted();
        onChallengeRef.current?.({ status: 'started', type: next.type });
        orchestrator.runContinuousChallenge(next.type);
      } catch (err) {
        console.warn('Failed to fetch next continuous challenge:', err);
      }
    },
    [sessionId, orchestrator]
  );

  const monitor = usePassiveMonitor({
    config,
    isActive: isMonitoringActive,
    onFlush: (events) => {
      if (!sessionId) return;
      submitEvents(sessionId, events).catch((err) => console.warn('Failed to flush continuous events:', err));
    },
    onImmediateTrigger: () => schedulerControlsRef.current?.requestEventTrigger(),
    onSuspiciousEvent: () => schedulerControlsRef.current?.noteSuspiciousEvent(),
    onEvent: (e) => onEventRef.current?.(e)
  });

  const schedulerControls = useChallengeScheduler({
    config,
    isActive: isMonitoringActive,
    onRunChallenge: runChallenge,
    clock,
    random: schedulerRandom,
    setIntervalFn,
    clearIntervalFn,
    pollIntervalMs: schedulerPollIntervalMs
  });
  const schedulerControlsRef = useRef(schedulerControls);
  schedulerControlsRef.current = schedulerControls;

  // monitor is a fresh object every render (its methods are individually
  // stable via useCallback, but the wrapping object isn't memoized) — kept
  // behind a ref so this effect only re-runs when faceCount itself
  // actually changes, not on every unrelated re-render.
  const monitorRef = useRef(monitor);
  monitorRef.current = monitor;
  useEffect(() => {
    if (!isCameraActive || faceCount === undefined) return;
    monitorRef.current.observeFaceCount(faceCount);
  }, [faceCount, isCameraActive]);

  // Fans each MediaPipe frame out to both challenge engines — identical to
  // App.jsx's own handleFrame for the one-shot flow. Not itself memoized
  // (challengeEngine/lightChallengeEngine are fresh objects every render,
  // same as in App.jsx), which is safe because useFaceLandmarker buffers
  // onFrame via its own internal ref rather than depending on identity.
  const processFrame = useCallback(
    (frame) => {
      challengeEngine.processFrame(frame);
      lightChallengeEngine.processFrame(frame);
    },
    [challengeEngine, lightChallengeEngine]
  );

  const start = useCallback(async () => {
    // Read live via the ref, not the captured `isCameraActive` primitive —
    // the caller (EngineBridge) may call this immediately after awaiting
    // startCamera(), so by the time this function's body actually runs,
    // the camera can already be active even though it wasn't at the
    // moment this particular closure was created.
    if (!isCameraActiveRef.current) return;
    setStartError(null);
    setState(CONTINUOUS_STATE.STARTING);
    try {
      const created = await createContinuousSession();
      if (!isCameraActiveRef.current) { setState(CONTINUOUS_STATE.IDLE); return; } // camera dropped mid-create
      await startContinuousSession(created.sessionId);
      if (!isCameraActiveRef.current) { setState(CONTINUOUS_STATE.IDLE); return; }
      setSessionId(created.sessionId);
      setState(CONTINUOUS_STATE.ACTIVE);
    } catch (err) {
      setStartError(err);
      setState(CONTINUOUS_STATE.IDLE);
    }
  }, []);

  const end = useCallback(
    async (reason = 'ENDED') => {
      if (stateRef.current === CONTINUOUS_STATE.ENDED || stateRef.current === CONTINUOUS_STATE.IDLE) return report;
      const idToEnd = sessionId;
      setState(CONTINUOUS_STATE.ENDED);
      if (!idToEnd) return null;
      try {
        const finalReport = await endContinuousSession(idToEnd, reason);
        setReport(finalReport);
        return finalReport;
      } catch (err) {
        console.warn('Failed to end continuous session:', err);
        return null;
      }
    },
    [sessionId, report]
  );

  // Camera drop -> hard teardown, mirroring the existing one-shot
  // stale-async protection. A best-effort ERROR-reason end call; if the
  // camera actually died the request may fail too, which is fine — the
  // local state is already torn down regardless.
  useEffect(() => {
    if (!isCameraActive && (state === CONTINUOUS_STATE.ACTIVE || state === CONTINUOUS_STATE.CHALLENGE_ACTIVE)) {
      end('CANCELLED');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraActive]);

  return {
    state,
    sessionId,
    challengesRun,
    report,
    startError,
    isChallengeRunning,
    orchPhase: orchestrator.orchPhase,
    processFrame,
    start,
    end,
    // The Light Challenge's screen flash is a required PHYSICAL side
    // effect (it has to actually illuminate the person's face for the
    // measurement to mean anything) — not an internal detail. Exposed as
    // just these two primitives, not the whole lightChallengeEngine
    // object, so EngineBridge can render the flash without needing
    // telemetry/scoring internals.
    isFlashActive: lightChallengeEngine.isFlashActive,
    flashColorCss: lightChallengeEngine.flashColorCss
  };
}
