import React from 'react';
import { Camera, CameraOff, Loader2, User, UserX, Users, AlertTriangle } from 'lucide-react';
import { CAMERA_STATUS } from '../../constants/sessionConstants';
import { FACE_ANALYSIS_STATUS, FACE_STATUS_CONFIG } from '../../constants/faceAnalysisConstants';

export default function CameraFeed({
  videoRef,
  canvasRef,
  status,
  faceState = FACE_ANALYSIS_STATUS.STANDBY,
  faceCount = 0
}) {
  const isLive = status === CAMERA_STATUS.ACTIVE;
  const isRequesting = status === CAMERA_STATUS.REQUESTING;
  const isError = status === CAMERA_STATUS.ERROR || status === CAMERA_STATUS.PERMISSION_DENIED;
  const isIdle = status === CAMERA_STATUS.IDLE;

  const faceConfig = FACE_STATUS_CONFIG[faceState] || FACE_STATUS_CONFIG[FACE_ANALYSIS_STATUS.STANDBY];

  return (
    <div className="camera-viewport-container">
      <div className="camera-viewport">
        {/* Video Element (Mirrored via CSS for natural selfie perspective) */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`camera-video ${isLive ? 'visible' : 'hidden'}`}
        />

        {/* MediaPipe Real-Time Facial Landmarks Canvas Overlay */}
        <canvas
          ref={canvasRef}
          className={`camera-overlay-canvas ${isLive ? 'visible' : 'hidden'}`}
        />

        {/* Viewport Top Indicators when live */}
        {isLive && (
          <div className="viewport-overlay-bar">
            <div className="feed-live-indicator">
              <span className="live-dot" />
              <span className="live-text">FEED LIVE</span>
            </div>

            {/* Real-Time Face Detection Pill */}
            <div className={`face-detection-pill ${faceConfig.badgeClass}`}>
              {faceState === FACE_ANALYSIS_STATUS.INITIALIZING && (
                <>
                  <Loader2 size={13} className="spin-icon" />
                  <span>Initializing Vision...</span>
                </>
              )}
              {faceState === FACE_ANALYSIS_STATUS.FACE_DETECTED && (
                <>
                  <User size={13} />
                  <span>Face Detected</span>
                </>
              )}
              {faceState === FACE_ANALYSIS_STATUS.NO_FACE && (
                <>
                  <UserX size={13} />
                  <span>No Face Detected</span>
                </>
              )}
              {faceState === FACE_ANALYSIS_STATUS.MULTIPLE_FACES && (
                <>
                  <Users size={13} />
                  <span>Multiple Faces ({faceCount})</span>
                </>
              )}
              {faceState === FACE_ANALYSIS_STATUS.UNAVAILABLE && (
                <>
                  <AlertTriangle size={13} />
                  <span>Face Analysis Offline</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Camera Inactive / Loading / Error Placeholders */}
        {!isLive && (
          <div className="camera-placeholder">
            {isIdle && (
              <div className="placeholder-content">
                <div className="placeholder-icon-wrap">
                  <Camera size={44} strokeWidth={1.5} />
                </div>
                <h3 className="placeholder-title">Webcam Inactive</h3>
                <p className="placeholder-desc">
                  Camera feed is currently offline. Enable camera to begin active verification.
                </p>
              </div>
            )}

            {isRequesting && (
              <div className="placeholder-content">
                <div className="placeholder-icon-wrap rotating">
                  <Loader2 size={44} strokeWidth={1.5} />
                </div>
                <h3 className="placeholder-title">Requesting Camera Access</h3>
                <p className="placeholder-desc">
                  Please grant camera permission in your browser prompt...
                </p>
              </div>
            )}

            {isError && (
              <div className="placeholder-content placeholder-error">
                <div className="placeholder-icon-wrap icon-error">
                  <CameraOff size={44} strokeWidth={1.5} />
                </div>
                <h3 className="placeholder-title">Camera Unavailable</h3>
                <p className="placeholder-desc">
                  Unable to access video feed. Review error details below to resolve.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
