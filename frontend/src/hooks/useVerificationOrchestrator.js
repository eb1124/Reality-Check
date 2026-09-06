import { useState, useRef, useCallback, useEffect } from 'react';
import { CHALLENGE_STATE, CHALLENGE_TYPES } from '../constants/challengeConstants';
import { LIGHT_CHALLENGE_STATE } from '../constants/lightChallengeConstants';
import { DEPTH_TERMINAL_STATES } from '../constants/depthProximityConstants';
import { createVerificationSession, submitVerificationResult } from '../api/sessionApi';

/**
 * Verification orchestration — sequences the existing, unmodified Head-Turn
 * and Light Challenge engines into one coherent flow with a single combined
 * verdict. Owns no detection logic itself: only sequencing, backend session
 * creation, consent gating, and verdict aggregation.
 *
 * Head Turn is the PRIMARY required challenge. Light Challenge is a
 * SECONDARY supplementary signal — its outcome is always reported, never
 * gates VERIFIED/NOT VERIFIED (see verdict logic below), consistent with
 * useLightChallengeEngine's own "supplementary signal only" design intent.
 *
 * The Head-Turn direction is server-assigned: starting a verification (and
 * every retry — a retry is a brand-new attempt) creates a backend session
 * (POST /sessions), and the direction it returns — never a client-side
 * random pick — is what's fed into the challenge engine.
 */
export const ORCH_PHASE = {
  IDLE: 'ORCH_IDLE',
  READY: 'ORCH_READY',
  HEAD_TURN: 'ORCH_HEAD_TURN',
  LIGHT_CONSENT: 'ORCH_LIGHT_CONSENT',
  LIGHT_CHALLENGE: 'ORCH_LIGHT_CHALLENGE',
  DEPTH_PROXIMITY: 'ORCH_DEPTH_PROXIMITY',
  COMPLETE: 'ORCH_COMPLETE'
};

export const VERIFICATION_VERDICT = {
  VERIFIED: 'VERIFIED',
  INCOMPLETE_RETRY: 'INCOMPLETE_RETRY'
};

const DIRECTION_TO_CHALLENGE_TYPE = {
  LEFT: CHALLENGE_TYPES.TURN_HEAD_LEFT,
  RIGHT: CHALLENGE_TYPES.TURN_HEAD_RIGHT
};

const LIGHT_TERMINAL_STATES = [
  LIGHT_CHALLENGE_STATE.PASS,
  LIGHT_CHALLENGE_STATE.INCONCLUSIVE,
  LIGHT_CHALLENGE_STATE.TIMEOUT,
  LIGHT_CHALLENGE_STATE.INVALID
];

