import { useState, useRef, useCallback, useEffect } from 'react';
import { CAMERA_STATUS, CAMERA_ERROR_MESSAGES } from '../constants/sessionConstants';

/**
 * Custom hook to manage webcam lifecycle, stream binding, and error states.
 *
 * Phase 9: also accepts an externally-supplied `externalStream` (e.g. a
 * MediaStream an embedding online-assessment app already opened via its own
 * getUserMedia call so it can record the candidate). When present, this
 * hook never calls getUserMedia itself and — critically — never calls
 * `track.stop()` on that stream, on stopCamera() or on unmount: an
 * externally-owned stream's lifecycle belongs entirely to its caller for as
 * long as this hook exists. Only a stream this hook acquired itself is ever
 * stopped by it (tracked via `ownedStreamRef`, independent of the `stream`
 * state value so an external stream can be swapped in/out without changing
 * this ownership invariant).
 */
export function useCamera({ externalStream = null } = {}) {
  const [stream, setStream] = useState(null);
  const [status, setStatus] = useState(CAMERA_STATUS.IDLE);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const ownedStreamRef = useRef(null);

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

  const stopCamera = useCallback(() => {
    if (ownedStreamRef.current) {
      stopTracks(ownedStreamRef.current);
    }
    ownedStreamRef.current = null;
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus(CAMERA_STATUS.IDLE);
    setError(null);
  }, [stopTracks]);

  const adoptExternalStream = useCallback((mediaStream) => {
    ownedStreamRef.current = null; // never ours to stop
    setStream(mediaStream);
    setStatus(CAMERA_STATUS.ACTIVE);
    setError(null);
    if (videoRef.current) {
      videoRef.current.srcObject = mediaStream;
      // Optional chaining: .play() always returns a Promise per spec, but
      // some non-browser/test DOM implementations (e.g. jsdom) return
      // undefined instead of rejecting — this must degrade quietly there
      // rather than throw.
      videoRef.current.play()?.catch((playErr) => {
        console.warn('Auto-play video error:', playErr);
      });
    }
  }, []);

  // Request camera access and attach stream to video element
  const startCamera = useCallback(async () => {
    if (externalStream) {
      adoptExternalStream(externalStream);
      return;
    }

    // Teardown any existing internally-owned stream first
    if (ownedStreamRef.current) {
      stopTracks(ownedStreamRef.current);
      ownedStreamRef.current = null;
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

      ownedStreamRef.current = mediaStream;
      setStream(mediaStream);
      setStatus(CAMERA_STATUS.ACTIVE);
      setError(null);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        // Ensure video plays smoothly. Optional chaining: .play() always
        // returns a Promise per spec, but some non-browser/test DOM
        // implementations (e.g. jsdom) return undefined instead of
        // rejecting — this must degrade quietly there rather than throw.
        videoRef.current.play()?.catch((playErr) => {
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
  }, [stopTracks, externalStream, adoptExternalStream]);

  // If the caller supplies (or swaps in) an external stream while this hook
  // is already mounted, without an explicit startCamera() call, adopt it
  // live — releasing any internally-owned stream first.
  useEffect(() => {
    if (!externalStream || externalStream === stream) return;
    if (ownedStreamRef.current) {
      stopTracks(ownedStreamRef.current);
    }
    adoptExternalStream(externalStream);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalStream]);

  // Synchronize video element srcObject when videoRef attaches or stream changes
  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play()?.catch((err) => console.warn('Stream play error:', err));
    }
  }, [stream]);

  // Cleanup ONLY on unmount, and only ever stops a stream this hook itself
  // acquired via getUserMedia — an externally-supplied MediaStream outlives
  // this hook unconditionally (see module docstring).
  useEffect(() => {
    return () => {
      if (ownedStreamRef.current) {
        stopTracks(ownedStreamRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
