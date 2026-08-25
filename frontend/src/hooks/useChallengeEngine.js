import { useState, useRef, useCallback, useEffect } from 'react';
import {
  CHALLENGE_STATE,
  CHALLENGE_TYPES,
  CHALLENGE_CONFIG,
  FACE_LOSS_GRACE_MS
} from '../constants/challengeConstants';
import { extractYawFromMatrix, computeFaceCenterX, evaluateHeadTurn } from '../challenges/headTurn';

/**
 * Custom hook orchestrating the Active Liveness Challenge Engine with
 * strict deterministic direction evaluation, temporal smoothing, and diagnostics telemetry.
 */
export function useChallengeEngine({ isSessionActive, isCameraActive }) {
  const [challengeState, setChallengeState] = useState(CHALLENGE_STATE.IDLE);
  const [currentChallengeType, setCurrentChallengeType] = useState(CHALLENGE_TYPES.TURN_HEAD_LEFT);
  const [baselineProgress, setBaselineProgress] = useState(0);
  const [remainingTime, setRemainingTime] = useState(0);
  const [responseTime, setResponseTime] = useState(null);
  const [yawDelta, setYawDelta] = useState(0);
  const [progressRatio, setProgressRatio] = useState(0);
  const [invalidReason, setInvalidReason] = useState('');

  // Real-time telemetry diagnostics (yaw values in degrees, from the MediaPipe
  // facial transformation matrix — see headTurn.js for extraction details)
  const [telemetry, setTelemetry] = useState({
    challengeDirection: 'LEFT',
    rawR02: 0,
    rawR22: 0,
    baselineYaw: 0,
    currentRawYaw: 0,
    currentSmoothedYaw: 0,
    signedYawDelta: 0,
    directionAdjustedDelta: 0,
    threshold: 15,
    sustainedHoldState: '0ms / 280ms (0 frames)',
    faceCenterX: 0.5,
    translationDeltaX: 0,
    holdDurationMs: 0,
    requiredHoldDurationMs: 280,
    consecutiveFrames: 0,
    isHolding: false
  });

  const config = CHALLENGE_CONFIG[currentChallengeType] || CHALLENGE_CONFIG[CHALLENGE_TYPES.TURN_HEAD_LEFT];

  // Persistent refs across animation frames
  const baselineSamplesRef = useRef([]);
  const baselineRef = useRef(null);
  const challengeStartTimeRef = useRef(null);
  const holdStartTimestampRef = useRef(null);
  const consecutivePassFramesRef = useRef(0);
  const smoothedYawDegRef = useRef(null);
  const noFaceStartTimestampRef = useRef(null);

  const stateRef = useRef(challengeState);
  stateRef.current = challengeState;
  const configRef = useRef(config);
  configRef.current = config;

  // Reset engine back to initial state
  const resetEngine = useCallback(() => {
    setChallengeState(CHALLENGE_STATE.IDLE);
    setBaselineProgress(0);
    setRemainingTime(0);
    setResponseTime(null);
    setYawDelta(0);
    setProgressRatio(0);
    setInvalidReason('');
    baselineSamplesRef.current = [];
    baselineRef.current = null;
    challengeStartTimeRef.current = null;
    holdStartTimestampRef.current = null;
    consecutivePassFramesRef.current = 0;
    smoothedYawDegRef.current = null;
    noFaceStartTimestampRef.current = null;
    setTelemetry({
      challengeDirection: configRef.current.direction || 'LEFT',
      rawR02: 0,
      rawR22: 0,
      baselineYaw: 0,
      currentRawYaw: 0,
      currentSmoothedYaw: 0,
      signedYawDelta: 0,
      directionAdjustedDelta: 0,
      threshold: configRef.current.yawDeltaThresholdDeg ?? 15,
      sustainedHoldState: '0ms / 280ms (0 frames)',
      faceCenterX: 0.5,
      translationDeltaX: 0,
      holdDurationMs: 0,
      requiredHoldDurationMs: configRef.current.requiredHoldDurationMs || 280,
      consecutiveFrames: 0,
      isHolding: false
    });
  }, []);

  // Switch challenge direction
  const selectChallengeType = useCallback((type) => {
    if (CHALLENGE_CONFIG[type]) {
      setCurrentChallengeType(type);
      setRemainingTime(CHALLENGE_CONFIG[type].timeoutSeconds);
    }
  }, []);

  // Retry or start challenge afresh
  const retryChallenge = useCallback((newType) => {
    if (!isSessionActive || !isCameraActive) return;
    const targetType = newType && CHALLENGE_CONFIG[newType] ? newType : currentChallengeType;
    if (newType && CHALLENGE_CONFIG[newType]) {
      setCurrentChallengeType(newType);
    }
    setChallengeState(CHALLENGE_STATE.PREPARING);
    setBaselineProgress(0);
    setRemainingTime(CHALLENGE_CONFIG[targetType].timeoutSeconds);
    setResponseTime(null);
    setYawDelta(0);
    setProgressRatio(0);
    setInvalidReason('');
    baselineSamplesRef.current = [];
    baselineRef.current = null;
    challengeStartTimeRef.current = null;
    holdStartTimestampRef.current = null;
    consecutivePassFramesRef.current = 0;
    smoothedYawDegRef.current = null;
    noFaceStartTimestampRef.current = null;
  }, [isSessionActive, isCameraActive, currentChallengeType]);

  // Synchronize session lifecycle
  useEffect(() => {
    if (isSessionActive && isCameraActive) {
      if (stateRef.current === CHALLENGE_STATE.IDLE) {
        setChallengeState(CHALLENGE_STATE.PREPARING);
        setRemainingTime(config.timeoutSeconds);
      }
    } else {
      resetEngine();
    }
  }, [isSessionActive, isCameraActive, config.timeoutSeconds, resetEngine]);

  // Synchronous per-frame processing callback invoked by the vision loop
  const processFrame = useCallback(
    ({ landmarks, transformationMatrix, faceCount, timestamp }) => {
      const currentState = stateRef.current;
      const currentCfg = configRef.current;

      if (!isSessionActive || !isCameraActive || currentState === CHALLENGE_STATE.IDLE) {
        return;
      }

      const now = timestamp || performance.now();

      // State: PREPARING -> Check for single face to calibrate baseline
      if (currentState === CHALLENGE_STATE.PREPARING) {
        if (faceCount === 1 && landmarks) {
          baselineSamplesRef.current = [];
          smoothedYawDegRef.current = null;
          setChallengeState(CHALLENGE_STATE.BASELINE);
        }
        return;
      }

      // State: BASELINE -> Collect neutral pose samples with exponential smoothing
      if (currentState === CHALLENGE_STATE.BASELINE) {
        if (faceCount !== 1 || !landmarks) {
          baselineSamplesRef.current = [];
          setBaselineProgress(0);
          return;
        }

        const yawInfo = extractYawFromMatrix(transformationMatrix);
        if (yawInfo.isValid) {
          const faceCenterX = computeFaceCenterX(landmarks);
          const alpha = currentCfg.smoothingAlpha || 0.40;
          if (smoothedYawDegRef.current === null) {
            smoothedYawDegRef.current = yawInfo.yawDeg;
          } else {
            smoothedYawDegRef.current =
              alpha * yawInfo.yawDeg + (1 - alpha) * smoothedYawDegRef.current;
          }

          baselineSamplesRef.current.push({
            yawDeg: yawInfo.yawDeg,
            faceCenterX
          });

          const currentCount = baselineSamplesRef.current.length;
          const progress = Math.min((currentCount / currentCfg.requiredBaselineFrames) * 100, 100);
          setBaselineProgress(progress);

          if (currentCount >= currentCfg.requiredBaselineFrames) {
            // Compute average neutral baseline
            const totalYaw = baselineSamplesRef.current.reduce((acc, s) => acc + s.yawDeg, 0);
            const totalCenterX = baselineSamplesRef.current.reduce((acc, s) => acc + s.faceCenterX, 0);
            const count = baselineSamplesRef.current.length;

            baselineRef.current = {
              yawDeg: totalYaw / count,
              faceCenterX: totalCenterX / count
            };

            // Transition to active challenge
            challengeStartTimeRef.current = now;
            holdStartTimestampRef.current = null;
            consecutivePassFramesRef.current = 0;
            setChallengeState(CHALLENGE_STATE.CHALLENGE_ACTIVE);
            setRemainingTime(currentCfg.timeoutSeconds);
          }
        }
        return;
      }

      // State: CHALLENGE_ACTIVE -> Evaluate smoothed directional yaw & temporal sustained hold
      if (currentState === CHALLENGE_STATE.CHALLENGE_ACTIVE) {
        if (faceCount === 0) {
          if (noFaceStartTimestampRef.current === null) {
            noFaceStartTimestampRef.current = now;
          }
          const noFaceDurationMs = now - noFaceStartTimestampRef.current;
          if (noFaceDurationMs >= FACE_LOSS_GRACE_MS) {
            setChallengeState(CHALLENGE_STATE.INVALID);
            setInvalidReason('Face tracking lost — No face detected');
          }
          return;
        }
        noFaceStartTimestampRef.current = null;
        if (faceCount > 1) {
          setChallengeState(CHALLENGE_STATE.INVALID);
          setInvalidReason('Integrity violation — Multiple faces detected');
          return;
        }

        if (!landmarks || !baselineRef.current || !challengeStartTimeRef.current) {
          return;
        }

        // Check overall challenge timeout
        const elapsedSec = (now - challengeStartTimeRef.current) / 1000;
        const timeLeft = Math.max(0, currentCfg.timeoutSeconds - elapsedSec);
        setRemainingTime(parseFloat(timeLeft.toFixed(1)));

        if (elapsedSec >= currentCfg.timeoutSeconds) {
          setChallengeState(CHALLENGE_STATE.TIMEOUT);
          return;
        }

        const yawInfo = extractYawFromMatrix(transformationMatrix);
        if (!yawInfo.isValid) return;
        const faceCenterX = computeFaceCenterX(landmarks);

        // Apply Exponential Moving Average (EMA) low-pass filter
        const alpha = currentCfg.smoothingAlpha || 0.40;
        if (smoothedYawDegRef.current === null) {
          smoothedYawDegRef.current = yawInfo.yawDeg;
        } else {
          smoothedYawDegRef.current =
            alpha * yawInfo.yawDeg + (1 - alpha) * smoothedYawDegRef.current;
        }

        // Evaluate directional movement on smoothed signal
        const evalResult = evaluateHeadTurn(
          currentCfg.direction,
          smoothedYawDegRef.current,
          baselineRef.current,
          currentCfg,
          faceCenterX
        );

        setYawDelta(evalResult.directionalYawDelta);
        setProgressRatio(evalResult.progressRatio);

        // Temporal Sustained-Hold Logic
        let currentHoldMs = 0;
        let isHolding = false;

        if (evalResult.isPassed) {
          if (holdStartTimestampRef.current === null) {
            holdStartTimestampRef.current = now;
          }
          currentHoldMs = Math.round(now - holdStartTimestampRef.current);
          consecutivePassFramesRef.current += 1;
          isHolding = true;

          const requiredHold = currentCfg.requiredHoldDurationMs || 280;
          const minFrames = currentCfg.minConsecutiveFrames || 6;

          if (currentHoldMs >= requiredHold && consecutivePassFramesRef.current >= minFrames) {
            const measuredResponseTime = ((now - challengeStartTimeRef.current) / 1000).toFixed(2);
            setResponseTime(measuredResponseTime);
            setChallengeState(CHALLENGE_STATE.SUCCESS);
          }
        } else {
          // Reset hold timer if signal drops below threshold or opposite direction
          holdStartTimestampRef.current = null;
          consecutivePassFramesRef.current = 0;
          currentHoldMs = 0;
          isHolding = false;
        }

        // Update complete diagnostics telemetry
        setTelemetry({
          challengeDirection: currentCfg.direction,
          rawR02: parseFloat((yawInfo.r02 ?? 0).toFixed(4)),
          rawR22: parseFloat((yawInfo.r22 ?? 0).toFixed(4)),
          baselineYaw: parseFloat(baselineRef.current.yawDeg.toFixed(2)),
          currentRawYaw: parseFloat(yawInfo.yawDeg.toFixed(2)),
          currentSmoothedYaw: parseFloat(smoothedYawDegRef.current.toFixed(2)),
          signedYawDelta: parseFloat(evalResult.signedYawDelta.toFixed(2)),
          directionAdjustedDelta: parseFloat(evalResult.directionalYawDelta.toFixed(2)),
          threshold: currentCfg.yawDeltaThresholdDeg ?? 15,
          sustainedHoldState: `${currentHoldMs}ms / ${currentCfg.requiredHoldDurationMs || 280}ms (${consecutivePassFramesRef.current} frames, isHolding: ${isHolding})`,
          faceCenterX: parseFloat(faceCenterX.toFixed(3)),
          translationDeltaX: parseFloat(evalResult.translationDeltaX.toFixed(3)),
          holdDurationMs: currentHoldMs,
          requiredHoldDurationMs: currentCfg.requiredHoldDurationMs || 280,
          consecutiveFrames: consecutivePassFramesRef.current,
          isHolding
        });
      }
    },
    [isSessionActive, isCameraActive]
  );

  return {
    challengeState,
    currentChallenge: config,
    currentChallengeType,
    baselineProgress,
    remainingTime,
    responseTime,
    yawDelta,
    progressRatio,
    invalidReason,
    telemetry,
    selectChallengeType,
    processFrame,
    retryChallenge,
    resetEngine
  };
}
