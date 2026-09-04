import { describe, expect, it } from 'vitest';
import { ChallengeScheduler } from './scheduler';

const CONFIG = {
  randomChallengeMinIntervalMs: 30_000,
  randomChallengeMaxIntervalMs: 90_000,
  challengeCooldownMs: 20_000,
  eventTriggeredChallengeCooldownMs: 30_000,
  maxChallengesPerSession: 20,
  suspiciousBurstCount: 3,
  suspiciousBurstWindowMs: 60_000
};

/** A manually-advanced fake clock — no real waiting, no vi.useFakeTimers()
 * needed since ChallengeScheduler never calls setTimeout itself. */
function makeClock(startMs = 0) {
  let t = startMs;
  const now = () => t;
  const advance = (ms) => { t += ms; };
  return { now, advance };
}

describe('ChallengeScheduler', () => {
  it('does not fire before the random interval window opens', () => {
    const clock = makeClock();
    const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => 0 });
    // random()=0 -> next check at exactly randomChallengeMinIntervalMs (30s)
    clock.advance(29_999);
    expect(scheduler.decide(clock.now())).toBeNull();
  });

  it('fires once the random interval window opens (test 4: random scheduling fires within window)', () => {
    const clock = makeClock();
    const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => 0 });
    clock.advance(30_000);
    expect(scheduler.decide(clock.now())).toBe('RANDOM');
  });

  it('the random interval is not a fixed value across resets (test 4: not a fixed interval)', () => {
    const randomValues = [0, 0.25, 0.5, 0.75, 0.99];
    const seenTargets = new Set();
    for (const r of randomValues) {
      const clock = makeClock();
      const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => r });
      seenTargets.add(scheduler.nextRandomCheckAt);
    }
    expect(seenTargets.size).toBeGreaterThan(1);
  });

  it('cooldown suppresses a second challenge (test 8)', () => {
    const clock = makeClock();
    const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => 0 });
    clock.advance(30_000);
    expect(scheduler.decide(clock.now())).toBe('RANDOM');
    scheduler.recordChallengeStarted(clock.now());
    scheduler.recordChallengeResolved();

    clock.advance(1); // essentially no time has passed
    expect(scheduler.decide(clock.now())).toBeNull();
  });

  it('allows a new challenge once cooldown has elapsed', () => {
    const clock = makeClock();
    const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => 0 });
    clock.advance(30_000);
    scheduler.decide(clock.now());
    scheduler.recordChallengeStarted(clock.now());
    scheduler.recordChallengeResolved();

    clock.advance(CONFIG.challengeCooldownMs);
    // Also need to be past the freshly-rescheduled random window.
    clock.advance(CONFIG.randomChallengeMinIntervalMs);
    expect(scheduler.decide(clock.now())).toBe('RANDOM');
  });

  it('at most one challenge in flight — a decide() while running returns null (test 9)', () => {
    const clock = makeClock();
    const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => 0 });
    clock.advance(30_000);
    expect(scheduler.decide(clock.now())).toBe('RANDOM');
    scheduler.recordChallengeStarted(clock.now());

    // A trigger arriving while a challenge is already running must start nothing.
    scheduler.requestEventTrigger();
    expect(scheduler.decide(clock.now())).toBeNull();
  });

  it('maxChallengesPerSession is enforced (test 10)', () => {
    const clock = makeClock();
    const smallBudgetConfig = { ...CONFIG, maxChallengesPerSession: 2 };
    const scheduler = new ChallengeScheduler({ config: smallBudgetConfig, now: clock.now, random: () => 0 });

    for (let i = 0; i < 2; i++) {
      clock.advance(CONFIG.randomChallengeMinIntervalMs + CONFIG.challengeCooldownMs);
      const decision = scheduler.decide(clock.now());
      expect(decision).toBe('RANDOM');
      scheduler.recordChallengeStarted(clock.now());
      scheduler.recordChallengeResolved();
    }

    clock.advance(CONFIG.randomChallengeMinIntervalMs + CONFIG.challengeCooldownMs);
    expect(scheduler.decide(clock.now())).toBeNull();
  });

  it('a suspicious burst below the configured count triggers nothing (test 7 analog)', () => {
    const clock = makeClock();
    const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => 0 });
    scheduler.noteSuspiciousEvent(clock.now());
    scheduler.noteSuspiciousEvent(clock.now());
    // Only 2 of the required 3 — must not have armed a pending trigger.
    expect(scheduler.pendingEventTrigger).toBe(false);
    expect(scheduler.decide(clock.now())).toBeNull();
  });

  it('a suspicious burst reaching the configured count triggers an immediate challenge (test 6)', () => {
    const clock = makeClock();
    const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => 0 });
    scheduler.noteSuspiciousEvent(clock.now());
    scheduler.noteSuspiciousEvent(clock.now());
    scheduler.noteSuspiciousEvent(clock.now());
    expect(scheduler.decide(clock.now())).toBe('EVENT');
  });

  it('events outside the burst window do not accumulate toward the count', () => {
    const clock = makeClock();
    const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => 0 });
    scheduler.noteSuspiciousEvent(clock.now());
    clock.advance(CONFIG.suspiciousBurstWindowMs + 1);
    scheduler.noteSuspiciousEvent(clock.now());
    scheduler.noteSuspiciousEvent(clock.now());
    // Only 2 remain within the window (the first aged out) -> no trigger.
    expect(scheduler.pendingEventTrigger).toBe(false);
  });

  it('event-triggered cooldown is enforced independently of the random cooldown', () => {
    const clock = makeClock();
    const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => 0 });
    clock.advance(30_000);
    scheduler.decide(clock.now());
    scheduler.recordChallengeStarted(clock.now());
    scheduler.recordChallengeResolved();

    // 25s elapsed: clears the RANDOM cooldown (20s) but not the
    // event-triggered cooldown (30s).
    clock.advance(25_000);
    scheduler.requestEventTrigger();
    expect(scheduler.decide(clock.now())).toBeNull();

    clock.advance(5_001);
    expect(scheduler.decide(clock.now())).toBe('EVENT');
  });

  it('challenge type selection is left entirely to the caller — decide() only says RANDOM/EVENT/null', () => {
    // (Type is server-decided per §7, not by this scheduler — this test
    // documents that boundary explicitly.)
    const clock = makeClock();
    const scheduler = new ChallengeScheduler({ config: CONFIG, now: clock.now, random: () => 0 });
    clock.advance(30_000);
    const decision = scheduler.decide(clock.now());
    expect(['RANDOM', 'EVENT', null]).toContain(decision);
  });
});
