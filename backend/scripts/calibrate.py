"""
Phase 11, Step 17 — OFFLINE/DEVELOPMENT calibration tool. Not part of the
runtime verification path; never imported by app/*. Run manually against a
directory of exported, labeled session reports to see how well Head Turn
and Light evidence actually separate GENUINE sessions from labeled attack
sessions, and to compare a data-fit weighting against the provisional
manually-chosen priors (config.get_fusion_config()'s headTurnWeight/
lightWeight = 1.0/0.3).

INPUT: a directory of JSON files, each one the dict returned by
GET /sessions/continuous/{id}/report (continuous_models.build_report) AFTER
it has been labeled via POST /sessions/continuous/{id}/label. Reports
without a `groundTruthLabel` are skipped — this tool has no way to
fabricate ground truth, and does not try to.

WHAT THIS DOES NOT DO:
  - It does not run automatically, is not wired into any test or CI step,
    and is never invoked by the runtime verification flow.
  - It does not add any dependency beyond the Python standard library
    (backend/requirements.txt has no numpy/scipy/sklearn — see this
    phase's final report for why one wasn't introduced here either).
  - It does not fabricate metrics: with zero or a handful of labeled
    sessions, AUC/FAR/FRR are still *computed* (the arithmetic doesn't
    know how small the sample is) but are NOT meaningful, and this
    script's summary output says so explicitly rather than presenting a
    confident-looking number.

USAGE:
    python scripts/calibrate.py <directory-of-labeled-report-json-files>
"""
import json
import math
import sys
from pathlib import Path

GENUINE_LABEL = "GENUINE"
MIN_SAMPLES_FOR_METRICS = 10  # below this, AUC/FAR/FRR are noted as unreliable rather than suppressed


def load_labeled_reports(directory: Path) -> list:
    reports = []
    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError) as e:
            print(f"skipping {path.name}: {e}")
            continue
        if data.get("groundTruthLabel") is None:
            continue
        reports.append(data)
    return reports


def _mean(values):
    return sum(values) / len(values) if values else None


def _stdev(values):
    if len(values) < 2:
        return None
    m = _mean(values)
    return math.sqrt(sum((v - m) ** 2 for v in values) / (len(values) - 1))


def auc(genuine_scores: list, attack_scores: list) -> float | None:
    """
    Mann-Whitney U / concordance-based AUC — pure Python, no numpy/sklearn.
    Convention: higher score = more evidence of genuine liveness (matches
    app/fusion.py's score convention), so AUC here measures how well the
    score ranks genuine sessions above attack sessions.
    """
    if not genuine_scores or not attack_scores:
        return None
    concordant = 0.0
    total = len(genuine_scores) * len(attack_scores)
    for g in genuine_scores:
        for a in attack_scores:
            if g > a:
                concordant += 1.0
            elif g == a:
                concordant += 0.5
    return concordant / total


def far_frr_sweep(genuine_scores: list, attack_scores: list, steps: int = 20) -> list:
    """
    For each threshold, classifying score >= threshold as "predicted
    genuine": FAR = fraction of attacks incorrectly predicted genuine,
    FRR = fraction of genuine sessions incorrectly predicted as attack.
    """
    rows = []
    for i in range(steps + 1):
        threshold = i / steps
        far = (
            sum(1 for a in attack_scores if a >= threshold) / len(attack_scores)
            if attack_scores
            else None
        )
        frr = (
            sum(1 for g in genuine_scores if g < threshold) / len(genuine_scores)
            if genuine_scores
            else None
        )
        rows.append({"threshold": round(threshold, 2), "far": far, "frr": frr})
    return rows


def fit_logistic_regression_2d(features: list, labels: list, epochs: int = 2000, lr: float = 0.1):
    """
    Minimal from-scratch logistic regression on two features
    ([sHeadTurn, sLight*vLight]) via batch gradient descent. Pure Python —
    fine at calibration-dataset scale (this is not a production training
    loop). Returns (w1, w2, bias). Intended to be READ and compared against
    the provisional headTurnWeight/lightWeight priors, not deployed
    directly — see this module's docstring and the Phase 11 final report's
    "Next recommendation" section for why.
    """
    n = len(labels)
    w1 = w2 = bias = 0.0
    for _ in range(epochs):
        grad_w1 = grad_w2 = grad_b = 0.0
        for (x1, x2), y in zip(features, labels):
            z = w1 * x1 + w2 * x2 + bias
            pred = 1.0 / (1.0 + math.exp(-max(-60, min(60, z))))
            error = pred - y
            grad_w1 += error * x1
            grad_w2 += error * x2
            grad_b += error
        w1 -= lr * grad_w1 / n
        w2 -= lr * grad_w2 / n
        bias -= lr * grad_b / n
    return w1, w2, bias


