import React, { useState } from 'react';
import {
  Target,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Loader2,
  Sliders,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { FACE_ANALYSIS_STATUS, FACE_STATUS_CONFIG } from '../../constants/faceAnalysisConstants';
import { CHALLENGE_STATE, CHALLENGE_TYPES } from '../../constants/challengeConstants';

/**
 * Challenge Engine Panel: Displays Active Liveness Challenges and real-time response metrics.
 */
export function ChallengeSlot({
  isSessionActive,
  challengeEngine
}) {
  const [showTelemetry, setShowTelemetry] = useState(true);

  const {
    challengeState,
    currentChallenge,
    currentChallengeType,
    baselineProgress,
    remainingTime,
    responseTime,
    progressRatio,
    invalidReason,
    telemetry,
    selectChallengeType,
    retryChallenge
  } = challengeEngine || {};

  const isIdle = !isSessionActive || challengeState === CHALLENGE_STATE.IDLE;
  const isPreparing = challengeState === CHALLENGE_STATE.PREPARING;
  const isBaseline = challengeState === CHALLENGE_STATE.BASELINE;
  const isActive = challengeState === CHALLENGE_STATE.CHALLENGE_ACTIVE;
  const isSuccess = challengeState === CHALLENGE_STATE.SUCCESS;
  const isTimeout = challengeState === CHALLENGE_STATE.TIMEOUT;
  const isInvalid = challengeState === CHALLENGE_STATE.INVALID;

  const isLeft = currentChallenge?.direction === 'LEFT';

  // Hold progress (0% to 100%)
  const holdProgress = telemetry?.requiredHoldDurationMs
    ? Math.min(Math.round((telemetry.holdDurationMs / telemetry.requiredHoldDurationMs) * 100), 100)
    : 0;

  return (
    <div className={`modular-panel challenge-slot ${!isIdle ? 'slot-active' : 'slot-idle'}`}>
      <div className="panel-header">
        <div className="panel-title-wrap">
          <Target size={16} />
          <h4>Active Challenge Engine</h4>
        </div>
        <span className={`slot-state-tag ${
          isSuccess
            ? 'tag-success'
            : isTimeout || isInvalid
            ? 'tag-error'
            : isActive
            ? 'tag-challenge-active'
            : isBaseline || isPreparing
            ? 'tag-calibrating'
            : 'tag-standby'
        }`}>
          {isIdle && 'Standby'}
          {isPreparing && 'Checking Pose'}
          {isBaseline && 'Calibrating'}
          {isActive && `Active: ${currentChallenge?.title}`}
          {isSuccess && 'Challenge Passed'}
          {isTimeout && 'Timed Out'}
          {isInvalid && 'Invalid Pose'}
        </span>
      </div>

      <div className="panel-body">
        {/* Direction Switcher (When Idle or on Result Screen) */}
        {(isIdle || isSuccess || isTimeout || isInvalid) && (
          <div className="challenge-selector-bar">
            <span className="selector-label">Motion Challenge:</span>
            <div className="selector-buttons">
              <button
                type="button"
                className={`btn-selector ${currentChallengeType === CHALLENGE_TYPES.TURN_HEAD_LEFT ? 'selector-active' : ''}`}
                onClick={() => selectChallengeType(CHALLENGE_TYPES.TURN_HEAD_LEFT)}
                disabled={isActive}
              >
                <ArrowLeft size={13} />
                <span>Turn Left</span>
              </button>
              <button
                type="button"
                className={`btn-selector ${currentChallengeType === CHALLENGE_TYPES.TURN_HEAD_RIGHT ? 'selector-active' : ''}`}
                onClick={() => selectChallengeType(CHALLENGE_TYPES.TURN_HEAD_RIGHT)}
                disabled={isActive}
              >
                <span>Turn Right</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        )}

        {isIdle && (
          <div className="challenge-idle-view">
            <p className="slot-empty-notice">
              Selected challenge: <strong>{currentChallenge?.title}</strong>. Click <strong>"Start Verification"</strong> to begin.
            </p>
          </div>
        )}

        {isPreparing && (
          <div className="challenge-status-box">
            <div className="status-spin-wrap">
              <Loader2 size={20} className="spin-icon text-primary" />
            </div>
            <div className="status-text-wrap">
              <span className="status-primary-text">Preparing {currentChallenge?.title}</span>
              <span className="status-secondary-text">Ensure your face is centered in frame...</span>
            </div>
          </div>
        )}

        {isBaseline && (
          <div className="challenge-status-box">
            <div className="status-spin-wrap">
              <Loader2 size={20} className="spin-icon text-warning" />
            </div>
            <div className="status-text-wrap">
              <span className="status-primary-text">Establishing Neutral Baseline</span>
              <span className="status-secondary-text">Keep your head steady ({Math.round(baselineProgress)}%)</span>
              <div className="progress-track">
                <div
                  className="progress-bar-fill fill-warning"
                  style={{ width: `${baselineProgress}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {isActive && (
          <div className="challenge-active-view">
            <div className="challenge-prompt-card">
              <div className="prompt-header">
                <span className="prompt-badge">ACTION REQUIRED</span>
                <div className="prompt-timer">
                  <Clock size={13} />
                  <span>{remainingTime}s remaining</span>
                </div>
              </div>

              <div className="prompt-instruction-wrap">
                <div className="direction-icon-wrap">
                  {isLeft ? (
                    <ArrowLeft size={26} className="arrow-pulse-left" />
                  ) : (
                    <ArrowRight size={26} className="arrow-pulse-right" />
                  )}
                </div>
                <h3 className="prompt-instruction-text">
                  {currentChallenge?.instruction}
                </h3>
              </div>

              <p className="prompt-hint">{currentChallenge?.hint}</p>

              {/* Real-Time Head Rotation & Temporal Hold Progress */}
              <div className="yaw-meter-container">
                <div className="yaw-meter-labels">
                  <span>Neutral</span>
                  <span className="yaw-target-label">Target {currentChallenge?.direction} (≥{telemetry?.threshold ?? 15}&deg;, provisional)</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-bar-fill fill-primary"
                    style={{ width: `${Math.round(progressRatio * 100)}%` }}
                  />
                </div>

                {/* Sustained Hold Timer Bar */}
                <div className="hold-timer-section">
                  <div className="hold-timer-label">
                    <span>Sustained Hold Validation:</span>
                    <span className={telemetry?.isHolding ? 'text-success font-mono' : 'text-tertiary font-mono'}>
                      {telemetry?.holdDurationMs || 0}ms / {telemetry?.requiredHoldDurationMs || 280}ms
                    </span>
                  </div>
                  <div className="progress-track progress-track-thin">
                    <div
                      className={`progress-bar-fill ${telemetry?.isHolding ? 'fill-success' : 'fill-primary'}`}
                      style={{ width: `${holdProgress}%` }}
                    />
                  </div>
                </div>

                <span className="yaw-status-text">
                  {telemetry?.isHolding
                    ? `Holding position (${holdProgress}%)...`
                    : progressRatio >= 0.95
                    ? 'Threshold reached, hold head position...'
                    : 'Waiting for response...'}
                </span>
              </div>
            </div>
          </div>
        )}

        {isSuccess && (
          <div className="challenge-result-card result-success">
            <div className="result-header">
              <div className="result-icon success-icon">
                <CheckCircle2 size={24} />
              </div>
              <div className="result-title-wrap">
                <h4 className="result-title">Challenge Passed</h4>
                <span className="result-subtitle">{currentChallenge?.title} verified via matrix-derived head yaw</span>
              </div>
            </div>

            <div className="result-metrics-row">
              <span className="metric-label">Response Time:</span>
              <span className="metric-value font-mono text-success">
                {responseTime}s
              </span>
            </div>

            <div className="result-metrics-row">
              <span className="metric-label">Sustained Duration:</span>
              <span className="metric-value font-mono">
                {telemetry?.requiredHoldDurationMs || 280}ms continuous
              </span>
            </div>

            <div className="result-metrics-row">
              <span className="metric-label">Signal Verification:</span>
              <span className="metric-value font-medium text-secondary">
                Expected head movement detected
              </span>
            </div>

            <div className="result-actions">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => retryChallenge()}>
                <RefreshCw size={13} />
                <span>Test Again</span>
              </button>
            </div>
          </div>
        )}

        {isTimeout && (
          <div className="challenge-result-card result-timeout">
            <div className="result-header">
              <div className="result-icon timeout-icon">
                <Clock size={24} />
              </div>
              <div className="result-title-wrap">
                <h4 className="result-title">Challenge Timed Out</h4>
                <span className="result-subtitle">No sustained {currentChallenge?.direction.toLowerCase()}ward rotation within {currentChallenge?.timeoutSeconds}s</span>
              </div>
            </div>

            <div className="result-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => retryChallenge()}>
                <RefreshCw size={13} />
                <span>Retry Challenge</span>
              </button>
            </div>
          </div>
        )}

        {isInvalid && (
          <div className="challenge-result-card result-invalid">
            <div className="result-header">
              <div className="result-icon invalid-icon">
                <AlertTriangle size={24} />
              </div>
              <div className="result-title-wrap">
                <h4 className="result-title">Challenge Invalidated</h4>
                <span className="result-subtitle">{invalidReason || 'Face tracking was lost or disrupted'}</span>
              </div>
            </div>

            <div className="result-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => retryChallenge()}>
                <RefreshCw size={13} />
                <span>Retry Challenge</span>
              </button>
            </div>
          </div>
        )}

        {/* Live Signal Diagnostics Telemetry Table */}
        {telemetry && (isActive || isSuccess || isTimeout || isBaseline) && (
          <div className="telemetry-diagnostics-card">
            <button
              type="button"
              className="telemetry-toggle-btn"
              onClick={() => setShowTelemetry(!showTelemetry)}
            >
              <div className="telemetry-toggle-title">
                <Sliders size={14} />
                <span>Directional Diagnostics & Telemetry</span>
              </div>
              {showTelemetry ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showTelemetry && (
              <div className="telemetry-data-table">
                <div className="telemetry-data-row">
                  <span className="data-key">Challenge Direction:</span>
                  <span className="data-val font-mono font-bold text-primary">
                    {telemetry.challengeDirection}
                  </span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Raw Matrix R02 / R22:</span>
                  <span className="data-val font-mono text-secondary">
                    {telemetry.rawR02} / {telemetry.rawR22}
                  </span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Baseline Yaw:</span>
                  <span className="data-val font-mono text-secondary">
                    {telemetry.baselineYaw}&deg;
                  </span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Current Raw Yaw:</span>
                  <span className="data-val font-mono text-secondary">
                    {telemetry.currentRawYaw}&deg;
                  </span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Current Smoothed Yaw:</span>
                  <span className="data-val font-mono text-secondary">
                    {telemetry.currentSmoothedYaw}&deg; (EMA &alpha;=0.40)
                  </span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Signed Yaw Delta:</span>
                  <span className={`data-val font-mono ${telemetry.signedYawDelta > 0 ? 'text-primary' : telemetry.signedYawDelta < 0 ? 'text-warning' : 'text-secondary'}`}>
                    {telemetry.signedYawDelta >= 0 ? `+${telemetry.signedYawDelta}` : telemetry.signedYawDelta}&deg; (derived convention: Positive=LEFT, Negative=RIGHT — unverified, pending physical test)
                  </span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Direction-Adjusted Delta:</span>
                  <span className={`data-val font-mono font-bold ${telemetry.directionAdjustedDelta >= telemetry.threshold ? 'text-success' : 'text-secondary'}`}>
                    {telemetry.directionAdjustedDelta >= 0 ? `+${telemetry.directionAdjustedDelta}` : telemetry.directionAdjustedDelta}&deg;
                  </span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Threshold Required (provisional):</span>
                  <span className="data-val font-mono text-secondary">
                    &ge; +{telemetry.threshold}&deg;
                  </span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Sustained Hold State:</span>
                  <span className={`data-val font-mono ${telemetry.isHolding ? 'text-success' : 'text-secondary'}`}>
                    {telemetry.sustainedHoldState}
                  </span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Face Center (X / ΔX):</span>
                  <span className="data-val font-mono text-secondary">
                    {telemetry.faceCenterX} (Δ {telemetry.translationDeltaX >= 0 ? `+${telemetry.translationDeltaX}` : telemetry.translationDeltaX})
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Analysis Panel: Displays MediaPipe 3D Landmark Telemetry.
 */
export function AnalysisSlot({ isSessionActive, isCameraActive, faceState, faceCount }) {
  const isStandby = !isCameraActive;
  const config = FACE_STATUS_CONFIG[faceState] || FACE_STATUS_CONFIG[FACE_ANALYSIS_STATUS.STANDBY];

  return (
    <div className={`modular-panel analysis-slot ${!isStandby ? 'slot-active' : 'slot-idle'}`}>
      <div className="panel-header">
        <div className="panel-title-wrap">
          <Activity size={16} />
          <h4>Face Landmark Analysis</h4>
        </div>
        <span className={`slot-state-tag ${config.badgeClass}`}>
          {config.label}
        </span>
      </div>

      <div className="panel-body">
        {isStandby ? (
          <p className="slot-empty-notice">
            MediaPipe Face Landmarker activates automatically when camera feed is live.
          </p>
        ) : (
          <div className="analysis-telemetry-grid">
            <div className="telemetry-row">
              <span className="telemetry-label">Detection Status:</span>
              <span className="telemetry-value font-medium">{config.description}</span>
            </div>

            <div className="telemetry-row">
              <span className="telemetry-label">Subject Count:</span>
              <span className={`telemetry-value ${faceCount === 1 ? 'text-success' : faceCount > 1 ? 'text-error' : 'text-secondary'}`}>
                {faceCount === 1 ? '1 Face (Valid)' : faceCount > 1 ? `${faceCount} Faces (Alert)` : '0 Faces'}
              </span>
            </div>

            <div className="telemetry-row">
              <span className="telemetry-label">Vision Engine:</span>
              <span className="telemetry-value font-mono">MediaPipe 3D Mesh (478 pts)</span>
            </div>

            {faceCount > 1 && (
              <div className="telemetry-alert-box">
                <AlertTriangle size={15} />
                <span>Verification requires a single subject. Multiple people detected in frame.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
