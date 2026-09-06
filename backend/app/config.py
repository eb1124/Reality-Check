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


# Phase 11 — validity-scaled multi-signal fusion (see app/fusion.py for the
# formula/decision logic these feed). Centralized here per Phase 7 spec §4's
# "no inlined constants" rule, extended to this phase's own config surface.
#
# THESE ARE PROVISIONAL ENGINEERING DEFAULTS, NOT CALIBRATED PRODUCTION
# COEFFICIENTS. headTurnWeight/lightWeight in particular are a starting
# prior chosen because the current Light Challenge implementation is
# comparatively experimental (single-colour flash, no structured
# illumination, no verified camera AWB/exposure control) — not a measured
# result. They must only change after real labeled-session calibration (see
# the calibration data captured in continuous_models.build_report's
# `fusion`/`challengeEvidence` fields), never by developer guess. Not
# env-dependent (unlike get_config() above): the fusion prior is an
# architecture-level choice, not a deployment-environment one.
_FUSION = {
    # w_ht / w_light in the fusion formula (app/fusion.py).
    "headTurnWeight": 1.0,
    "lightWeight": 0.3,
    # Both the renormalized fused score AND Light's own score must clear
    # this for a marginal REVIEW_RECOMMENDED result to be lifted back to
    # LOW_RISK (fusion.apply_fusion_adjustment, "lift" direction).
    "fusionLiftThreshold": 0.75,
    # Minimum *relative* drop (sHeadTurn - fusedScore) from the
    # Head-Turn-only baseline that counts as "Light meaningfully
    # contradicts Head Turn" (see app/fusion.py's module docstring for why
    # this is relative, not an absolute fused-score cutoff).
    "lightEscalateDropThreshold": 0.15,
    # Below this Light validity, a suspicious Light score is not trusted
    # enough to escalate anything.
    "lightEscalateMinValidity": 0.5,
    # Light validity gates (Step 4) — computed client-side from real
    # capture-quality measurements (see
    # frontend/src/constants/lightChallengeConstants.js and
    # useLightChallengeEngine.js), thresholds centralized here as the
    # single source of truth for what the frontend should treat as
    # "usable." All provisional/unvalidated against real telemetry.
    "lightMinScreenContributionRatio": 0.02,  # relative baseline->flash luminance increase
    "lightMinFaceCoverageRatio": 0.06,  # interocular px / min(video w,h)
    "lightMinDeliveredFps": 24,  # frames actually sampled during the response window
}


def get_fusion_config() -> dict:
    return _FUSION
