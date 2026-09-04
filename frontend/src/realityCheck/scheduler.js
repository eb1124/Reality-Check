/**
 * Pure, framework-agnostic challenge-scheduling decision logic (Phase 7
 * §8's "Challenge manager"). No React, no timers of its own — a clock
 * function is injected (defaults to Date.now) so this is directly
 * unit-testable without any real waiting; see the useChallengeScheduler
 * hook for the thin React/timer wrapper around this.
 *
 * Owns exactly the state described in §8: is a challenge currently
 * running (single-flight — at most one in flight at a time), last
 * challenge time, next random-check eligibility, a pending event-triggered
 * request, and the remaining challenge budget.
 */
export class ChallengeScheduler {
  /**
   * @param {object} config - one of the dev/prod profiles (see
   *   frontend/src/realityCheck/config.js) — randomChallengeMinIntervalMs,
   *   randomChallengeMaxIntervalMs, challengeCooldownMs,
   *   eventTriggeredChallengeCooldownMs, maxChallengesPerSession.
   * @param {() => number} [now] - injectable clock, ms.
   * @param {() => number} [random] - injectable RNG in [0, 1), for
   *   deterministic tests of the random-interval scheduling.
   */
  constructor({ config, now = Date.now, random = Math.random }) {
    this.config = config;
    this.now = now;
    this.random = random;
    this.reset();
  }

  reset() {
    this.challengeRunning = false;
    this.challengesIssued = 0;
    this.lastChallengeAt = null;
    this.pendingEventTrigger = false;
    this.suspiciousEventTimestamps = [];
    this._scheduleNextRandomCheck(this.now());
  }

  _scheduleNextRandomCheck(fromMs) {
    const { randomChallengeMinIntervalMs, randomChallengeMaxIntervalMs } = this.config;
    const span = randomChallengeMaxIntervalMs - randomChallengeMinIntervalMs;
    this.nextRandomCheckAt = fromMs + randomChallengeMinIntervalMs + this.random() * span;
  }

  _cooldownElapsed(nowMs, cooldownMs) {
    if (this.lastChallengeAt === null) return true;
    return nowMs - this.lastChallengeAt >= cooldownMs;
  }

  /** Records a suspicious event; escalates to a pending event-triggered
   * request once suspiciousBurstCount such events land within
   * suspiciousBurstWindowMs of each other. */
  noteSuspiciousEvent(nowMs = this.now()) {
    this.suspiciousEventTimestamps.push(nowMs);
    const windowStart = nowMs - this.config.suspiciousBurstWindowMs;
    this.suspiciousEventTimestamps = this.suspiciousEventTimestamps.filter((t) => t >= windowStart);
    if (this.suspiciousEventTimestamps.length >= this.config.suspiciousBurstCount) {
      this.pendingEventTrigger = true;
      this.suspiciousEventTimestamps = [];
    }
  }

  /** Directly requests an immediate challenge (e.g. camera_stream_interrupted,
   * multiple_faces_detected — the single-occurrence triggers from §8, as
   * opposed to the burst-count trigger handled by noteSuspiciousEvent). */
  requestEventTrigger() {
    this.pendingEventTrigger = true;
  }

  /**
   * Call periodically (see the hook's timer). Returns 'RANDOM' | 'EVENT' if
   * a challenge should be started right now, or null otherwise. Never
   * returns non-null while a challenge is already running (single-flight)
   * or the budget is exhausted.
   */
  decide(nowMs = this.now()) {
    if (this.challengeRunning) return null;
    if (this.challengesIssued >= this.config.maxChallengesPerSession) return null;

    if (this.pendingEventTrigger) {
      if (this._cooldownElapsed(nowMs, this.config.eventTriggeredChallengeCooldownMs)) {
        return 'EVENT';
      }
      return null; // stays pending; retried on a later tick
    }

    if (nowMs >= this.nextRandomCheckAt) {
      if (this._cooldownElapsed(nowMs, this.config.challengeCooldownMs)) {
        return 'RANDOM';
      }
      // Due for a random check but still in cooldown from a recent
      // challenge — push the next check out rather than busy-looping.
      this._scheduleNextRandomCheck(nowMs);
      return null;
    }

    return null;
  }

  /** Caller must invoke this exactly when it actually starts a challenge
   * following a non-null decide() result. */
  recordChallengeStarted(nowMs = this.now()) {
    this.challengeRunning = true;
    this.lastChallengeAt = nowMs;
    this.challengesIssued += 1;
    this.pendingEventTrigger = false;
    this._scheduleNextRandomCheck(nowMs);
  }

  recordChallengeResolved() {
    this.challengeRunning = false;
  }
}
