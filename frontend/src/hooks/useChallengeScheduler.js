import { useCallback, useEffect, useRef } from 'react';
import { ChallengeScheduler } from '../realityCheck/scheduler';

/**
 * Thin React wrapper around the pure ChallengeScheduler (see
 * realityCheck/scheduler.js for the actual decision logic and its
 * fake-clock test coverage). This hook owns only the timer that polls
 * decide() and the bridge into React re-render land — it has no
 * scheduling logic of its own to keep in sync with the tests.
 *
 * `onRunChallenge(trigger)` — trigger is 'RANDOM' | 'EVENT' — is expected
 * to itself call scheduler.markStarted()/markResolved() (exposed below) at
 * the right times; this hook does not call them automatically, since the
 * caller is the one that knows when a challenge request actually succeeded
 * (e.g. the backend might return `none` due to its own independent
 * cooldown/budget check even when this client-side scheduler thought it
 * was eligible — the backend is authoritative, this scheduler is only a
 * client-side pacing heuristic to avoid polling constantly).
 */
export function useChallengeScheduler({
  config,
  isActive,
  onRunChallenge,
  clock = Date.now,
  random = Math.random,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  pollIntervalMs = 1000
}) {
  const schedulerRef = useRef(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = new ChallengeScheduler({ config, now: clock, random });
  }

  const onRunChallengeRef = useRef(onRunChallenge);
  onRunChallengeRef.current = onRunChallenge;

  useEffect(() => {
    if (!isActive) return undefined;
    const intervalId = setIntervalFn(() => {
      const decision = schedulerRef.current.decide(clock());
      if (decision) {
        onRunChallengeRef.current?.(decision);
      }
    }, pollIntervalMs);
    return () => clearIntervalFn(intervalId);
  }, [isActive, clock, setIntervalFn, clearIntervalFn, pollIntervalMs]);

  useEffect(() => {
    if (!isActive) schedulerRef.current.reset();
  }, [isActive]);

  const noteSuspiciousEvent = useCallback(() => {
    schedulerRef.current.noteSuspiciousEvent(clock());
  }, [clock]);

  const requestEventTrigger = useCallback(() => {
    schedulerRef.current.requestEventTrigger();
  }, []);

  const markChallengeStarted = useCallback(() => {
    schedulerRef.current.recordChallengeStarted(clock());
  }, [clock]);

  const markChallengeResolved = useCallback(() => {
    schedulerRef.current.recordChallengeResolved();
  }, []);

  return { noteSuspiciousEvent, requestEventTrigger, markChallengeStarted, markChallengeResolved };
}
