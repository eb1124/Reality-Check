import React, { useRef } from 'react';
import Header from './components/common/Header';
import CameraFeed from './components/video/CameraFeed';
import ErrorBanner from './components/ui/ErrorBanner';
import SessionIntro from './components/session/SessionIntro';
import SessionControls from './components/session/SessionControls';
import { ChallengeSlot, AnalysisSlot } from './components/session/ModularPanelSlots';
import { useCamera } from './hooks/useCamera';
import { useSession } from './hooks/useSession';
import { useFaceLandmarker } from './hooks/useFaceLandmarker';
import { useChallengeEngine } from './hooks/useChallengeEngine';
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

  // Active Challenge Engine (Turn Head Left state machine)
  const challengeEngine = useChallengeEngine({
    isSessionActive,
    isCameraActive
  });

  // Real-time MediaPipe Face Landmark analysis (supplies per-frame landmarks to challenge engine)
  const {
    faceState,
    faceCount,
    isModelLoading,
    error: landmarkError
  } = useFaceLandmarker({
    videoRef,
    canvasRef,
    isCameraActive,
    onFrame: challengeEngine.processFrame
  });

  const handleStopCamera = () => {
    stopVerification();
    stopCamera();
  };

  return (
    <div className="app-container">
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
        </section>

        {/* Right Column: Controls, Active Challenge, & Telemetry */}
        <section className="sidebar-column" aria-label="Verification Controls and Status">
          {/* Briefing Card: Explains Active Challenge Verification */}
          <SessionIntro />

          {/* Action Controls: Enable Camera / Start Verification */}
          <SessionControls
            cameraStatus={cameraStatus}
            isSessionActive={isSessionActive}
            onStartCamera={startCamera}
            onStopCamera={handleStopCamera}
            onStartVerification={startVerification}
            onStopVerification={stopVerification}
          />

          {/* Active Challenge Engine Slot (Phase 3: Turn Head Left) */}
          <ChallengeSlot
            isSessionActive={isSessionActive}
            challengeEngine={challengeEngine}
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