def main(directory_arg: str):
    directory = Path(directory_arg)
    reports = load_labeled_reports(directory)
    print(f"Loaded {len(reports)} labeled session report(s) from {directory}")
    if not reports:
        print("Nothing to calibrate — no labeled reports found.")
        return

    by_label = {}
    for r in reports:
        by_label.setdefault(r["groundTruthLabel"], []).append(r)
    print("\nSample counts by label:")
    for label, rs in sorted(by_label.items()):
        print(f"  {label}: {len(rs)}")

    genuine = by_label.get(GENUINE_LABEL, [])
    attack = [r for label, rs in by_label.items() if label != GENUINE_LABEL for r in rs]
    print(f"\nGENUINE: {len(genuine)}   ATTACK (all non-GENUINE labels combined): {len(attack)}")

    total_labeled = len(genuine) + len(attack)
    if total_labeled < MIN_SAMPLES_FOR_METRICS:
        print(
            f"\nWARNING: only {total_labeled} labeled sessions total. Every metric below is "
            f"computed but NOT statistically meaningful at this sample size (this tool's own "
            f"MIN_SAMPLES_FOR_METRICS threshold is {MIN_SAMPLES_FOR_METRICS}, itself a rough "
            f"rule of thumb, not a statistical guarantee). Treat these numbers as a smoke test "
            f"of the pipeline, not a calibration result."
        )

    for feature_name, feature_key in (("sHeadTurn", "sHeadTurn"), ("sLight", "sLight")):
        g_scores = [r["fusion"][feature_key] for r in genuine if r.get("fusion", {}).get(feature_key) is not None]
        a_scores = [r["fusion"][feature_key] for r in attack if r.get("fusion", {}).get(feature_key) is not None]
        print(f"\n--- {feature_name} ---")
        print(f"  genuine: n={len(g_scores)} mean={_mean(g_scores)} stdev={_stdev(g_scores)}")
        print(f"  attack:  n={len(a_scores)} mean={_mean(a_scores)} stdev={_stdev(a_scores)}")
        score = auc(g_scores, a_scores)
        print(f"  AUC: {score}")
        if score is not None:
            for row in far_frr_sweep(g_scores, a_scores, steps=10):
                print(f"    threshold={row['threshold']:.2f}  FAR={row['far']}  FRR={row['frr']}")

    # 2-feature logistic fit: [sHeadTurn, sLight*vLight] -> isGenuine.
    features, labels = [], []
    for r in reports:
        fusion = r.get("fusion") or {}
        s_ht = fusion.get("sHeadTurn")
        s_light = fusion.get("sLight")
        v_light = fusion.get("vLight") or 0.0
        if s_ht is None:
            continue
        features.append((s_ht, (s_light or 0.0) * v_light))
        labels.append(1.0 if r["groundTruthLabel"] == GENUINE_LABEL else 0.0)

    print("\n--- Logistic fit: [sHeadTurn, sLight*vLight] -> isGenuine ---")
    if len(features) < MIN_SAMPLES_FOR_METRICS or len(set(labels)) < 2:
        print("  Skipped: not enough labeled sessions with both classes represented.")
    else:
        w_ht, w_light, bias = fit_logistic_regression_2d(features, labels)
        print(f"  learned coefficients: w_headTurn={w_ht:.4f}  w_light={w_light:.4f}  bias={bias:.4f}")
        print(
            f"  provisional manual priors (config.get_fusion_config()): "
            f"headTurnWeight=1.0  lightWeight=0.3"
        )
        print(
            "  NOTE: these are not directly comparable magnitudes (logistic-regression "
            "coefficients on a log-odds scale vs. the fusion formula's linear-average "
            "weights) — this is a directional sanity check (does the sign/relative "
            "magnitude of w_light look like light carries any real signal at all?), "
            "not a drop-in replacement for the fusion weights."
        )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
