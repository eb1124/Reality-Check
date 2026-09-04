import { useCallback, useEffect, useRef } from 'react';
import { PassiveMonitor } from '../realityCheck/monitor';
import { EventBatcher } from '../realityCheck/eventBatcher';

// §8 trigger rules: which event types request an immediate challenge.
// face_missing itself does NOT — the trigger point is the *restoration*
// after a suspicious-length absence ("face_missing exceeding
// faceMissingSuspiciousMs then restored"), handled separately below.
const IMMEDIATE_TRIGGER_EVENT_TYPES = new Set([
  'camera_stream_interrupted',
  'camera_track_ended',
  'multiple_faces_detected'
]);

/**
 * Thin React wrapper around the pure PassiveMonitor + EventBatcher classes
 * (see realityCheck/monitor.js and eventBatcher.js for the actual
 * debounce/batching logic and its fake-clock test coverage).
 *
 * `onFlush(events)` is called with a batch whenever eventFlushIntervalMs
 * elapses with something buffered. `onImmediateTrigger()` is called for
 * the §8 single-occurrence trigger rules (see IMMEDIATE_TRIGGER_EVENT_TYPES
 * plus the face_missing-then-restored case) — the caller wires this to the
 * challenge scheduler's requestEventTrigger(). Generic "suspicious"
 * severity events are separately reported via onSuspiciousEvent, for the
 * scheduler's burst-count trigger (noteSuspiciousEvent).
 */
export function usePassiveMonitor({
  config,
  isActive,
  onFlush,
  onImmediateTrigger,
  onSuspiciousEvent,
  clock = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;
  const onImmediateTriggerRef = useRef(onImmediateTrigger);
  onImmediateTriggerRef.current = onImmediateTrigger;
  const onSuspiciousEventRef = useRef(onSuspiciousEvent);
  onSuspiciousEventRef.current = onSuspiciousEvent;

  const wasFaceMissingSuspiciousRef = useRef(false);
  const batcherRef = useRef(null);
  if (batcherRef.current === null) {
    batcherRef.current = new EventBatcher({
      flushIntervalMs: config.eventFlushIntervalMs,
      onFlush: (batch) => onFlushRef.current?.(batch),
      now: clock
    });
  }

  const handleEvent = useCallback((eventType, severity, metadata) => {
    batcherRef.current.add({ eventType, severity, metadata, clientOffsetMs: null });

    if (severity === 'suspicious') {
      onSuspiciousEventRef.current?.();
    }

    if (eventType === 'face_missing' && severity === 'suspicious') {
      wasFaceMissingSuspiciousRef.current = true;
      return;
    }
    if (eventType === 'face_restored') {
      const wasSuspicious = wasFaceMissingSuspiciousRef.current;
      wasFaceMissingSuspiciousRef.current = false;
      if (wasSuspicious) onImmediateTriggerRef.current?.();
      return;
    }
    if (IMMEDIATE_TRIGGER_EVENT_TYPES.has(eventType)) {
      onImmediateTriggerRef.current?.();
    }
  }, []);

  const monitorRef = useRef(null);
  if (monitorRef.current === null) {
    monitorRef.current = new PassiveMonitor({ config, onEvent: handleEvent, now: clock });
  }

  useEffect(() => {
    if (!isActive) return undefined;
    const intervalId = setIntervalFn(() => {
      batcherRef.current.tick(clock());
    }, 1000);
    return () => {
      clearIntervalFn(intervalId);
      batcherRef.current.flushNow(clock());
    };
  }, [isActive, clock, setIntervalFn, clearIntervalFn]);

  const observeFaceCount = useCallback((faceCount) => monitorRef.current.observeFaceCount(faceCount, clock()), [clock]);
  const observeFrameChange = useCallback((hasChanged) => monitorRef.current.observeFrameChange(hasChanged, clock()), [clock]);
  const reportTrackEnded = useCallback(() => monitorRef.current.observeCameraTrackEnded(), []);
  const reportStreamInterrupted = useCallback(() => monitorRef.current.observeStreamInterrupted(), []);
  const reportDeviceChanged = useCallback(() => monitorRef.current.observeDeviceChanged(), []);

  return {
    observeFaceCount,
    observeFrameChange,
    reportTrackEnded,
    reportStreamInterrupted,
    reportDeviceChanged
  };
}
