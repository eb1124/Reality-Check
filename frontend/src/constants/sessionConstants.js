/**
 * Camera operational status constants
 */
export const CAMERA_STATUS = {
  IDLE: 'idle',
  REQUESTING: 'requesting',
  ACTIVE: 'active',
  ERROR: 'error',
  PERMISSION_DENIED: 'permission_denied'
};

/**
 * Verification session status constants
 */
export const SESSION_STATUS = {
  IDLE: 'idle',
  READY: 'ready',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
};

/**
 * User-facing error message mappings for camera errors
 */
export const CAMERA_ERROR_MESSAGES = {
  NotAllowedError: {
    title: 'Camera Permission Denied',
    message: 'Camera access was blocked by the browser. Please allow camera permissions in your browser address bar and try again.',
    resolution: 'Click the lock/camera icon in your address bar, select "Allow" for camera, and click Retry.'
  },
  PermissionDeniedError: {
    title: 'Camera Permission Denied',
    message: 'Camera permission has been denied. Please enable camera access in your system/browser settings.',
    resolution: 'Check your browser settings to grant camera access for this site.'
  },
  NotFoundError: {
    title: 'No Camera Detected',
    message: 'No video input device was found on your system.',
    resolution: 'Ensure an external webcam is connected or your built-in camera is enabled.'
  },
  DevicesNotFoundError: {
    title: 'No Camera Detected',
    message: 'No video input device was found on your system.',
    resolution: 'Ensure an external webcam is connected or your built-in camera is enabled.'
  },
  NotReadableError: {
    title: 'Camera Hardware In Use',
    message: 'The camera is currently locked or being used by another application.',
    resolution: 'Close any other apps (e.g. Zoom, Teams, Skype, OBS) using the camera and retry.'
  },
  TrackStartError: {
    title: 'Camera Startup Failed',
    message: 'Unable to start the video stream from your camera.',
    resolution: 'Restart your browser or reconnect your webcam device.'
  },
  OverconstrainedError: {
    title: 'Unsupported Camera Resolution',
    message: 'The requested video constraints could not be satisfied by your camera.',
    resolution: 'Retrying with standard camera settings.'
  },
  Default: {
    title: 'Camera Error',
    message: 'An unexpected error occurred while accessing the camera.',
    resolution: 'Please check your webcam connections and try again.'
  }
};
