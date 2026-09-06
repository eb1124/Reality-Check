"""
Phase 11 — validity-scaled, asymmetric multi-signal fusion.

This module is deliberately independent of risk.py's event-based
deterministic score. risk.py answers "how much passive-monitoring/challenge
suspicion accumulated over the session" from the chronological event
stream, and is untouched by this module — every existing risk.py behavior
and test stays exactly as it was. This module answers a narrower, second
question: "given the session's Head Turn and Light challenge results
specifically, should risk.py's categorical verdict be nudged up or down?"
The answer is folded into the same three-tier vocabulary risk.py already
produces (LOW_RISK / REVIEW_RECOMMENDED[+escalated] / INCONCLUSIVE) — no new
tier is invented (see apply_fusion_adjustment).

SCORE CONVENTION (challenge evidence, not risk):
    1.0 = strong evidence supporting genuine liveness
    0.0 = evidence inconsistent with a successful liveness response
This is the OPPOSITE direction from risk.py's own score (0 = no risk,
higher score = more risk). The two scores are never arithmetically mixed —
fusion only ever *adjusts* risk.py's already-computed categorical state.

FUSION FORMULA:
    fused = (w_ht * s_ht + w_light * v_light * s_light)
            / (w_ht + w_light * v_light)

    w_ht, w_light   configurable weights (see config.get_fusion_config()).
                    Provisional priors: w_ht = 1.0, w_light = 0.3 — NOT a
                    calibrated result, see config.py's docstring.
    s_ht            Head Turn evidence score, in [0, 1] or None if no Head
                    Turn challenge in this session reached a terminal
                    PASSED/FAILED/TIMEOUT outcome.
    s_light         Light evidence score, in [0, 1] (see score_light).
    v_light         Light validity, in [0, 1] — how trustworthy this
                    session's Light measurement(s) were. v_light = 0 makes
                    the denominator collapse to w_ht alone, so `fused`
                    reduces exactly to s_ht: an unusable Light measurement
                    disappears from fusion instead of damaging the result.

HEAD TURN SCORING — categorical only (Step 7): Head Turn's engine only ever
produces a PASS/FAIL/TIMEOUT verdict per attempt, never a continuous
confidence value, so s_ht is the plain pass-rate across every Head Turn
challenge resolved in the session (1.0 if all passed, 0.0 if none did,
fractional only when a session contains more than one Head Turn attempt
with mixed outcomes — e.g. a retry). No invented precision.

LIGHT SCORING: each LIGHT challenge's stored `detail` dict may carry
`lightScore` and `lightValidity` (populated client-side — see
frontend/src/hooks/useLightChallengeEngine.js and
frontend/src/challenges/lightChallenge.js's evaluateLightResponse). A LIGHT
challenge with neither field present (e.g. a client that predates this
phase) is treated as validity 0 for that attempt — the same "cleanly
disappears" rule as any other unusable measurement, applied uniformly
rather than guessing at a score for data that was never captured.

AGGREGATING REPEATED CHALLENGES (Step 11): a session may run more than one
LIGHT challenge. Repeated attempts are combined with a simple,
transparent — not statistically sophisticated — rule: s_light is the
validity-weighted mean of each attempt's score (so a near-zero-validity
attempt contributes almost nothing to the combined score), and the overall
v_light is the plain mean of every attempt's validity (including invalid
ones), so a session where most Light attempts were unusable is trusted
less overall than one with consistently valid attempts, even though each
individual attempt's own validity already gates its own contribution to
the score average.

ASYMMETRIC AUTHORITY (Step 8): the fusion formula's renormalized average
structurally limits how far Light (weight 0.3) can pull the fused score
below what Head Turn alone (weight 1.0) would produce — by design, per the
provisional weights. Because of that, apply_fusion_adjustment does NOT
compare the absolute fused score against a fixed "suspicious" threshold to
decide whether to escalate (with w_light = 0.3, a maximally-suspicious,
fully-valid Light response only pulls a perfect Head Turn's fused score
down to ~0.77 — nowhere near a naive "below 0.4 is bad" cut). Instead, it
looks at how far Light pulled the score down FROM the Head-Turn-only
baseline (`drop = s_ht - fused`), which is exactly the same quantity the
fusion formula already computes, just read as a relative signal rather
than an absolute one. A meaningful relative drop, at sufficient validity,
is treated as "Light meaningfully contradicts Head Turn" and nudges the
risk tier up by (at most) one step — capped so it can never independently
push a decisive Head Turn PASS all the way to the escalated tier (the
closest thing this system has to a hard automated failure).
"""

HEAD_TURN_TYPES = ("TURN_HEAD_LEFT", "TURN_HEAD_RIGHT")
LIGHT_TYPE = "LIGHT"
RESOLVED_STATUSES = ("PASSED", "FAILED", "TIMEOUT")

RISK_LOW = "LOW_RISK"
RISK_REVIEW = "REVIEW_RECOMMENDED"
RISK_INCONCLUSIVE = "INCONCLUSIVE"

ADJUSTMENT_LIFTED = "LIGHT_LIFTED_MARGINAL_RESULT"
ADJUSTMENT_ESCALATED = "LIGHT_ESCALATED_SUSPICIOUS_RESULT"


def _clamp01(value):
    if value is None:
        return None
    return max(0.0, min(1.0, float(value)))


def score_head_turn(challenges: list) -> tuple:
    """
    Returns (s_ht, n_resolved). s_ht is None if no Head Turn challenge in
    this session reached PASSED/FAILED/TIMEOUT (ABORTED — a quality
    problem, not a verdict — is excluded, same as it is from risk.py's own
    completed-challenge accounting).
    """
    resolved = [
        c for c in challenges
        if c.get("challenge_type") in HEAD_TURN_TYPES and c.get("status") in RESOLVED_STATUSES
    ]
    if not resolved:
        return None, 0
    passed = sum(1 for c in resolved if c["status"] == "PASSED")
    return passed / len(resolved), len(resolved)


