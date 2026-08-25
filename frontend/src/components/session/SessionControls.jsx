import React from 'react';
import { Play, Square, Video, VideoOff } from 'lucide-react';
import { CAMERA_STATUS } from '../../constants/sessionConstants';

export default function SessionControls({
  cameraStatus,
  isSessionActive,
  onStartCamera,
  onStopCamera,
  onStartVerification,
  onStopVerification
}) {
  const isCameraActive = cameraStatus === CAMERA_STATUS.ACTIVE;
  const isCameraRequesting = cameraStatus === CAMERA_STATUS.REQUESTING;

  return (
    <div className="session-controls-card">
      <div className="controls-button-group">
        {/* Primary Action Button: Enable Camera / Start Verification */}
        {!isCameraActive ? (
          <button
            type="button"
            className="btn btn-primary btn-large"
            onClick={onStartCamera}
            disabled={isCameraRequesting}
          >
            <Video size={18} />
            <span>{isCameraRequesting ? 'Requesting Access...' : 'Enable Camera'}</span>
          </button>
        ) : (
          <>
            {!isSessionActive ? (
              <button
                type="button"
                className="btn btn-success btn-large"
                onClick={onStartVerification}
              >
                <Play size={18} />
                <span>Start Verification</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger btn-large"
                onClick={onStopVerification}
              >
                <Square size={18} />
                <span>End Verification</span>
              </button>
            )}

            {/* Secondary: Stop Camera */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onStopCamera}
            >
              <VideoOff size={16} />
              <span>Turn Off Camera</span>
            </button>
          </>
        )}
      </div>

      <div className="controls-footer-status">
        {!isCameraActive && (
          <p className="status-hint">
            Enable camera access to begin the verification process.
          </p>
        )}
        {isCameraActive && !isSessionActive && (
          <p className="status-hint success">
            Camera active. Click "Start Verification" when ready to respond to live challenges.
          </p>
        )}
        {isSessionActive && (
          <p className="status-hint active">
            Verification session in progress. Maintain your face centered in the frame.
          </p>
        )}
      </div>
    </div>
  );
}
