import { useState, useRef, useCallback, useEffect } from 'react';
import { CHALLENGE_STATE, CHALLENGE_TYPES } from '../constants/challengeConstants';
import { LIGHT_CHALLENGE_STATE } from '../constants/lightChallengeConstants';

/**
 * Verification orchestration — sequences the existing, unmodified Head-Turn
 * and Light Challenge engines into one coherent flow with a single combined
 * verdict. Owns no detection logic itself: only sequencing, randomized
 * direction selection, consent gating, and verdict aggregation.
 *
 * Head Turn is the PRIMARY required challenge. Light Challenge is a
 * SECONDARY supplementary signal — its outcome is always reported, never
 * gates VERIFIED/NOT VERIFIED (see verdict logic below), consistent with
 * useLightChallengeEngine's own "supplementary signal only" design intent.
 */
export const ORCH_PHASE = {
  IDLE: 'ORCH_IDLE',
  READY: 'ORCH_READY',
  HEAD_TURN: 'ORCH_HEAD_TURN',
  LIGHT_CONSENT: 'ORCH_LIGHT_CONSENT',
  LIGHT_CHALLENGE: 'ORCH_LIGHT_CHALLENGE',
  COMPLETE: 'ORCH_COMPLETE'
};

export const VERIFICATION_VERDICT = {
  VERIFIED: 'VERIFIED',
  INCOMPLETE_RETRY: 'INCOMPLETE_RETRY'
};

const DIRECTIONS = [CHALLENGE_TYPES.TURN_HEAD_LEFT, CHALLENGE_TYPES.TURN_HEAD_RIGHT];

function pickRandomDirection() {
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
}

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
  lightChallengeEngine
}) {
  const [orchPhase, setOrchPhase] = useState(ORCH_PHASE.IDLE);
  const [verdict, setVerdict] = useState(null);

  const orchPhaseRef = useRef(orchPhase);
  orchPhaseRef.current = orchPhase;

  // Camera/session drop -> reset cleanly, no stale verdict, regardless of
  // which phase the sequence was in.
  useEffect(() => {
    if (!isCameraActive || !isSessionActive) {
      setOrchPhase(ORCH_PHASE.IDLE);
      setVerdict(null);
    } else if (orchPhaseRef.current === ORCH_PHASE.IDLE) {
      setOrchPhase(ORCH_PHASE.READY);
    }
  }, [isCameraActive, isSessionActive]);

  // Head-Turn phase: react to the primary engine's terminal states.
  useEffect(() => {
    if (orchPhase !== ORCH_PHASE.HEAD_TURN) return;
    const s = challengeEngine.challengeState;
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
  }, [orchPhase, challengeEngine.challengeState, challengeEngine.invalidReason]);

  // Light Challenge phase: react to the secondary engine's terminal states.
  // Any terminal outcome (PASS/INCONCLUSIVE/TIMEOUT/INVALID) yields VERIFIED,
  // since Head Turn already succeeded and Light never gates the verdict.
  useEffect(() => {
    if (orchPhase !== ORCH_PHASE.LIGHT_CHALLENGE) return;
    const s = lightChallengeEngine.challengeState;
    if (LIGHT_TERMINAL_STATES.includes(s)) {
      setVerdict({
        outcome: VERIFICATION_VERDICT.VERIFIED,
        headTurn: { state: CHALLENGE_STATE.SUCCESS, reason: null },
        light: {
          state: s,
          reason: lightChallengeEngine.invalidReason || lightChallengeEngine.telemetry?.resultReason || null
        }
      });
      setOrchPhase(ORCH_PHASE.COMPLETE);
    }
  }, [orchPhase, lightChallengeEngine.challengeState, lightChallengeEngine.invalidReason, lightChallengeEngine.telemetry]);

  const startVerification = useCallback(() => {
    if (!isCameraActive) return;
    const direction = pickRandomDirection();
    challengeEngine.selectChallengeType(direction);
    setVerdict(null);
    setOrchPhase(ORCH_PHASE.HEAD_TURN);
    startSession();
  }, [isCameraActive, challengeEngine, startSession]);

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

  const retry = useCallback(() => {
    if (!isCameraActive || !isSessionActive) return;
    const direction = pickRandomDirection();
    lightChallengeEngine.resetEngine();
    challengeEngine.retryChallenge(direction);
    setVerdict(null);
    setOrchPhase(ORCH_PHASE.HEAD_TURN);
  }, [isCameraActive, isSessionActive, challengeEngine, lightChallengeEngine]);

  return {
    orchPhase,
    verdict,
    isOrchestrated: orchPhase !== ORCH_PHASE.IDLE,
    awaitingLightConsent: orchPhase === ORCH_PHASE.LIGHT_CONSENT,
    startVerification,
    acceptLightConsent,
    declineLightConsent,
    retry
  };
}
