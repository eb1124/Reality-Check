import { useState, useRef, useCallback, useEffect } from 'react';
import {
  LIGHT_CHALLENGE_STATE,
  LIGHT_CHALLENGE_CONFIG
} from '../constants/lightChallengeConstants';
import {
  computeCheekROIs,
  measureImageData,
  aggregateMeasurements,
  evaluateLightResponse,
  computeLightValidity
} from '../challenges/lightChallenge';

const FULL_FRAME_SAMPLE_WIDTH = 48;
const FULL_FRAME_SAMPLE_HEIGHT = 27;

function round(value, digits = 3) {
  if (value == null || Number.isNaN(value)) return value;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function roundAggregate(agg) {
  if (!agg) return null;
  const mean = {};
  const stddev = {};
  for (const k of Object.keys(agg.mean)) mean[k] = round(agg.mean[k], 2);
  for (const k of Object.keys(agg.stddev)) stddev[k] = round(agg.stddev[k], 3);
  return { mean, stddev, frameCount: agg.frameCount, clippedRatio: round(agg.clippedRatio, 3) };
}

const EMPTY_TELEMETRY = {
  flashColorCss: LIGHT_CHALLENGE_CONFIG.flashColorCss,
  expectedResponseChannel: LIGHT_CHALLENGE_CONFIG.expectedResponseChannel,
  baseline: null,
  response: null,
  fullFrameBaseline: null,
  fullFrameResponse: null,
  delta: null,
  noiseFloor: null,
  confidentThreshold: null,
  bilateralMagRatio: null,
  bilateralSameSign: null,
  globalDelta: null,
  globalDriftSuspect: null,
  settleDelayMsUsed: 0,
  measurementWindowMsUsed: 0,
  flashDurationMsUsed: 0,
  roiPixelCounts: { left: 0, right: 0 },
  requiredBaselineFrames: LIGHT_CHALLENGE_CONFIG.requiredBaselineFrames,
  minResponseFrames: LIGHT_CHALLENGE_CONFIG.minResponseFrames,
  baselineFrameCount: 0,
  responseFrameCount: 0,
  resultReason: '',
  responseDiagnostics: null,
  // Phase 11 — continuous evidence score/validity (see
  // challenges/lightChallenge.js's continuousScore/computeLightValidity).
  // validity: 0 until a real capture-quality measurement exists (TIMEOUT/
  // INVALID never compute one — an incomplete/unusable attempt must not
  // silently claim a nonzero validity it never measured).
  lightScore: 0,
  lightValidity: 0,
  lightDiagnostics: null
};

/**
 * Light Challenge engine (Reality Check) — Option 1 MVP: skin reflectance /
 * colour-match response. Independent of, and never reads or mutates,
 * useChallengeEngine.js (the head-turn motion challenge).
 *
 * Photosensitivity: this engine NEVER flashes on its own. It stays in
 * LIGHT_IDLE until startLightChallenge() is called, which the UI must only
 * do after the user has explicitly acknowledged the photosensitivity
 * warning (see LightChallengePanel.jsx). Session start/camera activation
 * alone never triggers a flash.
 */
export function useLightChallengeEngine({ isSessionActive, isCameraActive, videoRef }) {
  const [challengeState, setChallengeState] = useState(LIGHT_CHALLENGE_STATE.IDLE);
  const [baselineProgress, setBaselineProgress] = useState(0);
  const [remainingTime, setRemainingTime] = useState(0);
  const [responseTime, setResponseTime] = useState(null);
  const [invalidReason, setInvalidReason] = useState('');
  const [isFlashActive, setIsFlashActive] = useState(false);
  const [telemetry, setTelemetry] = useState(EMPTY_TELEMETRY);

  const config = LIGHT_CHALLENGE_CONFIG;

  const stateRef = useRef(challengeState);
  stateRef.current = challengeState;

  // Offscreen sampling canvases — never attached to the DOM, and separate
  // from the landmark-overlay canvas so mesh-drawing pixels never
  // contaminate the skin colour sample.
  const roiCanvasLeftRef = useRef(null);
  const roiCanvasRightRef = useRef(null);
  const fullFrameCanvasRef = useRef(null);

  const getCanvasCtx = (ref) => {
    if (!ref.current) {
      ref.current = document.createElement('canvas');
    }
    return ref.current.getContext('2d', { willReadFrequently: true });
  };

  const attemptStartTimeRef = useRef(null);
  const phaseStartTimeRef = useRef(null);
  const flashOnsetTimeRef = useRef(null);
  const responseStartTimeRef = useRef(null);
  const noFaceStartTimestampRef = useRef(null);

  const baselineSamplesRef = useRef({ left: [], right: [], full: [] });
  const responseSamplesRef = useRef({ left: [], right: [], full: [] });
  const baselineAggRef = useRef(null);
  // Phase 11 diagnostics — face coverage per response-window frame and the
  // response window's own start/actual-sample-count, used to derive
  // deliveredFps at evaluate time. Kept separate from responseSamplesRef
  // (measurement vectors) since these feed validity, not the PASS/
  // INCONCLUSIVE score itself.
  const responseCoverageRef = useRef([]);

  // Diagnostic-only counters (not used by any PASS/INCONCLUSIVE/INVALID decision) —
  // see debugging notes: distinguishes raw RESPONSE-phase processFrame calls from
  // successful samples, and buckets why a given call didn't yield a sample.
  const responseDiagRef = useRef({
    rawCalls: 0,
    faceLossSkips: 0,
    multiFaceAbort: 0,
    videoNotReady: 0,
    guardSkips: 0,
    nullSamples: 0
  });

  const resetBuffers = useCallback(() => {
    baselineSamplesRef.current = { left: [], right: [], full: [] };
    responseSamplesRef.current = { left: [], right: [], full: [] };
    responseCoverageRef.current = [];
    baselineAggRef.current = null;
    attemptStartTimeRef.current = null;
    phaseStartTimeRef.current = null;
    flashOnsetTimeRef.current = null;
    responseStartTimeRef.current = null;
    noFaceStartTimestampRef.current = null;
    responseDiagRef.current = {
      rawCalls: 0,
      faceLossSkips: 0,
      multiFaceAbort: 0,
      videoNotReady: 0,
      guardSkips: 0,
      nullSamples: 0
    };
  }, []);

  const resetEngine = useCallback(() => {
    setChallengeState(LIGHT_CHALLENGE_STATE.IDLE);
    setBaselineProgress(0);
    setRemainingTime(0);
    setResponseTime(null);
    setInvalidReason('');
    setIsFlashActive(false);
    setTelemetry(EMPTY_TELEMETRY);
    resetBuffers();
  }, [resetBuffers]);

  // Camera/session lifecycle: unlike the head-turn engine, this does NOT
  // auto-arm on session start — starting requires an explicit, consented
  // user action (see startLightChallenge below).
  useEffect(() => {
    if (!isSessionActive || !isCameraActive) {
      resetEngine();
    }
  }, [isSessionActive, isCameraActive, resetEngine]);

  const startLightChallenge = useCallback(() => {
    if (!isSessionActive || !isCameraActive) return;
    resetBuffers();
    setBaselineProgress(0);
    setResponseTime(null);
    setInvalidReason('');
    setIsFlashActive(false);
    setTelemetry(EMPTY_TELEMETRY);
    attemptStartTimeRef.current = performance.now();
    setRemainingTime(config.timeoutSeconds);
    setChallengeState(LIGHT_CHALLENGE_STATE.PREPARING);
  }, [isSessionActive, isCameraActive, resetBuffers, config.timeoutSeconds]);

  const retryLightChallenge = useCallback(() => {
    startLightChallenge();
  }, [startLightChallenge]);

  const sampleFrame = useCallback((video, landmarks) => {
    const roi = computeCheekROIs(landmarks, video.videoWidth, video.videoHeight, config);
    if (!roi) return null;

    const leftCtx = getCanvasCtx(roiCanvasLeftRef);
    roiCanvasLeftRef.current.width = roi.left.w;
    roiCanvasLeftRef.current.height = roi.left.h;
    leftCtx.drawImage(video, roi.left.x, roi.left.y, roi.left.w, roi.left.h, 0, 0, roi.left.w, roi.left.h);
    const leftMeasurement = measureImageData(leftCtx.getImageData(0, 0, roi.left.w, roi.left.h));

    const rightCtx = getCanvasCtx(roiCanvasRightRef);
    roiCanvasRightRef.current.width = roi.right.w;
    roiCanvasRightRef.current.height = roi.right.h;
    rightCtx.drawImage(video, roi.right.x, roi.right.y, roi.right.w, roi.right.h, 0, 0, roi.right.w, roi.right.h);
    const rightMeasurement = measureImageData(rightCtx.getImageData(0, 0, roi.right.w, roi.right.h));

    const fullCtx = getCanvasCtx(fullFrameCanvasRef);
    fullFrameCanvasRef.current.width = FULL_FRAME_SAMPLE_WIDTH;
    fullFrameCanvasRef.current.height = FULL_FRAME_SAMPLE_HEIGHT;
    fullCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, FULL_FRAME_SAMPLE_WIDTH, FULL_FRAME_SAMPLE_HEIGHT);
    const fullMeasurement = measureImageData(fullCtx.getImageData(0, 0, FULL_FRAME_SAMPLE_WIDTH, FULL_FRAME_SAMPLE_HEIGHT));

    // Phase 11 — face coverage validity gate: interocular distance relative
    // to the smaller video dimension, a frame-relative (not absolute-pixel)
    // measure of how much of the frame the face occupies, reusing the same
    // interocular measurement computeCheekROIs already derives for ROI
    // sizing rather than a second, independent face-size computation.
    const faceCoverageRatio = roi.interocularPx / Math.min(video.videoWidth, video.videoHeight);

    return { left: leftMeasurement, right: rightMeasurement, full: fullMeasurement, faceCoverageRatio };
  }, [config]);

  const finishAsInvalid = useCallback((reason) => {
    setChallengeState(LIGHT_CHALLENGE_STATE.INVALID);
    setInvalidReason(reason);
    setIsFlashActive(false);
  }, []);

  const finishAsTimeout = useCallback(() => {
    setChallengeState(LIGHT_CHALLENGE_STATE.TIMEOUT);
    setIsFlashActive(false);
  }, []);

  const processFrame = useCallback(
    ({ landmarks, faceCount, timestamp }) => {
      const currentState = stateRef.current;
      if (!isSessionActive || !isCameraActive || currentState === LIGHT_CHALLENGE_STATE.IDLE) {
        return;
      }

      // Diagnostic-only: count every processFrame invocation that occurs while in
      // RESPONSE, before any gate below can intercept it.
      if (currentState === LIGHT_CHALLENGE_STATE.RESPONSE) {
        responseDiagRef.current.rawCalls++;
      }

      const terminal = [
        LIGHT_CHALLENGE_STATE.PASS,
        LIGHT_CHALLENGE_STATE.INCONCLUSIVE,
        LIGHT_CHALLENGE_STATE.TIMEOUT,
        LIGHT_CHALLENGE_STATE.INVALID
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
      if (currentState === LIGHT_CHALLENGE_STATE.PREPARING) {
        if (faceCount === 1 && landmarks) {
          phaseStartTimeRef.current = now;
          setChallengeState(LIGHT_CHALLENGE_STATE.BASELINE);
        }
        return;
      }

      // Explicit face-loss / multi-face handling, shared by BASELINE/FLASH/RESPONSE.
      if (faceCount === 0) {
        if (noFaceStartTimestampRef.current === null) {
          noFaceStartTimestampRef.current = now;
        }
        if (now - noFaceStartTimestampRef.current >= config.faceLossGraceMs) {
          finishAsInvalid('Face tracking lost — no face detected.');
          return;
        }
        if (currentState !== LIGHT_CHALLENGE_STATE.BASELINE) {
          // baseline handles its own reset below
          if (currentState === LIGHT_CHALLENGE_STATE.RESPONSE) responseDiagRef.current.faceLossSkips++;
          return;
        }
      } else {
        noFaceStartTimestampRef.current = null;
      }

      if (faceCount > 1) {
        if (currentState === LIGHT_CHALLENGE_STATE.RESPONSE) responseDiagRef.current.multiFaceAbort++;
        finishAsInvalid('Integrity violation — multiple faces detected.');
        return;
      }

      if (!video || video.videoWidth === 0) {
        if (currentState === LIGHT_CHALLENGE_STATE.RESPONSE) responseDiagRef.current.videoNotReady++;
        return;
      }

      // State: BASELINE -> neutral screen, collecting pre-flash ROI samples.
      if (currentState === LIGHT_CHALLENGE_STATE.BASELINE) {
        if (faceCount !== 1 || !landmarks) {
          baselineSamplesRef.current = { left: [], right: [], full: [] };
          setBaselineProgress(0);
          return;
        }

        const sample = sampleFrame(video, landmarks);
        if (!sample) return;

        baselineSamplesRef.current.left.push(sample.left);
        baselineSamplesRef.current.right.push(sample.right);
        baselineSamplesRef.current.full.push(sample.full);

        const count = baselineSamplesRef.current.left.length;
        setBaselineProgress(Math.min((count / config.requiredBaselineFrames) * 100, 100));

        if (count >= config.requiredBaselineFrames) {
          const left = aggregateMeasurements(baselineSamplesRef.current.left);
          const right = aggregateMeasurements(baselineSamplesRef.current.right);
          const combined = aggregateMeasurements([...baselineSamplesRef.current.left, ...baselineSamplesRef.current.right]);
          const fullFrame = aggregateMeasurements(baselineSamplesRef.current.full);

          if (combined.mean.luminance < config.minAmbientLuminance) {
            finishAsInvalid('Insufficient ambient light for a trustworthy baseline measurement.');
            return;
          }

          baselineAggRef.current = { left, right, combined, fullFrame };

          setTelemetry((prev) => ({
            ...prev,
            baseline: {
              left: roundAggregate(left),
              right: roundAggregate(right),
              combined: roundAggregate(combined)
            },
            fullFrameBaseline: roundAggregate(fullFrame),
            baselineFrameCount: count
          }));

          flashOnsetTimeRef.current = now;
          setIsFlashActive(true);
          setChallengeState(LIGHT_CHALLENGE_STATE.FLASH);
        }
        return;
      }

      // State: FLASH -> settle delay, flash is on screen but not yet sampled.
      if (currentState === LIGHT_CHALLENGE_STATE.FLASH) {
        if (now - flashOnsetTimeRef.current >= config.settleDelayMs) {
          responseStartTimeRef.current = now;
          responseDiagRef.current = {
            rawCalls: 0,
            faceLossSkips: 0,
            multiFaceAbort: 0,
            videoNotReady: 0,
            guardSkips: 0,
            nullSamples: 0
          };
          setChallengeState(LIGHT_CHALLENGE_STATE.RESPONSE);
        }
        return;
      }

      // State: RESPONSE -> flash still on screen, actively sampling.
      if (currentState === LIGHT_CHALLENGE_STATE.RESPONSE) {
        if (faceCount !== 1 || !landmarks) {
          // Response window requires continuous tracking; drop sample, keep waiting
          // within the overall attempt timeout rather than invalidating on one frame.
          responseDiagRef.current.guardSkips++;
          return;
        }

        const sample = sampleFrame(video, landmarks);
        if (sample) {
          responseSamplesRef.current.left.push(sample.left);
          responseSamplesRef.current.right.push(sample.right);
          responseSamplesRef.current.full.push(sample.full);
          responseCoverageRef.current.push(sample.faceCoverageRatio);
        } else {
          responseDiagRef.current.nullSamples++;
        }

        const elapsedResponseMs = now - responseStartTimeRef.current;
        if (elapsedResponseMs >= config.responseWindowMs) {
          setIsFlashActive(false);
          setChallengeState(LIGHT_CHALLENGE_STATE.EVALUATE);

          const respCount = responseSamplesRef.current.left.length;
          if (respCount < config.minResponseFrames) {
            setTelemetry((prev) => ({
              ...prev,
              settleDelayMsUsed: round(flashOnsetTimeRef.current != null ? (responseStartTimeRef.current - flashOnsetTimeRef.current) : 0, 0),
              measurementWindowMsUsed: round(elapsedResponseMs, 0),
              flashDurationMsUsed: round(now - flashOnsetTimeRef.current, 0),
              roiPixelCounts: {
                left: responseSamplesRef.current.left[0]?.pixelCount ?? 0,
                right: responseSamplesRef.current.right[0]?.pixelCount ?? 0
              },
              responseFrameCount: respCount,
              responseDiagnostics: { ...responseDiagRef.current }
            }));
            finishAsInvalid(`Insufficient valid samples captured during the response window (${respCount}/${config.minResponseFrames} minimum).`);
            return;
          }

          const left = aggregateMeasurements(responseSamplesRef.current.left);
          const right = aggregateMeasurements(responseSamplesRef.current.right);
          const combined = aggregateMeasurements([...responseSamplesRef.current.left, ...responseSamplesRef.current.right]);
          const fullFrame = aggregateMeasurements(responseSamplesRef.current.full);

          const baseline = baselineAggRef.current;
          const evalResult = evaluateLightResponse({
            channel: config.expectedResponseChannel,
            baselineCombined: baseline.combined,
            responseCombined: combined,
            baselineLeft: baseline.left,
            responseLeft: left,
            baselineRight: baseline.right,
            responseRight: right,
            fullFrameBaseline: baseline.fullFrame,
            fullFrameResponse: fullFrame,
            config
          });

          const flashDurationMsUsed = now - flashOnsetTimeRef.current;
          const measuredResponseTime = ((now - attemptStartTimeRef.current) / 1000).toFixed(2);

          // Phase 11 — validity gates, computed from real measurements
          // taken during this same response window (see
          // computeLightValidity's docstring for what each gate means).
          const deliveredFps = (respCount / elapsedResponseMs) * 1000;
          const meanFaceCoverage =
            responseCoverageRef.current.reduce((a, b) => a + b, 0) / (responseCoverageRef.current.length || 1);
          const screenContributionRatio = evalResult.details.relativeDeltaCombined.luminance;
          const { validity: lightValidity, diagnostics: lightDiagnostics } = computeLightValidity({
            deliveredFps,
            faceCoverageRatio: meanFaceCoverage,
            screenContributionRatio,
            globalDriftSuspect: evalResult.details.globalDriftSuspect,
            config
          });
          const lightScore = evalResult.score ?? 0;

          setTelemetry((prev) => ({
            ...prev,
            response: {
              left: roundAggregate(left),
              right: roundAggregate(right),
              combined: roundAggregate(combined)
            },
            fullFrameResponse: roundAggregate(fullFrame),
            delta: {
              combined: {
                delta: Object.fromEntries(Object.entries(evalResult.details.deltaCombined).map(([k, v]) => [k, round(v, 3)])),
                relativeDelta: Object.fromEntries(Object.entries(evalResult.details.relativeDeltaCombined).map(([k, v]) => [k, round(v, 4)]))
              },
              left: Object.fromEntries(Object.entries(evalResult.details.deltaLeft).map(([k, v]) => [k, round(v, 3)])),
              right: Object.fromEntries(Object.entries(evalResult.details.deltaRight).map(([k, v]) => [k, round(v, 3)]))
            },
            noiseFloor: round(evalResult.details.noiseFloor, 4),
            confidentThreshold: round(evalResult.details.confidentThreshold, 4),
            bilateralMagRatio: round(evalResult.details.bilateralMagRatio, 3),
            bilateralSameSign: evalResult.details.bilateralSameSign,
            globalDelta: round(evalResult.details.globalDelta, 3),
            globalDriftSuspect: evalResult.details.globalDriftSuspect,
            settleDelayMsUsed: round(flashOnsetTimeRef.current != null ? (responseStartTimeRef.current - flashOnsetTimeRef.current) : 0, 0),
            measurementWindowMsUsed: round(elapsedResponseMs, 0),
            flashDurationMsUsed: round(flashDurationMsUsed, 0),
            roiPixelCounts: {
              left: responseSamplesRef.current.left[0]?.pixelCount ?? 0,
              right: responseSamplesRef.current.right[0]?.pixelCount ?? 0
            },
            requiredBaselineFrames: config.requiredBaselineFrames,
            minResponseFrames: config.minResponseFrames,
            baselineFrameCount: baselineSamplesRef.current.left.length,
            responseFrameCount: respCount,
            resultReason: evalResult.reason,
            responseDiagnostics: { ...responseDiagRef.current },
            lightScore,
            lightValidity,
            lightDiagnostics
          }));

          setResponseTime(measuredResponseTime);
          setChallengeState(
            evalResult.outcome === 'PASS' ? LIGHT_CHALLENGE_STATE.PASS : LIGHT_CHALLENGE_STATE.INCONCLUSIVE
          );
        }
        return;
      }
    },
    [isSessionActive, isCameraActive, videoRef, config, sampleFrame, finishAsInvalid, finishAsTimeout]
  );

  return {
    challengeState,
    config,
    baselineProgress,
    remainingTime,
    responseTime,
    invalidReason,
    isFlashActive,
    flashColorCss: config.flashColorCss,
    telemetry,
    startLightChallenge,
    retryLightChallenge,
    processFrame,
    resetEngine
  };
}
