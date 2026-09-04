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
function mapToClientOutcome(challengeKind, engineState) {
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
export function useContinuousVerification({ isCameraActive, videoRef, faceCount }) {
  const config = getRealityCheckConfig();

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
    onSuspiciousEvent: () => schedulerControlsRef.current?.noteSuspiciousEvent()
  });

  const schedulerControls = useChallengeScheduler({
    config,
    isActive: isMonitoringActive,
    onRunChallenge: runChallenge
  });
  const schedulerControlsRef = useRef(schedulerControls);
  schedulerControlsRef.current = schedulerControls;

  useEffect(() => {
    if (!isCameraActive || faceCount === undefined) return;
    monitor.observeFaceCount(faceCount);
  }, [faceCount, isCameraActive, monitor]);

  const start = useCallback(async () => {
    if (!isCameraActive) return;
    setStartError(null);
    setState(CONTINUOUS_STATE.STARTING);
    try {
      const created = await createContinuousSession();
      if (!isCameraActive) { setState(CONTINUOUS_STATE.IDLE); return; } // camera dropped mid-create
      await startContinuousSession(created.sessionId);
      if (!isCameraActive) { setState(CONTINUOUS_STATE.IDLE); return; }
      setSessionId(created.sessionId);
      setState(CONTINUOUS_STATE.ACTIVE);
    } catch (err) {
      setStartError(err);
      setState(CONTINUOUS_STATE.IDLE);
    }
  }, [isCameraActive]);

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
    start,
    end
  };
}
