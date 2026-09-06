"""
Tests for the Phase 11 validity-scaled Head-Turn/Light fusion layer
(app/fusion.py) and its integration into continuous_models.end_continuous_session.

Pure-function tests (compute_fusion/apply_fusion_adjustment) exercise the
fusion module directly, with no DB. Integration tests drive the full HTTP
lifecycle to confirm the fusion adjustment actually reaches the persisted
riskState/riskEscalated a caller sees in the report.
"""
from app.config import get_fusion_config
from app.fusion import apply_fusion_adjustment, compute_fusion, score_head_turn, score_light


def _ht(status):
    return {"challenge_type": "TURN_HEAD_LEFT", "status": status, "detail": None}


def _light(status, score=None, validity=None, extra=None):
    detail = None
    if score is not None or validity is not None or extra:
        detail = {}
        if score is not None:
            detail["lightScore"] = score
        if validity is not None:
            detail["lightValidity"] = validity
        if extra:
            detail.update(extra)
    return {"challenge_type": "LIGHT", "status": status, "detail": detail}


CONFIG = get_fusion_config()


# --- score_head_turn / score_light (pure helpers) --------------------------

def test_score_head_turn_none_when_no_resolved_challenge():
    assert score_head_turn([]) == (None, 0)
    assert score_head_turn([{"challenge_type": "TURN_HEAD_LEFT", "status": "ABORTED", "detail": None}]) == (None, 0)


def test_score_head_turn_is_pass_rate():
    assert score_head_turn([_ht("PASSED")]) == (1.0, 1)
    assert score_head_turn([_ht("FAILED")]) == (0.0, 1)
    assert score_head_turn([_ht("PASSED"), _ht("FAILED")]) == (0.5, 2)


def test_score_light_zero_validity_when_no_evidence_data():
    # A LIGHT challenge with no lightScore/lightValidity in its detail
    # (e.g. a pre-Phase-11 client) must not fabricate evidence.
    assert score_light([_light("PASSED")]) == (None, 0.0)


def test_score_light_uses_validity_weighted_mean_for_repeated_challenges():
    s, v = score_light([_light("PASSED", score=1.0, validity=1.0), _light("ABORTED", score=0.0, validity=0.0)])
    assert v == 0.5  # mean of [1.0, 0.0]
    assert s == 1.0  # the zero-validity attempt contributes nothing to the score average


# --- fuse() / compute_fusion() ----------------------------------------------

def test_fusion_v_light_zero_restores_head_turn_only_behavior():
    challenges = [_ht("PASSED"), _light("ABORTED")]  # no score/validity data at all
    fusion = compute_fusion(challenges, CONFIG)
    assert fusion["vLight"] == 0.0
    assert fusion["fusedScore"] == fusion["sHeadTurn"] == 1.0


def test_fusion_no_head_turn_evidence_yields_none_fused_score():
    challenges = [_light("PASSED", score=1.0, validity=1.0)]
    fusion = compute_fusion(challenges, CONFIG)
    assert fusion["sHeadTurn"] is None
    assert fusion["fusedScore"] is None


def test_fusion_formula_matches_documented_weights():
    challenges = [_ht("PASSED"), _light("PASSED", score=0.5, validity=1.0)]
    fusion = compute_fusion(challenges, CONFIG)
    w_ht, w_light = CONFIG["headTurnWeight"], CONFIG["lightWeight"]
    expected = (w_ht * 1.0 + w_light * 1.0 * 0.5) / (w_ht + w_light * 1.0)
    assert fusion["fusedScore"] == expected


# --- apply_fusion_adjustment: the asymmetric decision rules -----------------

def _risk(state, escalated=False, score=0):
    return {"score": score, "state": state, "escalated": escalated, "inconclusiveReason": None}


def test_inconclusive_risk_is_never_adjusted_by_fusion():
    risk = _risk("INCONCLUSIVE")
    fusion = compute_fusion([_ht("PASSED"), _light("PASSED", score=0.0, validity=1.0)], CONFIG)
    adjusted, reason = apply_fusion_adjustment(risk, fusion, CONFIG)
    assert adjusted == risk
    assert reason is None


def test_no_light_evidence_leaves_risk_untouched_example_a():
    # Example A: strong Head Turn pass, Light validity 0 -> Light contributes nothing.
    risk = _risk("LOW_RISK")
    fusion = compute_fusion([_ht("PASSED"), _light("ABORTED")], CONFIG)
    adjusted, reason = apply_fusion_adjustment(risk, fusion, CONFIG)
    assert adjusted == risk
    assert reason is None


