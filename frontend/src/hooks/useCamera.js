import { useState, useRef, useCallback, useEffect } from 'react';
import { CAMERA_STATUS, CAMERA_ERROR_MESSAGES } from '../constants/sessionConstants';

/**
 * Custom hook to manage webcam lifecycle, stream binding, and error states.
 */
export function useCamera() {
  const [stream, setStream] = useState(null);
  const [status, setStatus] = useState(CAMERA_STATUS.IDLE);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);

  // Helper to stop all active media tracks
  const stopTracks = useCallback((mediaStream) => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('Error stopping track:', e);
        }
      });
    }
  }, []);

  // Stop camera feed and reset state
  const stopCamera = useCallback(() => {
    if (stream) {
      stopTracks(stream);
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus(CAMERA_STATUS.IDLE);
    setError(null);
  }, [stream, stopTracks]);

  // Request camera access and attach stream to video element
  const startCamera = useCallback(async () => {
    // Teardown any existing stream first
    if (stream) {
      stopTracks(stream);
      setStream(null);
    }

    setStatus(CAMERA_STATUS.REQUESTING);
    setError(null);

    // Standard high-definition constraints with fallback
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: false
    };

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('MediaDevices API not supported in this browser/environment.');
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      setStream(mediaStream);
      setStatus(CAMERA_STATUS.ACTIVE);
      setError(null);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        // Ensure video plays smoothly
        videoRef.current.play().catch((playErr) => {
          console.warn('Auto-play video error:', playErr);
        });
      }
    } catch (err) {
      console.error('Camera access error:', err);
      const errorName = err.name || 'Default';
      const errorInfo = CAMERA_ERROR_MESSAGES[errorName] || CAMERA_ERROR_MESSAGES.Default;

      const isPermission = errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError';
      setStatus(isPermission ? CAMERA_STATUS.PERMISSION_DENIED : CAMERA_STATUS.ERROR);
      setError({
        type: errorName,
        title: errorInfo.title,
        message: errorInfo.message,
        resolution: errorInfo.resolution,
        rawError: err.message
      });
    }
  }, [stream, stopTracks]);

  // Synchronize video element srcObject when videoRef attaches or stream changes
  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch((err) => console.warn('Stream play error:', err));
    }
  }, [stream]);

  // Cleanup tracks on component unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stopTracks(stream);
      }
    };
  }, [stream, stopTracks]);

  return {
    stream,
    status,
    error,
    videoRef,
    startCamera,
    stopCamera,
    isCameraActive: status === CAMERA_STATUS.ACTIVE
  };
}
