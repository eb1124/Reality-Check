"""
Phase 7 continuous-session configuration. Every timing/count constant used
by continuous-session code must be sourced from here — none may be inlined
elsewhere (Phase 7 spec §4). Selected by REALITY_CHECK_ENV
(development|production), read fresh on every call rather than cached at
import time, matching the existing pattern in database.py's get_db_path()
so tests can monkeypatch it per-test.

This is Phase 7 config only. The Phase 1/2 one-shot session code
(app/models.py, app/routes.py) has no configurable constants and is
untouched.
"""
import os

ENV_VAR = "REALITY_CHECK_ENV"

_DEVELOPMENT = {
    "env": "development",
    "randomChallengeMinIntervalMs": 30_000,
    "randomChallengeMaxIntervalMs": 90_000,
    "challengeCooldownMs": 20_000,
    "eventTriggeredChallengeCooldownMs": 30_000,
    "maxChallengesPerSession": 20,
    "challengeTimeoutMs": 45_000,
    "faceMissingWarningMs": 1_500,
    "faceMissingSuspiciousMs": 5_000,
    "frozenFrameSuspiciousMs": 3_000,
    "suspiciousBurstCount": 3,
    "suspiciousBurstWindowMs": 60_000,
    "eventFlushIntervalMs": 5_000,
}

_PRODUCTION = {
    "env": "production",
    "randomChallengeMinIntervalMs": 480_000,
    "randomChallengeMaxIntervalMs": 1_200_000,
    "challengeCooldownMs": 180_000,
    "eventTriggeredChallengeCooldownMs": 300_000,
    "maxChallengesPerSession": 8,
    "challengeTimeoutMs": 45_000,
    "faceMissingWarningMs": 1_500,
    "faceMissingSuspiciousMs": 5_000,
    "frozenFrameSuspiciousMs": 3_000,
    "suspiciousBurstCount": 3,
    "suspiciousBurstWindowMs": 60_000,
    "eventFlushIntervalMs": 15_000,
}

_PROFILES = {"development": _DEVELOPMENT, "production": _PRODUCTION}


def get_config() -> dict:
    env = os.environ.get(ENV_VAR, "development")
    return _PROFILES.get(env, _DEVELOPMENT)
