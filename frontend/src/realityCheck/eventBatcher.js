/**
 * Pure event-batching logic (Phase 7 §8: "Batch events and flush on
 * eventFlushIntervalMs"). No React, no timers of its own — same
 * injectable-clock pattern as scheduler.js/monitor.js.
 */
export class EventBatcher {
  /**
   * @param {number} flushIntervalMs
   * @param {(events: object[]) => void} onFlush
   * @param {() => number} [now]
   */
  constructor({ flushIntervalMs, onFlush, now = Date.now }) {
    this.flushIntervalMs = flushIntervalMs;
    this.onFlush = onFlush;
    this.now = now;
    this.buffer = [];
    // Initialized at construction time, not lazily on first tick() — a
    // lazy init would reset the interval clock to whenever tick() first
    // happens to be called, so a tick() shortly after items were added
    // would never see the interval as elapsed relative to when the
    // batcher actually started.
    this.lastFlushAt = now();
  }

  add(event) {
    this.buffer.push(event);
  }

  /** Call periodically (see the hook's timer). Flushes only if the
   * interval has elapsed AND there's something to send — never sends an
   * empty batch. */
  tick(nowMs = this.now()) {
    if (nowMs - this.lastFlushAt < this.flushIntervalMs) return;
    this.lastFlushAt = nowMs;
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.onFlush(batch);
  }

  /** Immediate flush regardless of interval — used on teardown so nothing
   * buffered is silently dropped. */
  flushNow(nowMs = this.now()) {
    this.lastFlushAt = nowMs;
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.onFlush(batch);
  }
}
