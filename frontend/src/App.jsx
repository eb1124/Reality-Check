import React, { useRef, useCallback } from 'react';
import Header from './components/common/Header';
import CameraFeed from './components/video/CameraFeed';
import ErrorBanner from './components/ui/ErrorBanner';
import SessionIntro from './components/session/SessionIntro';
import SessionControls from './components/session/SessionControls';
import { ChallengeSlot, AnalysisSlot } from './components/session/ModularPanelSlots';
import LightChallengePanel from './components/session/LightChallengePanel';
import LightFlashOverlay from './components/session/LightFlashOverlay';
import VerificationResultSummary from './components/session/VerificationResultSummary';
import { useCamera } from './hooks/useCamera';
import { useSession } from './hooks/useSession';
import { useFaceLandmarker } from './hooks/useFaceLandmarker';
import { useChallengeEngine } from './hooks/useChallengeEngine';
import { useLightChallengeEngine } from './hooks/useLightChallengeEngine';
import { useVerificationOrchestrator } from './hooks/useVerificationOrchestrator';
import './styles/App.css';

export default function App() {
  const canvasRef = useRef(null);
  const {
    status: cameraStatus,
    error: cameraError,
    videoRef,
    startCamera,
    stopCamera,
    isCameraActive
  } = useCamera();

  const {
    sessionStatus,
    isSessionActive,
    startVerification,
    stopVerification,
    resetSession
  } = useSession(cameraStatus);

  // Active Challenge Engine (Turn Head Left/Right state machine) — unmodified.
  const challengeEngine = useChallengeEngine({
    isSessionActive,
    isCameraActive
  });

  // Light Challenge Engine (Reality Check, skin reflectance / colour-match response, MVP).
  // Fully independent of challengeEngine above — never reads or mutates its state.
  const lightChallengeEngine = useLightChallengeEngine({
    isSessionActive,
    isCameraActive,
    videoRef
  });

  // Verification Orchestrator — sequences the two engines above (Head Turn
  // primary, Light Challenge secondary/supplementary) into one coherent
  // verification flow with a single combined verdict. Coordinates only;
  // neither engine's internal detection logic is modified.
  const orchestrator = useVerificationOrchestrator({
    isCameraActive,
    isSessionActive,
    startSession: startVerification,
    challengeEngine,
    lightChallengeEngine
  });

  // Fan each MediaPipe frame out to both challenge engines.
  const handleFrame = useCallback(
    (frame) => {
      challengeEngine.processFrame(frame);
      lightChallengeEngine.processFrame(frame);
    },
    [challengeEngine, lightChallengeEngine]
  );

  // Real-time MediaPipe Face Landmark analysis (supplies per-frame landmarks to both challenge engines)
  const {
    faceState,
    faceCount,
    isModelLoading,
    error: landmarkError
  } = useFaceLandmarker({
    videoRef,
    canvasRef,
    isCameraActive,
    onFrame: handleFrame
  });

  const handleStopCamera = () => {
    stopVerification();
    stopCamera();
  };

  return (
    <div className="app-container">
      {/* Full-viewport colour flash for the Light Challenge — only ever rendered while the user's consented attempt is actively flashing. */}
      <LightFlashOverlay isActive={lightChallengeEngine.isFlashActive} colorCss={lightChallengeEngine.flashColorCss} />

      {/* Header with Title and Global Status Badge */}
      <Header cameraStatus={cameraStatus} />

      {/* Main Verification Dashboard Layout */}
      <main className="dashboard-main">
        {/* Left Column: Live Video Viewport & Error Alerts */}
        <section className="video-column" aria-label="Webcam Verification Viewport">
          <CameraFeed
            videoRef={videoRef}
            canvasRef={canvasRef}
            status={cameraStatus}
            faceState={faceState}
            faceCount={faceCount}
          />

          {/* Graceful Camera Error Notification */}
          {cameraError && (
            <ErrorBanner
              error={cameraError}
              onRetry={startCamera}
            />
          )}

          {/* Face Landmark Model Initialization Error */}
          {landmarkError && (
            <ErrorBanner
              error={{
                title: 'Face Landmarker Initialization Error',
                type: 'MediaPipeError',
                message: landmarkError,
                resolution: 'Check your internet connection to ensure MediaPipe assets can be retrieved, then retry.'
              }}
              onRetry={startCamera}
            />
          )}

          {/* Light Challenge Panel (Reality Check MVP: skin reflectance / colour-match response) — kept directly below the camera feed so telemetry never scrolls out of sync with the video during testing. Orchestrated: only offers its consent/start controls once the primary Head-Turn challenge has succeeded. */}
          <LightChallengePanel
            isSessionActive={isSessionActive}
            lightChallengeEngine={lightChallengeEngine}
            orchestrated
            awaitingConsent={orchestrator.awaitingLightConsent}
            onConsentAccept={orchestrator.acceptLightConsent}
            onConsentDecline={orchestrator.declineLightConsent}
            onOrchestratedRetry={orchestrator.retry}
          />
        </section>

        {/* Right Column: Controls, Active Challenge, & Telemetry */}
        <section className="sidebar-column" aria-label="Verification Controls and Status">
          {/* Briefing Card: Explains Active Challenge Verification */}
          <SessionIntro />

          {/* Action Controls: Enable Camera / Start Verification — "Start Verification"
              now begins the orchestrated Head-Turn -> Light Challenge sequence, not
              merely a session flag. */}
          <SessionControls
            cameraStatus={cameraStatus}
            isSessionActive={isSessionActive}
            onStartCamera={startCamera}
            onStopCamera={handleStopCamera}
            onStartVerification={orchestrator.startVerification}
            onStopVerification={stopVerification}
          />

          {/* Combined verification verdict — only rendered once the orchestrated
              sequence reaches a result. */}
          <VerificationResultSummary verdict={orchestrator.verdict} onRetry={orchestrator.retry} />

          {/* Active Challenge Engine Slot (Phase 3: Turn Head Left) — orchestrated:
              direction is randomly assigned, manual selection is hidden. */}
          <ChallengeSlot
            isSessionActive={isSessionActive}
            challengeEngine={challengeEngine}
            orchestrated
            onOrchestratedRetry={orchestrator.retry}
          />

          {/* Real-Time Face Landmark Analysis Telemetry */}
          <AnalysisSlot
            isSessionActive={isSessionActive}
            isCameraActive={isCameraActive}
            faceState={faceState}
            faceCount={faceCount}
          />
        </section>
      </main>

      {/* Footer System Info */}
      <footer className="app-footer">
        <span>Reality Check — Active Liveness Verification System</span>
        <span>Phase 3: Active Challenge Engine (Turn Head Left)</span>
      </footer>
    </div>
  );
}
