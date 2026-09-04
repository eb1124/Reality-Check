import { describe, expect, it } from 'vitest';
import { PassiveMonitor } from './monitor';

const CONFIG = {
  faceMissingWarningMs: 1_500,
  faceMissingSuspiciousMs: 5_000,
  frozenFrameSuspiciousMs: 3_000
};

function makeClock(startMs = 0) {
  let t = startMs;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeCollector() {
  const events = [];
  return { events, onEvent: (eventType, severity, metadata) => events.push({ eventType, severity, metadata }) };
}

describe('PassiveMonitor face-missing debounce', () => {
  it('a blip under the warning threshold triggers nothing (test 7)', () => {
    const clock = makeClock();
    const { events, onEvent } = makeCollector();
    const monitor = new PassiveMonitor({ config: CONFIG, onEvent, now: clock.now });

    monitor.observeFaceCount(0, clock.now());
    clock.advance(200); // well under faceMissingWarningMs
    monitor.observeFaceCount(1, clock.now()); // face returns before any threshold crossed

    expect(events).toHaveLength(0);
  });

  it('crossing the warning threshold emits a warning-severity face_missing event, once', () => {
    const clock = makeClock();
    const { events, onEvent } = makeCollector();
    const monitor = new PassiveMonitor({ config: CONFIG, onEvent, now: clock.now });

    monitor.observeFaceCount(0, clock.now());
    clock.advance(1_600);
    monitor.observeFaceCount(0, clock.now());
    clock.advance(100);
    monitor.observeFaceCount(0, clock.now()); // still missing — must not re-emit

    const missingEvents = events.filter((e) => e.eventType === 'face_missing');
    expect(missingEvents).toHaveLength(1);
    expect(missingEvents[0].severity).toBe('warning');
  });

  it('crossing the suspicious threshold emits a second, suspicious-severity face_missing event', () => {
    const clock = makeClock();
    const { events, onEvent } = makeCollector();
    const monitor = new PassiveMonitor({ config: CONFIG, onEvent, now: clock.now });

    monitor.observeFaceCount(0, clock.now());
    clock.advance(1_600);
    monitor.observeFaceCount(0, clock.now()); // warning fires
    clock.advance(3_500); // total 5.1s -> crosses suspicious (5s)
    monitor.observeFaceCount(0, clock.now());

    const missingEvents = events.filter((e) => e.eventType === 'face_missing');
    expect(missingEvents).toHaveLength(2);
    expect(missingEvents.map((e) => e.severity)).toEqual(['warning', 'suspicious']);
  });

  it('emits face_restored only after a real (threshold-crossing) absence, not after a sub-threshold blip', () => {
    const clock = makeClock();
    const { events, onEvent } = makeCollector();
    const monitor = new PassiveMonitor({ config: CONFIG, onEvent, now: clock.now });

    // Sub-threshold blip: no restored event should follow.
    monitor.observeFaceCount(0, clock.now());
    clock.advance(200);
    monitor.observeFaceCount(1, clock.now());
    expect(events.filter((e) => e.eventType === 'face_restored')).toHaveLength(0);

    // Real absence: restored event should follow.
    monitor.observeFaceCount(0, clock.now());
    clock.advance(1_600);
    monitor.observeFaceCount(0, clock.now());
    monitor.observeFaceCount(1, clock.now());
    expect(events.filter((e) => e.eventType === 'face_restored')).toHaveLength(1);
  });

  it('multiple faces detected/cleared fires exactly once per transition', () => {
    const clock = makeClock();
    const { events, onEvent } = makeCollector();
    const monitor = new PassiveMonitor({ config: CONFIG, onEvent, now: clock.now });

    monitor.observeFaceCount(2, clock.now());
    monitor.observeFaceCount(2, clock.now()); // still multiple — no re-fire
    monitor.observeFaceCount(1, clock.now());

    const detected = events.filter((e) => e.eventType === 'multiple_faces_detected');
    const cleared = events.filter((e) => e.eventType === 'multiple_faces_cleared');
    expect(detected).toHaveLength(1);
    expect(cleared).toHaveLength(1);
  });
});

describe('PassiveMonitor frozen-frame debounce', () => {
  it('a brief unchanged-frame run under the threshold triggers nothing', () => {
    const clock = makeClock();
    const { events, onEvent } = makeCollector();
    const monitor = new PassiveMonitor({ config: CONFIG, onEvent, now: clock.now });

    monitor.observeFrameChange(false, clock.now());
    clock.advance(500);
    monitor.observeFrameChange(true, clock.now()); // frame changes before threshold

    expect(events.filter((e) => e.eventType === 'frozen_frame_suspected')).toHaveLength(0);
  });

  it('an unchanged-frame run past the threshold emits frozen_frame_suspected once', () => {
    const clock = makeClock();
    const { events, onEvent } = makeCollector();
    const monitor = new PassiveMonitor({ config: CONFIG, onEvent, now: clock.now });

    monitor.observeFrameChange(false, clock.now());
    clock.advance(3_100);
    monitor.observeFrameChange(false, clock.now());
    monitor.observeFrameChange(false, clock.now());

    expect(events.filter((e) => e.eventType === 'frozen_frame_suspected')).toHaveLength(1);
  });
});

describe('PassiveMonitor camera lifecycle', () => {
  it('camera lifecycle notifications fire immediately, undebounced', () => {
    const { events, onEvent } = makeCollector();
    const monitor = new PassiveMonitor({ config: CONFIG, onEvent });

    monitor.observeCameraTrackEnded();
    monitor.observeStreamInterrupted();
    monitor.observeDeviceChanged();

    expect(events.map((e) => e.eventType)).toEqual([
      'camera_track_ended',
      'camera_stream_interrupted',
      'camera_device_changed'
    ]);
  });
});
