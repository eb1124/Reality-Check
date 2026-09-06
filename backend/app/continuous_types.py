"""
Canonical string-literal vocabulary for Phase 7 continuous sessions — the
backend's single source of truth for every enum-like string used across
continuous_models.py, continuous_schemas.py, continuous_routes.py, and
risk.py.

The frontend mirrors these exact values as JSDoc typedefs in
frontend/src/realityCheck/continuousTypes.js. If a value here changes, it
must change there too, in the same commit — that file's header comment
points back here. There is no shared package between the two runtimes
(plain JS, not TS), so this pairing is enforced by convention plus the
cross-referencing comments, not by the type system.
"""

SESSION_STATES = ("CREATED", "ACTIVE", "ENDED", "CANCELLED", "ERROR")
TERMINAL_SESSION_STATES = ("ENDED", "CANCELLED", "ERROR")

EVENT_TYPES = (
    "session_started", "session_ended", "session_cancelled", "session_error",
    "monitoring_started", "monitoring_stopped",
    "face_missing", "face_restored", "multiple_faces_detected", "multiple_faces_cleared",
    "landmark_discontinuity", "frozen_frame_suspected",
    "camera_track_ended", "camera_stream_interrupted", "camera_device_changed",
    "challenge_requested", "challenge_started", "challenge_passed",
    "challenge_failed", "challenge_aborted", "challenge_timeout",
    "risk_state_changed", "technical_error",
)

SEVERITIES = ("info", "warning", "suspicious", "error")

# Head Turn types reuse the frontend's existing challengeConstants.js
# CHALLENGE_TYPES vocabulary verbatim (TURN_HEAD_LEFT / TURN_HEAD_RIGHT).
# Phase 7 does not introduce a new challenge type — see ground rules.
# Phase 10 adds DEPTH_PROXIMITY ("move closer to the camera") as the third
# challenge type. Scheduling (request_next_challenge's secrets.choice) and
# risk scoring (risk.py) are both already type-agnostic, so no other backend
# change is required to add a challenge type beyond this tuple — see
# frontend/src/constants/depthProximityConstants.js for its config/state
# machine and frontend/src/realityCheck/continuousTypes.js for the mirror.
CHALLENGE_TYPES = ("TURN_HEAD_LEFT", "TURN_HEAD_RIGHT", "LIGHT", "DEPTH_PROXIMITY")

CHALLENGE_TRIGGERS = ("RANDOM", "EVENT")

CHALLENGE_STATUSES = ("PENDING", "PASSED", "FAILED", "TIMEOUT", "ABORTED")
# Subset the client is allowed to report as a result — PENDING is server-only
# (it's the state a freshly-issued challenge starts in).
CHALLENGE_CLIENT_OUTCOMES = ("PASSED", "FAILED", "TIMEOUT", "ABORTED")

RISK_STATES = ("LOW_RISK", "REVIEW_RECOMMENDED", "INCONCLUSIVE")

# Phase 11 — engineering/research-only ground-truth labels for calibration
# datasets (see app/continuous_models.py's set_ground_truth_label and
# app/fusion.py's module docstring). Never surfaced to or settable by the
# candidate-facing production verification flow; a dev/offline tool attaches
# these to already-ended sessions purely for later score-distribution
# comparison. GENUINE is the only "expected good" label; the rest are
# labeled attack categories a calibration dataset might record.
GROUND_TRUTH_LABELS = ("GENUINE", "PRINT_ATTACK", "PHONE_REPLAY", "FACE_SWAP", "MASK", "OTHER")