def _light_evidence(challenge: dict):
    detail = challenge.get("detail") or {}
    score = detail.get("lightScore")
    validity = detail.get("lightValidity")
    if score is None or validity is None:
        return None
    return _clamp01(score), _clamp01(validity)


def score_light(challenges: list) -> tuple:
    """
    Returns (s_light, v_light). Both None-safe: if no LIGHT challenge ran,
    or none carried score/validity evidence, returns (None, 0.0) — the
    v_light = 0.0 half of that is what makes fuse() below degrade cleanly
    to Head-Turn-only.
    """
    lights = [c for c in challenges if c.get("challenge_type") == LIGHT_TYPE]
    if not lights:
        return None, 0.0

    evidences = [e for e in (_light_evidence(c) for c in lights) if e is not None]
    if not evidences:
        return None, 0.0

    total_validity = sum(v for _, v in evidences)
    mean_validity = total_validity / len(evidences)
    if total_validity <= 0:
        return 0.0, mean_validity

    weighted_score = sum(s * v for s, v in evidences) / total_validity
    return weighted_score, mean_validity


def fuse(s_ht, s_light, v_light, head_turn_weight, light_weight):
    """The exact renormalized-average formula from this module's docstring."""
    if s_ht is None:
        return None
    v_light = _clamp01(v_light) or 0.0
    effective_light_weight = light_weight * v_light
    denom = head_turn_weight + effective_light_weight
    if denom <= 0:
        return s_ht
    s_light_value = s_light if s_light is not None else 0.0
    return (head_turn_weight * s_ht + effective_light_weight * s_light_value) / denom


def compute_fusion(challenges: list, config: dict) -> dict:
    """
    challenges: [{"challenge_type": str, "status": str, "detail": dict|None}, ...]
    config: the dict from config.get_fusion_config().
    """
    head_turn_weight = config["headTurnWeight"]
    light_weight = config["lightWeight"]

    s_ht, n_ht = score_head_turn(challenges)
    s_light, v_light = score_light(challenges)
    fused = fuse(s_ht, s_light, v_light, head_turn_weight, light_weight)

    return {
        "sHeadTurn": s_ht,
        "nHeadTurnResolved": n_ht,
        "sLight": s_light,
        "vLight": v_light,
        "fusedScore": fused,
        "decisiveHeadTurnPass": s_ht is not None and s_ht >= 1.0,
        "headTurnWeight": head_turn_weight,
        "lightWeight": light_weight,
    }


def apply_fusion_adjustment(risk: dict, fusion: dict, config: dict) -> tuple:
    """
    risk: the dict already returned by risk.compute_risk (untouched).
    Returns (possibly-adjusted risk dict, adjustment reason string or None).

    INCONCLUSIVE is never touched — thin evidence overrides fusion entirely,
    same as it already overrides the plain event score in risk.py.

    No usable Light evidence this session (fusedScore is None because no
    Head Turn evidence exists either, or vLight <= 0) -> no adjustment,
    Head-Turn-only result stands exactly as risk.py computed it.
    """
    if risk["state"] == RISK_INCONCLUSIVE:
        return risk, None
    if fusion["fusedScore"] is None or fusion["vLight"] <= 0:
        return risk, None

    fused = fusion["fusedScore"]
    s_ht = fusion["sHeadTurn"]
    s_light = fusion["sLight"]
    v_light = fusion["vLight"]

    lift_threshold = config["fusionLiftThreshold"]
    escalate_drop_threshold = config["lightEscalateDropThreshold"]
    escalate_min_validity = config["lightEscalateMinValidity"]

    # Direction 1: Light corroborates strongly enough to lift a
    # REVIEW_RECOMMENDED (but not already-escalated) result back to
    # LOW_RISK. Requires both the renormalized fused score AND Light's own
    # score to clear the threshold — a mediocre Light score riding on a
    # high fused score (which can't happen much given w_light = 0.3, but
    # kept as an explicit guard for clarity/future weight changes) must not
    # trigger a lift on its own.
    if (
        risk["state"] == RISK_REVIEW
        and not risk["escalated"]
        and fused >= lift_threshold
        and s_light is not None
        and s_light >= lift_threshold
    ):
        return {**risk, "state": RISK_LOW, "escalated": False}, ADJUSTMENT_LIFTED

    # Direction 2: Light contradicts Head Turn meaningfully. Measured as a
    # relative drop from the Head-Turn-only baseline (see module docstring
    # for why an absolute fused-score threshold doesn't work under
    # w_light = 0.3), gated on Light actually being trustworthy enough to
    # act on (v_light >= escalate_min_validity).
    if s_ht is not None:
        drop = s_ht - fused
        if v_light >= escalate_min_validity and drop >= escalate_drop_threshold:
            if risk["state"] == RISK_LOW:
                return {**risk, "state": RISK_REVIEW, "escalated": False}, ADJUSTMENT_ESCALATED
            if risk["state"] == RISK_REVIEW and not risk["escalated"] and not fusion["decisiveHeadTurnPass"]:
                # Only intensify to the escalated tier when Head Turn itself
                # was NOT a decisive pass — this is the asymmetric cap: Light
                # alone can never push a decisive Head Turn PASS into the
                # escalated tier, only into a plain (non-escalated) review.
                return {**risk, "escalated": True}, ADJUSTMENT_ESCALATED

    return risk, None
