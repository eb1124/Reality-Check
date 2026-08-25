/**
 * Reusable evaluator for Head Turn Motion Challenges (Turn Left & Turn Right).
 *
 * POSE SOURCE:
 * Yaw is extracted from MediaPipe FaceLandmarker's `facialTransformationMatrixes[0]`
 * (enabled via `outputFacialTransformationMatrixes: true` in useFaceLandmarker.js) —
 * a rigid 4x4 head-pose transform MediaPipe fits against its canonical 3D face
 * model (rotation + uniform scale + translation only; MediaPipe's own pipeline is
 * documented to isolate this rigid pose from non-rigid expression change). This
 * replaces the previous 2D nose/eye-midpoint displacement ratio, which conflated
 * head rotation with head translation under perspective projection and required
 * an ad hoc parallax-correction constant to (imperfectly) compensate.
 *
 * MATRIX LAYOUT (verified against MediaPipe source, not assumed):
 * - `mediapipe::Matrix` is `Eigen::MatrixXf`. `MatrixDataProtoFromMatrix()`
 *   (mediapipe/framework/formats/matrix.cc) calls `matrix_data->clear_layout()`
 *   before copying `matrix.data()` straight into `packed_data` — i.e. it resets
 *   the layout field to the `MatrixData` proto's documented default, COLUMN_MAJOR
 *   ("Defaults to COLUMN_MAJOR, which matches the default for mediapipe::Matrix
 *   and Eigen::Matrix*"), with NO transpose applied.
 * - The Web/JS binding actually shipped in @mediapipe/tasks-vision
 *   (mediapipe/tasks/web/vision/face_landmarker/face_landmarker.ts,
 *   `addFacialTransformationMatrixes`) copies `getRows()/getCols()/getPackedDataList()`
 *   straight into `{rows, columns, data}` — again no transpose.
 * - Net result: `matrix.data` is COLUMN-MAJOR. Element (row r, col c) of the
 *   4x4 matrix is `data[c * 4 + r]`.
 *
 * COORDINATE CONVENTION:
 * MediaPipe's face geometry space is right-handed, with a virtual camera at the
 * origin looking down -Z, +Y up, and +X to the camera's right (Google's own
 * "MediaPipe 3D Face Transform" writeup). The matrix maps the canonical face
 * model into this runtime space: `p_runtime = M * p_canonical`, so column 2 of
 * the rotation block (`data[8], data[9], data[10]`) is where the canonical
 * model's local +Z axis (the "nose forward" direction, pointing at the camera
 * when neutral) lands in runtime space. The azimuth of that vector about the
 * vertical (Y) axis is yaw, independent of any pitch/roll layered on top:
 *
 *     yaw = atan2(data[8], data[10])   // atan2(R02, R22)
 *
 * SIGN: +X in this space is the camera's right, which — for a person facing an
 * unmirrored front camera (MediaPipe reads the raw decoded video frame, not the
 * CSS-mirrored display) — is the subject's own anatomical LEFT. A physical LEFT
 * turn swings the nose toward +X, so it should produce POSITIVE yaw; a physical
 * RIGHT turn should produce NEGATIVE yaw.
 *
 * THIS SIGN CONVENTION IS DERIVED, NOT YET DIRECTLY OBSERVED. `evaluateHeadTurn()`
 * below is wired to this convention (LEFT passes on positive delta, RIGHT on
 * negative), but per project instructions this must be confirmed against real
 * telemetry (raw R02/R22 + extracted yaw, both exposed below and surfaced in the
 * UI telemetry panel) during physical LEFT/RIGHT/neutral/lateral testing before
 * it's considered correct.
 *
 * Because only the rotation block of the matrix is read, yaw is translation
 * -invariant by construction: sliding the face sideways changes the translation
 * column (data[12..14]), not the rotation block, so yaw should stay ~0 for a
 * pure lateral slide — no parallax coefficient needed. This must also be
 * confirmed against real telemetry (lateral movement test).
 */

// Canonical face-mesh cheek landmarks, used only for the diagnostic
// face-center-X readout (lateral translation display) — no longer part of
// the yaw calculation itself.
const CHEEK_LANDMARKS = {
  RIGHT_CHEEK: 234,
  LEFT_CHEEK: 454
};

