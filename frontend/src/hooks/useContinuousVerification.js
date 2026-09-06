import { useCallback, useEffect, useRef, useState } from 'react';
import { useChallengeEngine } from './useChallengeEngine';
import { useLightChallengeEngine } from './useLightChallengeEngine';
import { useDepthProximityEngine } from './useDepthProximityEngine';
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
import { DEPTH_PROXIMITY_STATE } from '../constants/depthProximityConstants';

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
// PASSED/FAILED/TIMEOUT/ABORTED — no INCONCLUSIVE/INVALID slot exists, per
// §5's fixed event vocabulary, which has no "challenge_inconclusive" event
// type). LIGHT_INCONCLUSIVE and LIGHT_INVALID are BOTH mapped to ABORTED,
// not FAILED: ABORTED carries 'warning' severity server-side (see
// continuous_models.py's _RESULT_SEVERITY_BY_OUTCOME), which does NOT
// contribute failure points to the risk score — preserving the existing
// Light Challenge design's own "inconclusive is not a failure, only a
// supplementary signal" intent (see lightChallenge.js's module docstring)
// even though continuous mode now scores challenges individually.
//
// Phase 11 fix: LIGHT_INVALID used to map to FAILED here, which is wrong —
// LIGHT_INVALID means the measurement itself was unusable (face tracking
// lost, multiple faces, insufficient ambient light, too few valid samples;
// see useLightChallengeEngine.js's finishAsInvalid call sites), never that
// the candidate produced a suspicious/wrong response. Treating an unusable
// measurement as a failure double-penalized capture-quality problems the
// candidate didn't cause (see fusion.py's validity concept — an invalid
// Light attempt should carry v_light = 0 and disappear from evidence, not
// masquerade as a challenge_failed suspicion event). DEPTH_PROXIMITY
// already gets this distinction right below (its own INCONCLUSIVE, a
// tracking/quality problem, maps to ABORTED while its distinct FAILED
// state — a genuine wrong-direction movement — maps to FAILED); Light's
// engine has no such "wrong response" state at all (its evaluator only
// ever returns PASS or INCONCLUSIVE categorically), so every one of its
// non-PASS/TIMEOUT terminal states is a quality problem, never a verdict.
export function mapToClientOutcome(challengeKind, engineState) {
  if (challengeKind === 'LIGHT') {
    if (engineState === LIGHT_CHALLENGE_STATE.PASS) return 'PASSED';
    if (engineState === LIGHT_CHALLENGE_STATE.TIMEOUT) return 'TIMEOUT';
    return 'ABORTED'; // LIGHT_INCONCLUSIVE or LIGHT_INVALID
  }
  if (challengeKind === 'DEPTH_PROXIMITY') {
    // Phase 10: DEPTH_INCONCLUSIVE (tracking/measurement quality was
    // insufficient — face loss, multi-face, abrupt/discontinuous scale
    // jump, excessive pose change, or an already-too-close baseline) is
    // mapped to ABORTED, not FAILED, for the same reason LIGHT_INCONCLUSIVE
    // is above: a quality problem is not evidence the candidate did the
    // wrong thing, and must not carry challenge_failed's risk weight.
    // DEPTH_FAILED is a genuine, distinct state (sustained movement in the
    // wrong direction with good tracking) and does map to FAILED.
    if (engineState === DEPTH_PROXIMITY_STATE.PASS) return 'PASSED';
    if (engineState === DEPTH_PROXIMITY_STATE.INCONCLUSIVE) return 'ABORTED';
    if (engineState === DEPTH_PROXIMITY_STATE.TIMEOUT) return 'TIMEOUT';
    return 'FAILED'; // DEPTH_FAILED
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
// Builds a trailing-args array that's empty when apiBaseUrl is unset, so
// call sites asserted via toHaveBeenCalledWith(...) in
// useContinuousVerification.test.js keep seeing the exact same argument
// list as before Phase 9 whenever no apiBaseUrl override is configured
// (the case for every existing test, and for the standalone demo).
function withApiBase(apiBaseUrl) {
  return apiBaseUrl ? [{ apiBaseUrl }] : [];
}

export function useContinuousVerification({
  isCameraActive,
  videoRef,
  faceCount,
  onEvent,
  onChallenge,
  // Phase 9: overrides the same-origin `/api` proxy default so a genuinely
  // separate-origin consumer (see continuousSessionApi.js's module
  // docstring) can point at wherever the Reality Check backend actually
  // runs. Undefined -> byte-identical pre-Phase-9 behavior.
  apiBaseUrl,
  // Phase 9: opaque caller correlation id (e.g. an assessmentAttemptId),
  // attached once at session creation — see continuous_schemas.py's
  // CreateContinuousSessionRequest.
  externalRef,
  // Phase 11: the candidate's own photosensitivity disclosure at the
  // consent gate (see ContinuousConsentGate.jsx) — attached once at
  // session creation, same as externalRef. True permanently excludes
  // LIGHT from this session's server-drawn challenge pool.
  disableLightChallenge,
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
  // apiBaseUrl practically never changes mid-session, but is read via a ref
  // (matching every other cross-render value this file's memoized
  // callbacks close over) rather than added to their dependency arrays, so
  // it can't introduce staleness bugs if it ever did.
  const apiBaseUrlRef = useRef(apiBaseUrl);
  apiBaseUrlRef.current = apiBaseUrl;
  const externalRefRef = useRef(externalRef);
  externalRefRef.current = externalRef;
  const disableLightChallengeRef = useRef(disableLightChallenge);
  disableLightChallengeRef.current = disableLightChallenge;

  // Set once start() actually reaches ACTIVE; lets every passively-observed
  // event carry a clientOffsetMs (ms since monitoring began) alongside the
  // server's own wall-clock timestamp, so a consumer recording video
  // alongside this session (Phase 9's whole reason for existing) can align
  // "this event happened at t=+21400ms" with its own recording's timeline
  // without the two clocks needing to agree on wall-clock time.
  const sessionStartRef = useRef(null);

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
  const depthProximityEngine = useDepthProximityEngine({
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
      // Phase 10: outcome.measurements (currently only populated by the
      // Depth/Proximity engine — see its telemetry.measurements) is folded
      // into the same free-form `detail` blob Head Turn/Light already use,
      // rather than given a separate submission path — detail is a
      // free-form dict server-side (ChallengeResultRequest.detail) for
      // exactly this reason. Head Turn never sets outcome.measurements or
      // any Light-specific field, so its `detail` shape is unchanged:
      // `{reason}` or null.
      // Phase 11: outcome.lightScore/lightValidity/lightDiagnostics (only
      // populated for pending.type === 'LIGHT' — see
      // useVerificationOrchestrator.js's LIGHT_CHALLENGE effect) are folded
      // in under the exact `lightScore`/`lightValidity`/`diagnostics` keys
      // backend/app/fusion.py's score_light() and
      // continuous_models.build_report's challengeEvidence export read
      // them back out under.
      const hasLightEvidence = pending.type === 'LIGHT' && outcome.lightValidity !== undefined;
      const detail = outcome.reason || outcome.measurements || hasLightEvidence
        ? {
            reason: outcome.reason ?? null,
            ...(outcome.measurements ? { measurements: outcome.measurements } : {}),
            ...(hasLightEvidence
              ? {
                  lightScore: outcome.lightScore,
                  lightValidity: outcome.lightValidity,
                  diagnostics: outcome.lightDiagnostics
                }
              : {})
          }
        : null;
      submitChallengeResult(
        pending.sessionId,
        pending.challengeId,
        {
          nonce: pending.nonce,
          outcome: clientOutcome,
          detail
        },
        ...withApiBase(apiBaseUrlRef.current)
      ).catch((err) => {
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
    depthProximityEngine,
    continuous: { enabled: true, onChallengeResolved }
  });

  const runChallenge = useCallback(
    async (trigger) => {
      if (stateRef.current !== CONTINUOUS_STATE.ACTIVE) return; // single-flight guard
      try {
        const next = await getNextChallenge(sessionId, trigger, { apiBaseUrl: apiBaseUrlRef.current });
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
      submitEvents(sessionId, events, { apiBaseUrl: apiBaseUrlRef.current }).catch((err) =>
        console.warn('Failed to flush continuous events:', err)
      );
    },
    onImmediateTrigger: () => schedulerControlsRef.current?.requestEventTrigger(),
    onSuspiciousEvent: () => schedulerControlsRef.current?.noteSuspiciousEvent(),
    onEvent: (e) => onEventRef.current?.(e),
    getClientOffsetMs: () => (sessionStartRef.current == null ? null : clock() - sessionStartRef.current)
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
      depthProximityEngine.processFrame(frame);
    },
    [challengeEngine, lightChallengeEngine, depthProximityEngine]
  );

  const start = useCallback(async () => {
    // Read live via the ref, not the captured `isCameraActive` primitive —
    // the caller (EngineBridge) may call this immediately after awaiting
    // startCamera(), so by the time this function's body actually runs,
    // the camera can already be active even though it wasn't at the
    // moment this particular closure was created.
    if (!isCameraActiveRef.current) return null;
    setStartError(null);
    setState(CONTINUOUS_STATE.STARTING);
    try {
      const created = await createContinuousSession({
        apiBaseUrl: apiBaseUrlRef.current,
        externalRef: externalRefRef.current,
        disableLightChallenge: disableLightChallengeRef.current
      });
      if (!isCameraActiveRef.current) { setState(CONTINUOUS_STATE.IDLE); return null; } // camera dropped mid-create
      await startContinuousSession(created.sessionId, ...withApiBase(apiBaseUrlRef.current));
      if (!isCameraActiveRef.current) { setState(CONTINUOUS_STATE.IDLE); return null; }
      sessionStartRef.current = clock();
      setSessionId(created.sessionId);
      setState(CONTINUOUS_STATE.ACTIVE);
      return created.sessionId;
    } catch (err) {
      setStartError(err);
      setState(CONTINUOUS_STATE.IDLE);
      return null;
    }
  }, [clock]);

  const end = useCallback(
    async (reason = 'ENDED') => {
      if (stateRef.current === CONTINUOUS_STATE.ENDED || stateRef.current === CONTINUOUS_STATE.IDLE) return report;
      const idToEnd = sessionId;
      setState(CONTINUOUS_STATE.ENDED);
      if (!idToEnd) return null;
      try {
        const finalReport = await endContinuousSession(idToEnd, reason, ...withApiBase(apiBaseUrlRef.current));
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
