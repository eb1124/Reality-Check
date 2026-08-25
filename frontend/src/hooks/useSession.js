import { useState, useCallback, useEffect } from 'react';
import { SESSION_STATUS, CAMERA_STATUS } from '../constants/sessionConstants';

/**
 * Custom hook to manage verification session workflow and phases.
 * Decoupled from camera mechanics to allow easy integration with
 * future Challenge Engine, WebRTC, and backend modules.
 */
export function useSession(cameraStatus) {
  const [sessionStatus, setSessionStatus] = useState(SESSION_STATUS.IDLE);
  const [startedAt, setStartedAt] = useState(null);

  // Sync session state when camera becomes active or inactive
  useEffect(() => {
    if (cameraStatus === CAMERA_STATUS.ACTIVE && sessionStatus === SESSION_STATUS.IDLE) {
      setSessionStatus(SESSION_STATUS.READY);
    } else if (cameraStatus !== CAMERA_STATUS.ACTIVE && sessionStatus !== SESSION_STATUS.IDLE) {
      setSessionStatus(SESSION_STATUS.IDLE);
      setStartedAt(null);
    }
  }, [cameraStatus, sessionStatus]);

  const startVerification = useCallback(() => {
    if (cameraStatus !== CAMERA_STATUS.ACTIVE) {
      console.warn('Cannot start verification without active camera.');
      return;
    }
    setSessionStatus(SESSION_STATUS.IN_PROGRESS);
    setStartedAt(Date.now());
  }, [cameraStatus]);

  const stopVerification = useCallback(() => {
    setSessionStatus(cameraStatus === CAMERA_STATUS.ACTIVE ? SESSION_STATUS.READY : SESSION_STATUS.IDLE);
    setStartedAt(null);
  }, [cameraStatus]);

  const resetSession = useCallback(() => {
    setSessionStatus(cameraStatus === CAMERA_STATUS.ACTIVE ? SESSION_STATUS.READY : SESSION_STATUS.IDLE);
    setStartedAt(null);
  }, [cameraStatus]);

  return {
    sessionStatus,
    isSessionActive: sessionStatus === SESSION_STATUS.IN_PROGRESS,
    isReady: sessionStatus === SESSION_STATUS.READY,
    startedAt,
    startVerification,
    stopVerification,
    resetSession
  };
}
