import { useState, useRef, useCallback, useEffect } from 'react';
import {
  DEPTH_PROXIMITY_STATE,
  DEPTH_PROXIMITY_CONFIG
} from '../constants/depthProximityConstants';
import { computeDepthSample, evaluateDepthProgress } from '../challenges/depthProximity';
import { extractYawFromMatrix } from '../challenges/headTurn';

function round(value, digits = 3) {
  if (value == null || Number.isNaN(value)) return value;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

const EMPTY_TELEMETRY = {
  requiredScaleRatio: DEPTH_PROXIMITY_CONFIG.requiredScaleRatio,
  requiredBaselineFrames: DEPTH_PROXIMITY_CONFIG.requiredBaselineFrames,
  baselineFrameCount: 0,
  currentScaleRatio: null,
  peakScaleRatio: null,
  progressRatio: 0,
  resultReason: '',
  measurements: null
};

/**
 * Depth / Proximity Challenge engine (Reality Check, Phase 10) — "move
 * closer to the camera". Independent of, and never reads or mutates,
 * useChallengeEngine.js (head turn) or useLightChallengeEngine.js (light
 * response). Mirrors their session/camera lifecycle and terminal-state
 * conventions so useVerificationOrchestrator.js can drive all three
 * uniformly (see that hook's DEPTH_PROXIMITY branch).
 *
 * Unlike Light Challenge, no canvas/pixel sampling is needed — only the
 * MediaPipe landmark geometry already produced for every frame, plus the
 * video element's pixel dimensions (for landmark-to-pixel conversion).
 *
 * Decision model (see challenges/depthProximity.js and
 * constants/depthProximityConstants.js for the full rationale of every
 * PROVISIONAL threshold referenced below):
 *   1. Capture a baseline interocular distance (own-face reference, not a
 *      population threshold).
 *   2. Track the EMA-smoothed scale ratio (current / baseline) every frame.
 *   3. PASS requires the ratio to reach and sustain requiredScaleRatio for
 *      a minimum hold duration/frame count (temporal shape, not a single
 *      instantaneous frame) — but a PASS reached via a suspiciously abrupt
 *      transition, a large simultaneous pose change, or too few transition
 *      frames is downgraded to INCONCLUSIVE rather than asserted.
 *   4. Sustained movement in the opposite direction is a genuine FAILED
 *      (the candidate did something clearly incompatible with the
 *      instruction), distinct from INCONCLUSIVE (tracking/measurement
 *      quality was insufficient to judge at all) — see the Phase 10 report
 *      for why INCONCLUSIVE deliberately does not carry the same risk
 *      weight as FAILED (mapToClientOutcome in useContinuousVerification.js
 *      maps INCONCLUSIVE to ABORTED, not FAILED).
 */
export function useDepthProximityEngine({ isSessionActive, isCameraActive, videoRef }) {
  const [challengeState, setChallengeState] = useState(DEPTH_PROXIMITY_STATE.IDLE);
  const [baselineProgress, setBaselineProgress] = useState(0);
  const [remainingTime, setRemainingTime] = useState(0);
  const [responseTime, setResponseTime] = useState(null);
  const [invalidReason, setInvalidReason] = useState('');
  const [telemetry, setTelemetry] = useState(EMPTY_TELEMETRY);

  const config = DEPTH_PROXIMITY_CONFIG;

  const stateRef = useRef(challengeState);
  stateRef.current = challengeState;

  const attemptStartTimeRef = useRef(null);
  const phaseStartTimeRef = useRef(null);
  const noFaceStartTimestampRef = useRef(null);

  const baselineSamplesRef = useRef([]); // [{ interocularPx, faceWidthPx, yawDeg }]
  const baselineRef = useRef(null); // { interocularPx, faceWidthPx, widthToInterocularRatio, yawDeg }

  const prevRawScaleRatioRef = useRef(null);
  const smoothedScaleRatioRef = useRef(null);
  const maxScaleRatioRef = useRef(1);
  const discontinuitySuspectedRef = useRef(false);
  const maxSingleFrameJumpRef = useRef(0);
  const movementStartTimeRef = useRef(null);
  const transitionFrameCountRef = useRef(0);

  const holdStartTimestampRef = useRef(null);
  const consecutivePassFramesRef = useRef(0);
  const failHoldStartTimestampRef = useRef(null);
  const consecutiveFailFramesRef = useRef(0);

  const resetBuffers = useCallback(() => {
    attemptStartTimeRef.current = null;
    phaseStartTimeRef.current = null;
    noFaceStartTimestampRef.current = null;
    baselineSamplesRef.current = [];
    baselineRef.current = null;
    prevRawScaleRatioRef.current = null;
    smoothedScaleRatioRef.current = null;
    maxScaleRatioRef.current = 1;
    discontinuitySuspectedRef.current = false;
    maxSingleFrameJumpRef.current = 0;
    movementStartTimeRef.current = null;
    transitionFrameCountRef.current = 0;
    holdStartTimestampRef.current = null;
    consecutivePassFramesRef.current = 0;
    failHoldStartTimestampRef.current = null;
    consecutiveFailFramesRef.current = 0;
  }, []);

  const resetEngine = useCallback(() => {
    setChallengeState(DEPTH_PROXIMITY_STATE.IDLE);
    setBaselineProgress(0);
    setRemainingTime(0);
    setResponseTime(null);
    setInvalidReason('');
    setTelemetry(EMPTY_TELEMETRY);
    resetBuffers();
  }, [resetBuffers]);

  // Camera/session lifecycle: like Light Challenge, this does NOT auto-arm
  // on session start — a scheduler-initiated challenge always starts via an
  // explicit startDepthProximityChallenge() call (see
  // useVerificationOrchestrator.js's runContinuousChallenge).
  useEffect(() => {
    if (!isSessionActive || !isCameraActive) {
      resetEngine();
    }
  }, [isSessionActive, isCameraActive, resetEngine]);

  const startDepthProximityChallenge = useCallback(() => {
    if (!isSessionActive || !isCameraActive) return;
    resetBuffers();
    setBaselineProgress(0);
    setResponseTime(null);
    setInvalidReason('');
    setTelemetry(EMPTY_TELEMETRY);
    attemptStartTimeRef.current = performance.now();
    setRemainingTime(config.timeoutSeconds);
    setChallengeState(DEPTH_PROXIMITY_STATE.PREPARING);
  }, [isSessionActive, isCameraActive, resetBuffers, config.timeoutSeconds]);

  const finishChallenge = useCallback((state, reason, measurements) => {
    setChallengeState(state);
    setInvalidReason(reason || '');
    setTelemetry((prev) => ({ ...prev, resultReason: reason || '', measurements: measurements ?? prev.measurements }));
  }, []);

  const finishAsTimeout = useCallback(() => {
    setChallengeState(DEPTH_PROXIMITY_STATE.TIMEOUT);
  }, []);

  const processFrame = useCallback(
    ({ landmarks, transformationMatrix, faceCount, timestamp }) => {
      const currentState = stateRef.current;
      if (!isSessionActive || !isCameraActive || currentState === DEPTH_PROXIMITY_STATE.IDLE) {
        return;
      }

      const terminal = [
        DEPTH_PROXIMITY_STATE.PASS,
        DEPTH_PROXIMITY_STATE.FAILED,
        DEPTH_PROXIMITY_STATE.INCONCLUSIVE,
        DEPTH_PROXIMITY_STATE.TIMEOUT
      ];
      if (terminal.includes(currentState)) return;

      const now = timestamp || performance.now();
      const video = videoRef?.current;

      // Overall attempt timeout budget, checked in every active phase.
      if (attemptStartTimeRef.current != null) {
        const elapsedSec = (now - attemptStartTimeRef.current) / 1000;
        setRemainingTime(Math.max(0, parseFloat((config.timeoutSeconds - elapsedSec).toFixed(1))));
        if (elapsedSec >= config.timeoutSeconds) {
          finishAsTimeout();
          return;
        }
      }

      // State: PREPARING -> gate on single-face acquisition.
      if (currentState === DEPTH_PROXIMITY_STATE.PREPARING) {
        if (faceCount === 1 && landmarks) {
          phaseStartTimeRef.current = now;
          setChallengeState(DEPTH_PROXIMITY_STATE.BASELINE);
        }
        return;
      }

      // Explicit face-loss / multi-face handling, shared by BASELINE/ACTIVE.
      // Deliberately downgraded to INCONCLUSIVE (not FAILED) here — see the
      // module docstring: a tracking-quality problem is not evidence the
      // candidate did the wrong thing, and Phase 10 requires it not carry
      // the same risk weight as a genuine FAILED.
      if (faceCount === 0) {
        if (noFaceStartTimestampRef.current === null) {
          noFaceStartTimestampRef.current = now;
        }
        if (now - noFaceStartTimestampRef.current >= config.faceLossGraceMs) {
          finishChallenge(DEPTH_PROXIMITY_STATE.INCONCLUSIVE, 'Face tracking lost — no face detected.', null);
          return;
        }
        if (currentState !== DEPTH_PROXIMITY_STATE.BASELINE) return;
      } else {
        noFaceStartTimestampRef.current = null;
      }

      if (faceCount > 1) {
        finishChallenge(DEPTH_PROXIMITY_STATE.INCONCLUSIVE, 'Integrity violation — multiple faces detected.', null);
        return;
      }

      if (!video || video.videoWidth === 0) return;

      // State: BASELINE -> neutral distance, collecting pre-movement samples.
      if (currentState === DEPTH_PROXIMITY_STATE.BASELINE) {
        if (faceCount !== 1 || !landmarks) {
          baselineSamplesRef.current = [];
          setBaselineProgress(0);
          return;
        }

        const sample = computeDepthSample(landmarks, video.videoWidth, video.videoHeight);
        if (!sample) return;
        const yawInfo = extractYawFromMatrix(transformationMatrix);

        baselineSamplesRef.current.push({
          interocularPx: sample.interocularPx,
          faceWidthPx: sample.faceWidthPx,
          widthToInterocularRatio: sample.widthToInterocularRatio,
          yawDeg: yawInfo.isValid ? yawInfo.yawDeg : null
        });

        const count = baselineSamplesRef.current.length;
        setBaselineProgress(Math.min((count / config.requiredBaselineFrames) * 100, 100));

        if (count >= config.requiredBaselineFrames) {
          const samples = baselineSamplesRef.current;
          const avg = (field) => samples.reduce((acc, s) => acc + s[field], 0) / samples.length;
          const yawSamples = samples.filter((s) => s.yawDeg != null);
          const baselineYawDeg = yawSamples.length > 0 ? yawSamples.reduce((a, s) => a + s.yawDeg, 0) / yawSamples.length : null;

          const baselineInterocularPx = avg('interocularPx');
          baselineRef.current = {
            interocularPx: baselineInterocularPx,
            faceWidthPx: avg('faceWidthPx'),
            widthToInterocularRatio: avg('widthToInterocularRatio'),
            yawDeg: baselineYawDeg
          };

          setTelemetry((prev) => ({
            ...prev,
            baselineFrameCount: count,
            currentScaleRatio: 1,
            peakScaleRatio: 1
          }));

          if (baselineInterocularPx / video.videoWidth > config.maxBaselineInterocularToWidthRatio) {
            finishChallenge(
              DEPTH_PROXIMITY_STATE.INCONCLUSIVE,
              'Already very close to the camera — insufficient room to move closer for a reliable measurement.',
              { baselineInterocularPx: round(baselineInterocularPx, 1) }
            );
            return;
          }

          phaseStartTimeRef.current = now;
          setChallengeState(DEPTH_PROXIMITY_STATE.ACTIVE);
        }
        return;
      }

      // State: ACTIVE -> instructed to move closer; tracking scale ratio.
      if (currentState === DEPTH_PROXIMITY_STATE.ACTIVE) {
        if (faceCount !== 1 || !landmarks) return; // handled by the shared guard above; nothing to sample this frame

        const sample = computeDepthSample(landmarks, video.videoWidth, video.videoHeight);
        if (!sample) return;

        const baseline = baselineRef.current;
        const rawScaleRatio = sample.interocularPx / baseline.interocularPx;

        if (prevRawScaleRatioRef.current != null) {
          const jump = Math.abs(rawScaleRatio - prevRawScaleRatioRef.current);
          if (jump > maxSingleFrameJumpRef.current) maxSingleFrameJumpRef.current = jump;
          if (jump > config.maxPerFrameScaleJump) discontinuitySuspectedRef.current = true;
        }
        prevRawScaleRatioRef.current = rawScaleRatio;

        smoothedScaleRatioRef.current =
          smoothedScaleRatioRef.current == null
            ? rawScaleRatio
            : config.smoothingAlpha * rawScaleRatio + (1 - config.smoothingAlpha) * smoothedScaleRatioRef.current;
        const smoothedScaleRatio = smoothedScaleRatioRef.current;

        maxScaleRatioRef.current = Math.max(maxScaleRatioRef.current, smoothedScaleRatio);
        transitionFrameCountRef.current += 1;
        if (movementStartTimeRef.current === null && smoothedScaleRatio >= config.movementStartRatio) {
          movementStartTimeRef.current = now;
        }

        const yawInfo = extractYawFromMatrix(transformationMatrix);
        const currentYawDeg = yawInfo.isValid ? yawInfo.yawDeg : null;
        const poseDeltaDeg =
          currentYawDeg != null && baseline.yawDeg != null ? Math.abs(currentYawDeg - baseline.yawDeg) : null;

        const evalResult = evaluateDepthProgress(smoothedScaleRatio, config);

        setTelemetry((prev) => ({
          ...prev,
          currentScaleRatio: round(smoothedScaleRatio, 3),
          peakScaleRatio: round(maxScaleRatioRef.current, 3),
          progressRatio: evalResult.progressRatio
        }));

        const buildMeasurements = () => ({
          baselineInterocularPx: round(baseline.interocularPx, 1),
          peakScaleRatio: round(maxScaleRatioRef.current, 3),
          finalScaleRatio: round(smoothedScaleRatio, 3),
          movementDurationMs:
            movementStartTimeRef.current != null ? round(now - movementStartTimeRef.current, 0) : null,
          transitionFrameCount: transitionFrameCountRef.current,
          baselineYawDeg: baseline.yawDeg != null ? round(baseline.yawDeg, 2) : null,
          poseDeltaDeg: poseDeltaDeg != null ? round(poseDeltaDeg, 2) : null,
          discontinuitySuspected: discontinuitySuspectedRef.current,
          maxSingleFrameScaleJump: round(maxSingleFrameJumpRef.current, 3),
          perspectiveFeature: {
            baselineWidthToInterocularRatio:
              baseline.widthToInterocularRatio != null ? round(baseline.widthToInterocularRatio, 3) : null,
            currentWidthToInterocularRatio:
              sample.widthToInterocularRatio != null ? round(sample.widthToInterocularRatio, 3) : null
          }
        });

        if (evalResult.isCloserPass) {
          if (holdStartTimestampRef.current === null) holdStartTimestampRef.current = now;
          consecutivePassFramesRef.current += 1;
          failHoldStartTimestampRef.current = null;
          consecutiveFailFramesRef.current = 0;

          const holdMs = now - holdStartTimestampRef.current;
          if (holdMs >= config.requiredHoldDurationMs && consecutivePassFramesRef.current >= config.minConsecutiveFrames) {
            const measurements = buildMeasurements();
            const movementDurationMs = measurements.movementDurationMs ?? 0;

            if (discontinuitySuspectedRef.current) {
              finishChallenge(
                DEPTH_PROXIMITY_STATE.INCONCLUSIVE,
                'A frame-to-frame scale jump exceeded the plausible-movement guard — possible tracking discontinuity or substituted frame.',
                measurements
              );
            } else if (movementDurationMs < config.minMovementDurationMs || transitionFrameCountRef.current < config.minTransitionFrames) {
              finishChallenge(
                DEPTH_PROXIMITY_STATE.INCONCLUSIVE,
                'Movement completed too abruptly to validate a genuine gradual physical transition.',
                measurements
              );
            } else if (poseDeltaDeg != null && poseDeltaDeg > config.maxPoseDeltaDeg) {
              finishChallenge(
                DEPTH_PROXIMITY_STATE.INCONCLUSIVE,
                'Head pose changed too much during the movement to confidently attribute the scale change to proximity alone.',
                measurements
              );
            } else {
              setResponseTime(((now - attemptStartTimeRef.current) / 1000).toFixed(2));
              finishChallenge(
                DEPTH_PROXIMITY_STATE.PASS,
                'Progressive forward movement observed and sustained.',
                measurements
              );
            }
            return;
          }
        } else {
          holdStartTimestampRef.current = null;
          consecutivePassFramesRef.current = 0;
        }

        if (evalResult.isFartherFail) {
          if (failHoldStartTimestampRef.current === null) failHoldStartTimestampRef.current = now;
          consecutiveFailFramesRef.current += 1;

          const failHoldMs = now - failHoldStartTimestampRef.current;
          if (failHoldMs >= config.requiredHoldDurationMs && consecutiveFailFramesRef.current >= config.minConsecutiveFrames) {
            setResponseTime(((now - attemptStartTimeRef.current) / 1000).toFixed(2));
            finishChallenge(
              DEPTH_PROXIMITY_STATE.FAILED,
              'Face moved farther from the camera when instructed to move closer.',
              buildMeasurements()
            );
            return;
          }
        } else {
          failHoldStartTimestampRef.current = null;
          consecutiveFailFramesRef.current = 0;
        }
      }
    },
    [isSessionActive, isCameraActive, videoRef, config, finishChallenge, finishAsTimeout]
  );

  return {
    challengeState,
    config,
    baselineProgress,
    remainingTime,
    responseTime,
    invalidReason,
    telemetry,
    startDepthProximityChallenge,
    processFrame,
    resetEngine
  };
}
