import { describe, expect, it } from 'vitest';
import { EventBatcher } from './eventBatcher';

function makeClock(startMs = 0) {
  let t = startMs;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('EventBatcher', () => {
  it('does not flush before the interval elapses', () => {
    const clock = makeClock();
    const flushes = [];
    const batcher = new EventBatcher({ flushIntervalMs: 5_000, onFlush: (b) => flushes.push(b), now: clock.now });

    batcher.add({ eventType: 'face_missing' });
    clock.advance(4_999);
    batcher.tick(clock.now());

    expect(flushes).toHaveLength(0);
  });

  it('flushes once the interval elapses, with everything buffered since the last flush', () => {
    const clock = makeClock();
    const flushes = [];
    const batcher = new EventBatcher({ flushIntervalMs: 5_000, onFlush: (b) => flushes.push(b), now: clock.now });

    batcher.add({ eventType: 'face_missing' });
    batcher.add({ eventType: 'face_restored' });
    clock.advance(5_000);
    batcher.tick(clock.now());

    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toHaveLength(2);
  });

  it('never sends an empty batch', () => {
    const clock = makeClock();
    const flushes = [];
    const batcher = new EventBatcher({ flushIntervalMs: 5_000, onFlush: (b) => flushes.push(b), now: clock.now });

    clock.advance(10_000);
    batcher.tick(clock.now());

    expect(flushes).toHaveLength(0);
  });

  it('flushNow sends immediately regardless of elapsed time, for teardown', () => {
    const clock = makeClock();
    const flushes = [];
    const batcher = new EventBatcher({ flushIntervalMs: 5_000, onFlush: (b) => flushes.push(b), now: clock.now });

    batcher.add({ eventType: 'session_ended' });
    clock.advance(10); // far short of the interval
    batcher.flushNow(clock.now());

    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toEqual([{ eventType: 'session_ended' }]);
  });
});