def test_high_validity_strong_light_lifts_a_marginal_review_to_low_risk_example_b():
    # Example B: Head Turn borderline (session already at REVIEW_RECOMMENDED,
    # non-escalated, but Head Turn itself passed cleanly) + high-validity
    # strong Light response -> lifted to LOW_RISK.
    risk = _risk("REVIEW_RECOMMENDED", escalated=False, score=2)
    fusion = compute_fusion([_ht("PASSED"), _light("PASSED", score=1.0, validity=1.0)], CONFIG)
    adjusted, reason = apply_fusion_adjustment(risk, fusion, CONFIG)
    assert adjusted["state"] == "LOW_RISK"
    assert adjusted["escalated"] is False
    assert reason == "LIGHT_LIFTED_MARGINAL_RESULT"


def test_high_validity_suspicious_light_escalates_low_risk_example_c():
    # Example C: otherwise-clean session (LOW_RISK) + high-validity,
    # suspicious Light -> escalate to REVIEW_RECOMMENDED (never straight to
    # a hard fail — there is no such tier).
    risk = _risk("LOW_RISK", score=0)
    fusion = compute_fusion([_ht("PASSED"), _light("ABORTED", score=0.0, validity=1.0)], CONFIG)
    adjusted, reason = apply_fusion_adjustment(risk, fusion, CONFIG)
    assert adjusted["state"] == "REVIEW_RECOMMENDED"
    assert adjusted["escalated"] is False
    assert reason == "LIGHT_ESCALATED_SUSPICIOUS_RESULT"


def test_suspicious_light_cannot_escalate_a_decisive_head_turn_pass_to_hard_fail_example_d():
    # Example D: decisive Head Turn PASS + highly valid, strongly suspicious
    # Light -> at worst REVIEW_RECOMMENDED, escalated must stay False (the
    # asymmetric cap — Light alone can never reach this system's most
    # severe tier). The drop is large enough here to matter (it clears
    # lightEscalateDropThreshold), which is exactly why the decisive-pass
    # guard needs to explicitly block it rather than relying on the drop
    # simply being too small.
    risk = _risk("REVIEW_RECOMMENDED", escalated=False, score=2)  # some unrelated mild suspicion already present
    fusion = compute_fusion([_ht("PASSED"), _light("ABORTED", score=0.0, validity=1.0)], CONFIG)
    assert fusion["decisiveHeadTurnPass"] is True
    assert (fusion["sHeadTurn"] - fusion["fusedScore"]) >= CONFIG["lightEscalateDropThreshold"]
    adjusted, reason = apply_fusion_adjustment(risk, fusion, CONFIG)
    assert adjusted == risk  # completely untouched — the guard suppresses the adjustment entirely
    assert reason is None


def test_suspicious_light_can_escalate_a_non_decisive_marginal_result_to_escalated_tier():
    # Contrast with the above: when Head Turn was NOT a decisive pass (3 of
    # 4 attempts passed -> sHeadTurn = 0.75, still short of 1.0), suspicious
    # high-validity Light IS allowed to intensify an already-under-review
    # session to the escalated tier.
    risk = _risk("REVIEW_RECOMMENDED", escalated=False, score=2)
    fusion = compute_fusion(
        [_ht("PASSED"), _ht("PASSED"), _ht("PASSED"), _ht("FAILED"), _light("ABORTED", score=0.0, validity=1.0)],
        CONFIG,
    )
    assert fusion["sHeadTurn"] == 0.75
    assert fusion["decisiveHeadTurnPass"] is False
    adjusted, reason = apply_fusion_adjustment(risk, fusion, CONFIG)
    assert adjusted["state"] == "REVIEW_RECOMMENDED"
    assert adjusted["escalated"] is True
    assert reason == "LIGHT_ESCALATED_SUSPICIOUS_RESULT"


def test_invalid_light_ambient_gate_example_e():
    # Example E: Head Turn weak (failed) + Light invalid due to unusable
    # capture conditions (validity 0, no score) -> Light must not be
    # interpreted as corroborating evidence of a security failure; the
    # result rests on Head Turn's own (already-poor) evidence alone.
    risk = _risk("REVIEW_RECOMMENDED", escalated=False, score=2)
    fusion = compute_fusion([_ht("FAILED"), _light("ABORTED")], CONFIG)
    adjusted, reason = apply_fusion_adjustment(risk, fusion, CONFIG)
    assert adjusted == risk
    assert reason is None


def test_low_validity_suspicious_light_does_not_escalate():
    # Validity below lightEscalateMinValidity must not be trusted enough to
    # move the risk tier at all, regardless of how suspicious its score is.
    risk = _risk("LOW_RISK")
    fusion = compute_fusion([_ht("PASSED"), _light("ABORTED", score=0.0, validity=0.2)], CONFIG)
    adjusted, reason = apply_fusion_adjustment(risk, fusion, CONFIG)
    assert adjusted == risk
    assert reason is None
