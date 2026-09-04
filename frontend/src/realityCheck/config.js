/**
 * Phase 7 continuous-session configuration. Every timing/count constant
 * used by continuous-session code must be sourced from here — none may be
 * inlined elsewhere (spec §4). Mirrors backend/app/config.py's two
 * profiles exactly; if a value changes on one side, change it on the
 * other in the same commit.
 *
 * Selected by import.meta.env.VITE_REALITY_CHECK_ENV
 * (development|production), read at call time (not module load time via a
 * top-level constant) so tests can override it without needing to
 * re-import the module.
 */

const DEVELOPMENT = {
  env: 'development',
  randomChallengeMinIntervalMs: 30_000,
  randomChallengeMaxIntervalMs: 90_000,
  challengeCooldownMs: 20_000,
  eventTriggeredChallengeCooldownMs: 30_000,
  maxChallengesPerSession: 20,
  challengeTimeoutMs: 45_000,
  faceMissingWarningMs: 1_500,
  faceMissingSuspiciousMs: 5_000,
  frozenFrameSuspiciousMs: 3_000,
  suspiciousBurstCount: 3,
  suspiciousBurstWindowMs: 60_000,
  eventFlushIntervalMs: 5_000
};

const PRODUCTION = {
  env: 'production',
  randomChallengeMinIntervalMs: 480_000,
  randomChallengeMaxIntervalMs: 1_200_000,
  challengeCooldownMs: 180_000,
  eventTriggeredChallengeCooldownMs: 300_000,
  maxChallengesPerSession: 8,
  challengeTimeoutMs: 45_000,
  faceMissingWarningMs: 1_500,
  faceMissingSuspiciousMs: 5_000,
  frozenFrameSuspiciousMs: 3_000,
  suspiciousBurstCount: 3,
  suspiciousBurstWindowMs: 60_000,
  eventFlushIntervalMs: 15_000
};

const PROFILES = { development: DEVELOPMENT, production: PRODUCTION };

export function getRealityCheckConfig() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_REALITY_CHECK_ENV) || 'development';
  return PROFILES[env] || DEVELOPMENT;
}