/**
 * Extracts head yaw (degrees) from a MediaPipe facial transformation matrix,
 * along with the raw rotation elements used, for telemetry/verification.
 *
 * @param {{ rows: number, columns: number, data: number[] }} matrix
 * @returns {{ isValid: boolean, yawDeg: number|null, r02: number|null, r22: number|null }}
 */
export function extractYawFromMatrix(matrix) {
  if (
    !matrix ||
    matrix.rows !== 4 ||
    matrix.columns !== 4 ||
    !Array.isArray(matrix.data) ||
    matrix.data.length < 16
  ) {
    return { isValid: false, yawDeg: null, r02: null, r22: null };
  }

  // Column-major: element (row r, col c) = data[c * 4 + r]
  const r02 = matrix.data[8];  // row 0, col 2
  const r22 = matrix.data[10]; // row 2, col 2

  const yawRad = Math.atan2(r02, r22);
  const yawDeg = yawRad * (180 / Math.PI);

  return { isValid: true, yawDeg, r02, r22 };
}

/**
 * Diagnostic-only lateral face position, independent of the yaw calculation.
 * Used purely to display how much the face has translated sideways, so a
 * pure lateral slide (yaw ~0, faceCenterX moving) is visibly distinguishable
 * from a genuine turn (yaw changing, faceCenterX roughly stable). Plays no
 * role in the pass/fail decision.
 *
 * @param {Array<{x:number,y:number,z:number}>} landmarks
 * @returns {number} Normalized [0,1] face-center X, 0.5 if unavailable.
 */
export function computeFaceCenterX(landmarks) {
  if (!landmarks || landmarks.length < 468) return 0.5;
  const rightCheek = landmarks[CHEEK_LANDMARKS.RIGHT_CHEEK];
  const leftCheek = landmarks[CHEEK_LANDMARKS.LEFT_CHEEK];
  if (!rightCheek || !leftCheek) return 0.5;
  return (rightCheek.x + leftCheek.x) / 2;
}

/**
 * Directional evaluator using rotation-matrix-derived yaw.
 *
 * @param {'LEFT' | 'RIGHT'} direction - Target rotation direction
 * @param {number} smoothedYawDeg - EMA-smoothed yaw, in degrees
 * @param {{ yawDeg: number, faceCenterX: number }} baseline - Calibrated neutral baseline
 * @param {Object} config - Threshold configuration (degrees)
 * @param {number} currentFaceCenterX - Current face center X (diagnostic only)
 * @returns {{ isPassed: boolean, signedYawDelta: number, translationDeltaX: number, directionalYawDelta: number, threshold: number, progressRatio: number }}
 */
export function evaluateHeadTurn(
  direction,
  smoothedYawDeg,
  baseline,
  config,
  currentFaceCenterX = 0.5
) {
  const threshold = config?.yawDeltaThresholdDeg ?? 15;

  if (smoothedYawDeg == null || !baseline) {
    return {
      isPassed: false,
      signedYawDelta: 0,
      translationDeltaX: 0,
      directionalYawDelta: 0,
      threshold,
      progressRatio: 0
    };
  }

  // Signed delta relative to the calibrated neutral baseline (degrees).
  // Derived convention: positive = physical LEFT, negative = physical RIGHT.
  // MUST be confirmed against real telemetry (see module docstring).
  const signedYawDelta = smoothedYawDeg - baseline.yawDeg;

  // Diagnostic only — not used in the pass/fail decision.
  const translationDeltaX = currentFaceCenterX - (baseline.faceCenterX ?? 0.5);

  const isLeft = direction === 'LEFT';
  const directionalYawDelta = isLeft ? signedYawDelta : -signedYawDelta;

  const isPassed = directionalYawDelta >= threshold;
  const progressRatio = Math.min(Math.max(directionalYawDelta / threshold, 0), 1);

  return {
    isPassed,
    signedYawDelta,
    translationDeltaX,
    directionalYawDelta,
    threshold,
    progressRatio
  };
}
