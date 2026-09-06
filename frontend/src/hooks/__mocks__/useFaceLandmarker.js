import { useEffect, useState } from 'react';

/**
 * Test double for the real useFaceLandmarker, which loads MediaPipe's WASM
 * runtime from a CDN and drives a requestAnimationFrame loop — neither of
 * which belong in a unit test. Used by EngineBridge/createRealityCheckSession
 * composition-root tests (see createRealityCheckSession.test.js), the same
 * way the real (unmodified) useChallengeEngine/useLightChallengeEngine are
 * swapped for their own sibling mocks there.
 *
 * Defaults to reporting exactly one face; a test can drive faceCount to 0
 * or 2+ via __setFaceCount to exercise the real (unmodified) PassiveMonitor
 * through useContinuousVerification's observeFaceCount effect, so the
 * public 'event' feed can be tested end-to-end rather than only asserting
 * its subscribe/unsubscribe shape. Never itself calls onFrame — these
 * tests drive the mocked challenge engines directly via their own
 * __setChallengeEngineState/__setLightChallengeState.
 */
let faceCount = 1;
const listeners = new Set();

export function __setFaceCount(count) {
  faceCount = count;
  listeners.forEach((l) => l());
}

export function __resetFaceLandmarkerMock() {
  faceCount = 1;
  listeners.clear();
}

export function useFaceLandmarker() {
  const [, tick] = useState(0);
  useEffect(() => {
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  return {
    faceState: faceCount === 1 ? 'FACE_DETECTED' : faceCount === 0 ? 'NO_FACE' : 'MULTIPLE_FACES',
    faceCount,
    isModelLoading: false,
    error: null,
    isFaceDetected: faceCount === 1,
    hasMultipleFaces: faceCount > 1
  };
}
