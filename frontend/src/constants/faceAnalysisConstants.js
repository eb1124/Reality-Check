/**
 * Face detection & analysis status constants
 */
export const FACE_ANALYSIS_STATUS = {
  STANDBY: 'standby',
  INITIALIZING: 'initializing',
  FACE_DETECTED: 'face_detected',
  NO_FACE: 'no_face',
  MULTIPLE_FACES: 'multiple_faces',
  UNAVAILABLE: 'unavailable'
};

/**
 * UI visual mapping for face analysis states
 */
export const FACE_STATUS_CONFIG = {
  [FACE_ANALYSIS_STATUS.STANDBY]: {
    label: 'Camera Offline',
    badgeClass: 'face-status-standby',
    dotClass: 'dot-idle',
    description: 'Awaiting camera activation'
  },
  [FACE_ANALYSIS_STATUS.INITIALIZING]: {
    label: 'Initializing Face Analysis...',
    badgeClass: 'face-status-initializing',
    dotClass: 'dot-requesting',
    description: 'Loading MediaPipe Face Landmarker model...'
  },
  [FACE_ANALYSIS_STATUS.FACE_DETECTED]: {
    label: 'Face Detected',
    badgeClass: 'face-status-detected',
    dotClass: 'dot-active',
    description: '1 face detected and tracked'
  },
  [FACE_ANALYSIS_STATUS.NO_FACE]: {
    label: 'No Face Detected',
    badgeClass: 'face-status-noface',
    dotClass: 'dot-warning',
    description: 'Please position your face clearly in the camera frame'
  },
  [FACE_ANALYSIS_STATUS.MULTIPLE_FACES]: {
    label: 'Multiple Faces Detected',
    badgeClass: 'face-status-multiface',
    dotClass: 'dot-error',
    description: 'Only 1 person must be visible during verification'
  },
  [FACE_ANALYSIS_STATUS.UNAVAILABLE]: {
    label: 'Face Analysis Unavailable',
    badgeClass: 'face-status-error',
    dotClass: 'dot-error',
    description: 'Failed to load or execute Face Landmarker'
  }
};

/**
 * Visual styling options for drawing landmarks on canvas
 */
export const LANDMARK_DRAWING_CONFIG = {
  primary: {
    tesselationColor: 'rgba(59, 130, 246, 0.35)', // Subtle blue mesh
    tesselationLineWidth: 0.75,
    contourColor: 'rgba(16, 185, 129, 0.85)',     // Crisp green contour
    contourLineWidth: 1.5,
    eyeIrisColor: 'rgba(6, 182, 212, 0.95)',       // Cyan iris highlight
    eyeIrisLineWidth: 2.0
  },
  warning: {
    tesselationColor: 'rgba(239, 68, 68, 0.35)',   // Red warning mesh for multiple faces
    tesselationLineWidth: 0.75,
    contourColor: 'rgba(239, 68, 68, 0.9)',
    contourLineWidth: 1.5,
    eyeIrisColor: 'rgba(245, 158, 11, 0.9)',
    eyeIrisLineWidth: 2.0
  }
};
