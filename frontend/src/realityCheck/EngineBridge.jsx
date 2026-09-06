import React, { forwardRef, useImperativeHandle, useRef, useEffect, useCallback } from 'react';
import { useCamera } from '../hooks/useCamera';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { useContinuousVerification } from '../hooks/useContinuousVerification';
import LightFlashOverlay from '../components/session/LightFlashOverlay';

/**
 * Internal bridge between the React-hook-based engine (camera, MediaPipe,
 * the two challenge engines, the orchestrator, the scheduler/monitor — all
 * existing/Stage-3 code, unmodified here except useCamera, which Phase 9
 * taught to accept an externally-owned stream — see its own module
 * docstring) and createRealityCheckSession's plain imperative public API.
 * NOT exported from realityCheck/index.js — consumers of the public
 * interface never see this component or any of the hooks/challenge/risk
 * internals it composes.
 *
 * Renders nothing visible of its own except the Light Challenge flash
 * (mounted into an off-screen container by createRealityCheckSession). Its
 * own internal <video> is what useCamera/useFaceLandmarker actually read
 * frames from. If `mediaStream` is supplied (Phase 9 — an embedding OA's
 * own already-open camera stream, e.g. one it's also recording), useCamera
 * adopts it directly instead of calling getUserMedia, and Reality Check
 * never stops its tracks — see useCamera.js. Otherwise (the original,
 * still-fully-supported path) Reality Check acquires and owns its own
 * camera exactly as before. If the caller separately supplied a
 * videoElement, the live stream (whichever source it came from) is
 * mirrored onto it purely for their own display purposes.
 *
 * Exactly ONE useContinuousVerification instance is ever created here —
 * calling it twice (e.g. to work around the faceCount/processFrame
 * circular dependency below) would spin up two independent engines
 * (two challengeEngines, two orchestrators, two backend sessions) able to
 * race each other for the same camera, which is precisely the failure
 * mode useVerificationOrchestrator's `continuous` mode exists to prevent.
 */
const EngineBridge = forwardRef(function EngineBridge(
  { videoElement, mediaStream, apiBaseUrl, externalRef, onStatus, onReport, onEvent, onChallenge },
  ref
) {
  const canvasRef = useRef(null); // required by useFaceLandmarker for its landmark-overlay draw target; never displayed

  const { videoRef, isCameraActive, startCamera, stopCamera, stream } = useCamera({ externalStream: mediaStream });

  useEffect(() => {
    if (videoElement && stream) {
      videoElement.srcObject = stream;
      videoElement.play?.().catch(() => {});
    }
  }, [videoElement, stream]);

  // useFaceLandmarker produces faceCount, which useContinuousVerification
  // needs as an input; useContinuousVerification produces processFrame,
  // which useFaceLandmarker needs as an input. Genuinely circular within a
  // single render. Broken with a ref indirection (handleFrame always calls
  // whatever processFrame is CURRENT, updated by an effect after
  // useContinuousVerification runs) rather than by calling either hook
  // twice — at most one animation frame during initial mount is processed
  // through the still-default no-op before the first effect runs.
  const processFrameRef = useRef(() => {});
  const handleFrame = useCallback((frame) => processFrameRef.current(frame), []);

  const { faceCount } = useFaceLandmarker({
    videoRef,
    canvasRef,
    isCameraActive,
    onFrame: handleFrame
  });

  const continuous = useContinuousVerification({
    isCameraActive,
    videoRef,
    faceCount,
    onEvent,
    onChallenge,
    apiBaseUrl,
    externalRef
  });

  useEffect(() => {
    processFrameRef.current = continuous.processFrame;
  }, [continuous.processFrame]);

  useImperativeHandle(
    ref,
    () => ({
      start: async () => {
        if (!isCameraActive) {
          await startCamera();
          // Give React a tick to commit the isCameraActive=true re-render
          // (and therefore update useContinuousVerification's
          // isCameraActiveRef) before calling continuous.start() — closing
          // the same race the ref fix in useContinuousVerification.js
          // addresses, belt-and-suspenders since this is the one call site
          // that actually crosses the startCamera()-then-start() boundary.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        // Phase 9 §4 ("Session ID"): returned directly rather than requiring
        // the caller to poll getStatus() until it's populated.
        const sessionId = await continuous.start();
        return { sessionId };
      },
      end: async (reason) => {
        const report = await continuous.end(reason);
        // Safe regardless of camera ownership: an internally-acquired
        // stream is stopped here exactly as before; an externally-supplied
        // one (Phase 9) is left running — see useCamera.js's module
        // docstring for the ownership invariant this relies on.
        stopCamera();
        return report;
      },
      getStatus: () => ({
        state: continuous.state,
        riskState: continuous.report?.riskState ?? null,
        challengesRun: continuous.challengesRun,
        sessionId: continuous.sessionId
      })
    }),
    [continuous, isCameraActive, startCamera, stopCamera]
  );

  useEffect(() => {
    onStatus?.({
      state: continuous.state,
      riskState: continuous.report?.riskState ?? null,
      challengesRun: continuous.challengesRun,
      sessionId: continuous.sessionId
    });
  }, [continuous.state, continuous.challengesRun, continuous.sessionId, continuous.report, onStatus]);

  useEffect(() => {
    if (continuous.report) onReport?.(continuous.report);
  }, [continuous.report, onReport]);

  return (
    <>
      {/* The screen flash is a required physical side effect of the Light
          Challenge (it must actually illuminate the person's face) — kept
          visible even though the tracking video/canvas below are not. */}
      <LightFlashOverlay isActive={continuous.isFlashActive} colorCss={continuous.flashColorCss} />
      <div style={{ display: 'none' }} aria-hidden="true">
        <video ref={videoRef} muted playsInline />
        <canvas ref={canvasRef} />
      </div>
    </>
  );
});

export default EngineBridge;