export function useVerificationOrchestrator({
  isCameraActive,
  isSessionActive,
  startSession,
  challengeEngine,
  lightChallengeEngine,
  // Phase 10: the Depth/Proximity engine. Optional/undefined for the
  // one-shot flow (App.jsx never runs this challenge), always supplied by
  // useContinuousVerification.js. Every reference below is guarded so an
  // undefined depthProximityEngine is a safe, inert no-op — DEPTH_PROXIMITY
  // is only ever reachable via runContinuousChallenge, which already
  // requires continuous.enabled.
  depthProximityEngine,
  // Phase 7 continuous-session support. Undefined/omitted -> byte-identical
  // one-shot behavior (the default, used by App.jsx). When present, the
  // three terminal-state branches below report to
  // continuous.onChallengeResolved and return to READY instead of ever
  // reaching ORCH_COMPLETE, and runContinuousChallenge() (not
  // startVerification/retry) is the entry point. This orchestrator is
  // reused, not duplicated, for continuous mode specifically so that only
  // one state machine ever drives challengeEngine/lightChallengeEngine/
  // depthProximityEngine — a second, independently-driven consumer of the
  // same engines would be able to race the one below for the same camera.
  // continuous: { enabled: boolean, onChallengeResolved: (outcome) => void }
  continuous
}) {
  const [orchPhase, setOrchPhase] = useState(ORCH_PHASE.IDLE);
  const [verdict, setVerdict] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sessionError, setSessionError] = useState(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const orchPhaseRef = useRef(orchPhase);
  orchPhaseRef.current = orchPhase;

  // The server-assigned direction for the most recently created backend
  // session (set by beginNewSession — see below), consumed once the
  // session is actually applied to the challenge engine.
  const serverDirectionRef = useRef(null);
  // Guards against a double backend session being created if Start/Retry
  // is clicked again while a POST /sessions call is already in flight.
  const isStartingRef = useRef(false);
  // Tracks which sessionId's verdict has already been POSTed to the backend,
  // so the result-persistence effect below fires exactly once per session
  // (React effects can re-run on unrelated re-renders) rather than once per
  // render where orchPhase/verdict/sessionId all happen to be set.
  const resultSubmittedForSessionRef = useRef(null);

  // Camera/session drop -> reset cleanly, no stale verdict or session,
  // regardless of which phase the sequence was in.
  useEffect(() => {
    if (!isCameraActive || !isSessionActive) {
      setOrchPhase(ORCH_PHASE.IDLE);
      setVerdict(null);
      setSessionId(null);
      setSessionError(null);
      serverDirectionRef.current = null;
    } else if (orchPhaseRef.current === ORCH_PHASE.IDLE) {
      setOrchPhase(ORCH_PHASE.READY);
    }
  }, [isCameraActive, isSessionActive]);

  // Head-Turn phase: react to the primary engine's terminal states.
  useEffect(() => {
    if (orchPhase !== ORCH_PHASE.HEAD_TURN) return;
    const s = challengeEngine.challengeState;

    if (continuous?.enabled) {
      // Continuous mode: a standalone challenge, not the first half of a
      // paired Head-Turn -> Light sequence — ANY terminal state (including
      // SUCCESS) resolves and returns to READY (passive monitoring), never
      // ORCH_COMPLETE. There is no per-challenge Light Consent step in this
      // mode (consent is obtained once, up front, for the whole continuous
      // session).
      if (s === CHALLENGE_STATE.SUCCESS || s === CHALLENGE_STATE.TIMEOUT || s === CHALLENGE_STATE.INVALID) {
        continuous.onChallengeResolved({
          type: challengeEngine.currentChallengeType,
          state: s,
          reason: challengeEngine.invalidReason || null
        });
        challengeEngine.resetEngine();
        setOrchPhase(ORCH_PHASE.READY);
      }
      return;
    }

    if (s === CHALLENGE_STATE.SUCCESS) {
      setOrchPhase(ORCH_PHASE.LIGHT_CONSENT);
    } else if (s === CHALLENGE_STATE.TIMEOUT || s === CHALLENGE_STATE.INVALID) {
      // Covers TIMEOUT, generic tracking-loss INVALID, and multi-face INVALID
      // alike -> INCOMPLETE / RETRY REQUIRED for this MVP (no NOT VERIFIED path).
      setVerdict({
        outcome: VERIFICATION_VERDICT.INCOMPLETE_RETRY,
        headTurn: { state: s, reason: challengeEngine.invalidReason || null },
        light: { state: 'NOT_ATTEMPTED', reason: null }
      });
      setOrchPhase(ORCH_PHASE.COMPLETE);
    }
  }, [orchPhase, challengeEngine.challengeState, challengeEngine.invalidReason, challengeEngine.currentChallengeType, continuous]);

  // Light Challenge phase: react to the secondary engine's terminal states.
  // One-shot mode: any terminal outcome (PASS/INCONCLUSIVE/TIMEOUT/INVALID)
  // yields VERIFIED, since Head Turn already succeeded and Light never gates
  // the verdict. Continuous mode: same terminal states, but reports as a
  // standalone challenge result and returns to READY instead.
  useEffect(() => {
    if (orchPhase !== ORCH_PHASE.LIGHT_CHALLENGE) return;
    const s = lightChallengeEngine.challengeState;
    if (!LIGHT_TERMINAL_STATES.includes(s)) return;

    const reason = lightChallengeEngine.invalidReason || lightChallengeEngine.telemetry?.resultReason || null;

    if (continuous?.enabled) {
      // Phase 11: score/validity/diagnostics must be read out of telemetry
      // BEFORE resetEngine() below wipes it back to its empty defaults —
      // this is the one place that still has them, and they need to reach
      // the backend's per-challenge `detail` (see
      // useContinuousVerification.js's onChallengeResolved) so fusion can
      // use this specific attempt's evidence.
      continuous.onChallengeResolved({
        type: 'LIGHT',
        state: s,
        reason,
        lightScore: lightChallengeEngine.telemetry?.lightScore ?? 0,
        lightValidity: lightChallengeEngine.telemetry?.lightValidity ?? 0,
        lightDiagnostics: lightChallengeEngine.telemetry?.lightDiagnostics ?? null
      });
      lightChallengeEngine.resetEngine();
      setOrchPhase(ORCH_PHASE.READY);
      return;
    }

    setVerdict({
      outcome: VERIFICATION_VERDICT.VERIFIED,
      headTurn: { state: CHALLENGE_STATE.SUCCESS, reason: null },
      light: { state: s, reason }
    });
    setOrchPhase(ORCH_PHASE.COMPLETE);
  }, [orchPhase, lightChallengeEngine.challengeState, lightChallengeEngine.invalidReason, lightChallengeEngine.telemetry, continuous]);

  // Depth/Proximity phase (Phase 10): react to the engine's terminal
  // states. Continuous-only, mirroring the LIGHT_CHALLENGE effect above —
  // there is no one-shot equivalent (depthProximityEngine is undefined in
  // that mode, so this effect is inert there).
  useEffect(() => {
    if (orchPhase !== ORCH_PHASE.DEPTH_PROXIMITY || !depthProximityEngine) return;
    const s = depthProximityEngine.challengeState;
    if (!DEPTH_TERMINAL_STATES.includes(s)) return;

    const reason = depthProximityEngine.invalidReason || depthProximityEngine.telemetry?.resultReason || null;

    if (continuous?.enabled) {
      continuous.onChallengeResolved({
        type: 'DEPTH_PROXIMITY',
        state: s,
        reason,
        measurements: depthProximityEngine.telemetry?.measurements ?? null
      });
      depthProximityEngine.resetEngine();
      setOrchPhase(ORCH_PHASE.READY);
    }
    // Depth/Proximity has no one-shot path (it never gates VERIFIED/
    // INCOMPLETE_RETRY) — unlike Head Turn/Light, nothing else to do here.
  }, [orchPhase, depthProximityEngine?.challengeState, depthProximityEngine?.invalidReason, depthProximityEngine?.telemetry, depthProximityEngine, continuous]);

  // Persist the verdict against its backend session once reached — the
  // authoritative session record otherwise stays PENDING forever, since
  // POST /sessions/{id}/result is the only thing that ever finalizes it.
  // Best-effort: a failure here never alters or blocks the result already
  // shown to the user (see submitVerificationResult docstring for the
  // client-reported-evidence trust model this relies on).
  useEffect(() => {
    if (orchPhase !== ORCH_PHASE.COMPLETE || !verdict || !sessionId) return;
    if (resultSubmittedForSessionRef.current === sessionId) return;
    resultSubmittedForSessionRef.current = sessionId;
    submitVerificationResult(sessionId, {
      outcome: verdict.outcome,
      headTurnOutcome: verdict.headTurn?.state ?? null,
      lightChallengeOutcome: verdict.light?.state ?? null
    }).catch((err) => {
      console.warn('Failed to persist verification result to backend session:', err);
    });
  }, [orchPhase, verdict, sessionId]);

  // Shared by startVerification and retry — both a fresh start and a retry
  // are, from the backend's point of view, the same thing: a new session.
  // Authoritative session + direction always come from the backend; on any
  // failure this throws nothing and returns null, so callers never proceed
  // with a local/fake session or a stale direction.
  const beginNewSession = useCallback(async () => {
    if (isStartingRef.current) return null;
    isStartingRef.current = true;
    setSessionError(null);
    setIsCreatingSession(true);
    try {
      const session = await createVerificationSession();
      const direction = DIRECTION_TO_CHALLENGE_TYPE[session.headTurnDirection];
      serverDirectionRef.current = direction;
      setSessionId(session.sessionId);
      return direction;
    } catch (err) {
      setSessionError(err);
      return null;
    } finally {
      setIsCreatingSession(false);
      isStartingRef.current = false;
    }
  }, []);

  const startVerification = useCallback(async () => {
    if (!isCameraActive) return;
    
    // Explicitly transition out of IDLE before creating a session so
    // our own race-condition check doesn't falsely abort the start.
    setOrchPhase(ORCH_PHASE.READY);
    
    const direction = await beginNewSession();
    if (!direction) {
      // Revert if backend fails so we aren't stuck in READY
      setOrchPhase(ORCH_PHASE.IDLE);
      return;
    }
    // The camera/session may have been stopped while the new session was
    // being created — if so, orchPhase is already back to IDLE (reset
    // effect above) and this must not resurrect a stale attempt.
    if (orchPhaseRef.current === ORCH_PHASE.IDLE) return;
    challengeEngine.selectChallengeType(direction);
    setVerdict(null);
    setOrchPhase(ORCH_PHASE.HEAD_TURN);
    startSession();
  }, [isCameraActive, challengeEngine, startSession, beginNewSession]);

  const acceptLightConsent = useCallback(() => {
    if (orchPhaseRef.current !== ORCH_PHASE.LIGHT_CONSENT) return;
    setOrchPhase(ORCH_PHASE.LIGHT_CHALLENGE);
    lightChallengeEngine.startLightChallenge();
  }, [lightChallengeEngine]);

  const declineLightConsent = useCallback(() => {
    if (orchPhaseRef.current !== ORCH_PHASE.LIGHT_CONSENT) return;
    setVerdict({
      outcome: VERIFICATION_VERDICT.INCOMPLETE_RETRY,
      headTurn: { state: CHALLENGE_STATE.SUCCESS, reason: null },
      light: { state: 'DECLINED', reason: null }
    });
    setOrchPhase(ORCH_PHASE.COMPLETE);
  }, []);

  // Retry = a brand-new verification attempt: a fresh backend session with
  // its own sessionId and its own server-assigned direction, never a
  // replay of the previous attempt's direction.
  const retry = useCallback(async () => {
    if (!isCameraActive || !isSessionActive) return;
    const direction = await beginNewSession();
    if (!direction) return;
    // The camera/session may have been stopped while the new session was
    // being created — if so, orchPhase is already back to IDLE (reset
    // effect above) and this retry must not resurrect a stale attempt.
    if (orchPhaseRef.current === ORCH_PHASE.IDLE) return;
    lightChallengeEngine.resetEngine();
    challengeEngine.retryChallenge(direction);
    setVerdict(null);
    setOrchPhase(ORCH_PHASE.HEAD_TURN);
  }, [isCameraActive, isSessionActive, challengeEngine, lightChallengeEngine, beginNewSession]);

  // Continuous-session entry point (Phase 7) — the challenge scheduler's
  // only way to run a challenge; it must never call challengeEngine /
  // lightChallengeEngine directly itself (see the `continuous` param
  // comment above). Unlike startVerification/retry, this never creates a
  // one-shot backend session — the scheduler already obtained a
  // {challengeId, nonce} from POST /sessions/continuous/{id}/next-challenge
  // before calling this, and reports the outcome itself once
  // continuous.onChallengeResolved fires (see the two terminal-state
  // effects above). No per-challenge Light Consent step: continuous-session
  // consent is obtained once, up front, for the whole monitoring session.
  const runContinuousChallenge = useCallback((challengeType) => {
    if (!continuous?.enabled) return;
    if (!isCameraActive) return;
    // READY-only, mirroring the single-flight guard the scheduler itself
    // already enforces — defense in depth, same layering style as
    // isStartingRef above guarding against a double beginNewSession call.
    if (orchPhaseRef.current !== ORCH_PHASE.READY) return;
    setVerdict(null);
    if (challengeType === 'LIGHT') {
      setOrchPhase(ORCH_PHASE.LIGHT_CHALLENGE);
      startSession();
      // startLightChallenge() is NOT called here — see the
      // "arm LIGHT/DEPTH_PROXIMITY once isChallengeRunning has committed"
      // effect below for why calling it synchronously in this same tick
      // used to silently no-op.
    } else if (challengeType === 'DEPTH_PROXIMITY') {
      if (!depthProximityEngine) return;
      setOrchPhase(ORCH_PHASE.DEPTH_PROXIMITY);
      startSession();
      // Same deferral as LIGHT above — see the effect below.
    } else {
      challengeEngine.selectChallengeType(challengeType);
      setOrchPhase(ORCH_PHASE.HEAD_TURN);
      startSession();
    }
  }, [continuous, isCameraActive, challengeEngine, lightChallengeEngine, depthProximityEngine, startSession]);

  // Arm LIGHT/DEPTH_PROXIMITY once isChallengeRunning has actually
  // committed (continuous mode only).
  //
  // BUG THIS FIXES: runContinuousChallenge above calls startSession()
  // (which does setIsChallengeRunning(true) in useContinuousVerification.js)
  // and then, in the OLD code, called
  // lightChallengeEngine.startLightChallenge()/
  // depthProximityEngine.startDepthProximityChallenge() SYNCHRONOUSLY, in
  // the same tick. React batches the setIsChallengeRunning update, so
  // useLightChallengeEngine/useDepthProximityEngine's `isSessionActive`
  // prop — and therefore the `lightChallengeEngine`/`depthProximityEngine`
  // closures this function already holds — still reflected the PRE-update
  // value (false) at the moment those start functions ran. Both engines'
  // own start functions guard on `if (!isSessionActive) return;` (see
  // useLightChallengeEngine.js/useDepthProximityEngine.js), so the call
  // silently no-op'd: the engine stayed in its IDLE state forever, no
  // flash/challenge UI ever appeared, and — since nothing ever reached a
  // terminal state — the challenge never resolved (the "please respond
  // now" banner just hung indefinitely). Head Turn never had this bug
  // because useChallengeEngine's own internal effect reactively drives
  // IDLE -> PREPARING off the *committed* isSessionActive value, rather
  // than relying on an imperative call made in the same tick as the
  // setState that flips it.
  //
  // The fix: don't call the engine's start function inline. Instead, wait
  // for the render this effect fires in — which only happens AFTER
  // isChallengeRunning (and therefore isSessionActive) has committed.
  //
  // Armed exactly once per phase-entry via a ref, NOT by checking
  // `challengeState === IDLE` — lightChallengeEngine/depthProximityEngine
  // are fresh objects every render (neither hook memoizes its returned
  // object), so this effect legitimately re-fires often. Gating re-entry
  // on the engine's own state would be fine against the real engine (its
  // very first act is to leave IDLE), but is fragile against anything
  // that doesn't change `challengeState` synchronously in response to the
  // start call — e.g. this exact scenario surfaced against the test
  // double in useLightChallengeEngine.test mocks, where calling the mock's
  // startLightChallenge() re-renders listeners without necessarily
  // changing the reported state, re-triggering this effect and calling
  // start again, forever. The ref sidesteps that entirely: at most one
  // call per LIGHT_CHALLENGE/DEPTH_PROXIMITY phase-entry, full stop,
  // reset only when the phase actually changes.
  const lightArmedRef = useRef(false);
  useEffect(() => {
    if (orchPhase !== ORCH_PHASE.LIGHT_CHALLENGE) {
      lightArmedRef.current = false;
      return;
    }
    if (!continuous?.enabled || lightArmedRef.current) return;
    lightArmedRef.current = true;
    lightChallengeEngine.startLightChallenge();
  }, [orchPhase, continuous, lightChallengeEngine]);

  const depthArmedRef = useRef(false);
  useEffect(() => {
    if (orchPhase !== ORCH_PHASE.DEPTH_PROXIMITY) {
      depthArmedRef.current = false;
      return;
    }
    if (!continuous?.enabled || !depthProximityEngine || depthArmedRef.current) return;
    depthArmedRef.current = true;
    depthProximityEngine.startDepthProximityChallenge();
  }, [orchPhase, continuous, depthProximityEngine]);

  return {
    orchPhase,
    verdict,
    sessionId,
    sessionError,
    isCreatingSession,
    isOrchestrated: orchPhase !== ORCH_PHASE.IDLE,
    awaitingLightConsent: orchPhase === ORCH_PHASE.LIGHT_CONSENT,
    startVerification,
    acceptLightConsent,
    declineLightConsent,
    retry,
    runContinuousChallenge
  };
}
