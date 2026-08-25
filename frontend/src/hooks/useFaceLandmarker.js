import { useState, useEffect, useRef, useCallback } from 'react';
import { FilesetResolver, FaceLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import {
  FACE_ANALYSIS_STATUS,
  LANDMARK_DRAWING_CONFIG
} from '../constants/faceAnalysisConstants';

// Global singleton instance cache to prevent redundant model downloads & re-initialization
let cachedLandmarker = null;
let landmarkerInitializationPromise = null;

async function getFaceLandmarkerInstance() {
  if (cachedLandmarker) {
    return cachedLandmarker;
  }
  if (landmarkerInitializationPromise) {
    return landmarkerInitializationPromise;
  }

  landmarkerInitializationPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      let landmarker;
      try {
        // Attempt GPU acceleration first
        landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU'
          },
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: true, // Rigid head-pose matrix for yaw estimation
          runningMode: 'VIDEO',
          numFaces: 2, // Multi-face detection for interview integrity
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
      } catch (gpuError) {
        console.warn('GPU acceleration failed for FaceLandmarker, falling back to CPU:', gpuError);
        landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'CPU'
          },
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: true, // Rigid head-pose matrix for yaw estimation
          runningMode: 'VIDEO',
          numFaces: 2,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
      }

      cachedLandmarker = landmarker;
      return landmarker;
    } catch (err) {
      landmarkerInitializationPromise = null;
      throw err;
    }
  })();

  return landmarkerInitializationPromise;
}

/**
 * Custom hook for real-time MediaPipe Face Landmark analysis.
 * Processes webcam video frames, tracks face presence, renders
 * landmarks on the canvas overlay, and provides per-frame data to consumers.
 */
export function useFaceLandmarker({ videoRef, canvasRef, isCameraActive, onFrame }) {
  const [faceState, setFaceState] = useState(FACE_ANALYSIS_STATUS.STANDBY);
  const [faceCount, setFaceCount] = useState(0);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [error, setError] = useState(null);

  const animationFrameIdRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const isRunningRef = useRef(false);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Helper to draw landmarks with customizable styles
  const drawLandmarks = useCallback((ctx, landmarksList, isWarning = false) => {
    const drawingUtils = new DrawingUtils(ctx);
    const style = isWarning ? LANDMARK_DRAWING_CONFIG.warning : LANDMARK_DRAWING_CONFIG.primary;

    for (const landmarks of landmarksList) {
      // 1. Face Oval Contour
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
        { color: style.contourColor, lineWidth: style.contourLineWidth }
      );

      // 2. Tesselation Mesh (Subtle facial geometry)
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_TESSELATION,
        { color: style.tesselationColor, lineWidth: style.tesselationLineWidth }
      );

      // 3. Eyes and Eyebrows
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
        { color: style.contourColor, lineWidth: style.contourLineWidth }
      );
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
        { color: style.contourColor, lineWidth: style.contourLineWidth }
      );
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
        { color: style.contourColor, lineWidth: style.contourLineWidth }
      );
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
        { color: style.contourColor, lineWidth: style.contourLineWidth }
      );

      // 4. Irises
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
        { color: style.eyeIrisColor, lineWidth: style.eyeIrisLineWidth }
      );
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
        { color: style.eyeIrisColor, lineWidth: style.eyeIrisLineWidth }
      );

      // 5. Lips
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_LIPS,
        { color: style.contourColor, lineWidth: style.contourLineWidth }
      );
    }
  }, []);

  // Main real-time frame processing loop
  useEffect(() => {
    let isCancelled = false;

    // Clear canvas when camera is offline
    if (!isCameraActive) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
      setFaceState(FACE_ANALYSIS_STATUS.STANDBY);
      setFaceCount(0);
      isRunningRef.current = false;
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      return;
    }

    // Camera is active -> initialize and start inference
    const runLandmarkDetection = async () => {
      try {
        setFaceState(FACE_ANALYSIS_STATUS.INITIALIZING);
        setIsModelLoading(true);
        setError(null);

        const landmarker = await getFaceLandmarkerInstance();

        if (isCancelled) return;
        setIsModelLoading(false);
        isRunningRef.current = true;

        const processFrame = () => {
          if (!isRunningRef.current || isCancelled) return;

          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
            // Keep canvas resolution strictly synchronized with video stream resolution
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }

            const ctx = canvas.getContext('2d');

            if (video.currentTime !== lastVideoTimeRef.current) {
              lastVideoTimeRef.current = video.currentTime;
              const startTimeMs = performance.now();

              try {
                const results = landmarker.detectForVideo(video, startTimeMs);

                // Always clear previous frame
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                const detectedCount = results.faceLandmarks ? results.faceLandmarks.length : 0;
                const primaryFace = detectedCount > 0 ? results.faceLandmarks[0] : null;
                const primaryTransformationMatrix =
                  detectedCount > 0 && results.facialTransformationMatrixes
                    ? results.facialTransformationMatrixes[0]
                    : null;

                if (detectedCount === 0) {
                  setFaceState(FACE_ANALYSIS_STATUS.NO_FACE);
                  setFaceCount(0);
                } else if (detectedCount === 1) {
                  setFaceState(FACE_ANALYSIS_STATUS.FACE_DETECTED);
                  setFaceCount(1);
                  drawLandmarks(ctx, results.faceLandmarks, false);
                } else {
                  // Multiple faces detected (security/anti-spoofing warning)
                  setFaceState(FACE_ANALYSIS_STATUS.MULTIPLE_FACES);
                  setFaceCount(detectedCount);
                  drawLandmarks(ctx, results.faceLandmarks, true);
                }

                // Notify per-frame callback (for synchronous Challenge Engine processing)
                if (onFrameRef.current) {
                  onFrameRef.current({
                    landmarks: primaryFace,
                    transformationMatrix: primaryTransformationMatrix,
                    faceCount: detectedCount,
                    timestamp: startTimeMs
                  });
                }
              } catch (detectionErr) {
                console.warn('Frame detection error:', detectionErr);
              }
            }
          }

          // Continue loop on next animation frame
          animationFrameIdRef.current = requestAnimationFrame(processFrame);
        };

        // Start loop
        animationFrameIdRef.current = requestAnimationFrame(processFrame);
      } catch (loadErr) {
        if (!isCancelled) {
          console.error('Failed to initialize Face Landmarker:', loadErr);
          setFaceState(FACE_ANALYSIS_STATUS.UNAVAILABLE);
          setIsModelLoading(false);
          setError(loadErr.message || 'Failed to initialize MediaPipe Face Landmarker');
        }
      }
    };

    runLandmarkDetection();

    return () => {
      isCancelled = true;
      isRunningRef.current = false;
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
    };
  }, [isCameraActive, videoRef, canvasRef, drawLandmarks]);

  return {
    faceState,
    faceCount,
    isModelLoading,
    error,
    isFaceDetected: faceState === FACE_ANALYSIS_STATUS.FACE_DETECTED,
    hasMultipleFaces: faceState === FACE_ANALYSIS_STATUS.MULTIPLE_FACES
  };
}
