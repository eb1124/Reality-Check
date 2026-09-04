/**
 * Pure, framework-agnostic passive-monitor debounce logic (Phase 7 §8).
 * No React, no MediaPipe — takes already-extracted per-frame signals
 * (face count, whether the frame changed, camera lifecycle notifications)
 * and decides when a debounced event actually fires. An injectable clock
 * (defaults to Date.now) makes this directly unit-testable; see
 * usePassiveMonitor for the thin hook wrapper that feeds it real frames.
 *
 * Debounces against the §4 thresholds — a transient blip shorter than the
 * configured threshold never reaches onEvent at all, per §8: "a 200ms
 * tracking blip is not an event."
 */
export class PassiveMonitor {
  /**
   * @param {object} config - faceMissingWarningMs, faceMissingSuspiciousMs,
   *   frozenFrameSuspiciousMs.
   * @param {(eventType: string, severity: string, metadata: object) => void} onEvent
   * @param {() => number} [now]
   */
  constructor({ config, onEvent, now = Date.now }) {
    this.config = config;
    this.onEvent = onEvent;
    this.now = now;
    this.faceMissingSince = null;
    this.missingWarningEmitted = false;
    this.missingSuspiciousEmitted = false;
    this.multipleFacesActive = false;
    this.frozenFrameSince = null;
    this.frozenEmitted = false;
  }

  /** faceCount: 0 | 1 | N, as already computed by the existing MediaPipe pipeline. */
  observeFaceCount(faceCount, nowMs = this.now()) {
    if (faceCount === 0) {
      if (this.faceMissingSince === null) this.faceMissingSince = nowMs;
      const elapsed = nowMs - this.faceMissingSince;
      if (elapsed >= this.config.faceMissingSuspiciousMs && !this.missingSuspiciousEmitted) {
        this.missingSuspiciousEmitted = true;
        this.onEvent('face_missing', 'suspicious', { elapsedMs: elapsed });
      } else if (elapsed >= this.config.faceMissingWarningMs && !this.missingWarningEmitted) {
        this.missingWarningEmitted = true;
        this.onEvent('face_missing', 'warning', { elapsedMs: elapsed });
      }
    } else {
      // Only emit a restoration if we'd actually crossed a threshold and
      // emitted something to restore from — a sub-threshold blip produced
      // no face_missing, so it must not produce a face_restored either.
      if (this.missingWarningEmitted || this.missingSuspiciousEmitted) {
        this.onEvent('face_restored', 'info', {});
      }
      this.faceMissingSince = null;
      this.missingWarningEmitted = false;
      this.missingSuspiciousEmitted = false;
    }

    if (faceCount > 1 && !this.multipleFacesActive) {
      this.multipleFacesActive = true;
      this.onEvent('multiple_faces_detected', 'suspicious', { faceCount });
    } else if (faceCount <= 1 && this.multipleFacesActive) {
      this.multipleFacesActive = false;
      this.onEvent('multiple_faces_cleared', 'info', {});
    }
  }

  /** hasChanged: whether this frame differs meaningfully from the last
   * (caller's own frame-diff heuristic — this class only debounces it). */
  observeFrameChange(hasChanged, nowMs = this.now()) {
    if (hasChanged) {
      this.frozenFrameSince = null;
      this.frozenEmitted = false;
      return;
    }
    if (this.frozenFrameSince === null) this.frozenFrameSince = nowMs;
    const elapsed = nowMs - this.frozenFrameSince;
    if (elapsed >= this.config.frozenFrameSuspiciousMs && !this.frozenEmitted) {
      this.frozenEmitted = true;
      this.onEvent('frozen_frame_suspected', 'suspicious', { elapsedMs: elapsed });
    }
  }

  /** MediaTrack lifecycle notifications — not debounced, always real (the
   * browser only fires these once per actual occurrence). */
  observeCameraTrackEnded() {
    this.onEvent('camera_track_ended', 'error', {});
  }

  observeStreamInterrupted() {
    this.onEvent('camera_stream_interrupted', 'error', {});
  }

  observeDeviceChanged() {
    this.onEvent('camera_device_changed', 'warning', {});
  }

  observeLandmarkDiscontinuity(metadata = {}) {
    this.onEvent('landmark_discontinuity', 'suspicious', metadata);
  }
}
