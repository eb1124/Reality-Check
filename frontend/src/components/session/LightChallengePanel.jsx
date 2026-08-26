import React, { useState } from 'react';
import {
  Lightbulb,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Clock,
  RefreshCw,
  Loader2,
  Sliders,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { LIGHT_CHALLENGE_STATE } from '../../constants/lightChallengeConstants';

function DeltaRow({ label, delta, relativeDelta }) {
  if (!delta) return null;
  return (
    <div className="telemetry-data-row">
      <span className="data-key">{label}</span>
      <span className={`data-val font-mono ${delta >= 0 ? 'text-success' : 'text-warning'}`}>
        {delta >= 0 ? `+${delta}` : delta}
        {relativeDelta != null && ` (${relativeDelta >= 0 ? '+' : ''}${(relativeDelta * 100).toFixed(1)}%)`}
      </span>
    </div>
  );
}

/**
 * Light Challenge (Reality Check) panel — Option 1 MVP: skin reflectance /
 * colour-match response. Independent of the Motion Challenge panel; does
 * not read or affect its engine.
 */
export default function LightChallengePanel({ isSessionActive, lightChallengeEngine }) {
  const [consentGiven, setConsentGiven] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(true);

  const {
    challengeState,
    config,
    baselineProgress,
    remainingTime,
    responseTime,
    invalidReason,
    telemetry,
    startLightChallenge,
    retryLightChallenge
  } = lightChallengeEngine || {};

  const S = LIGHT_CHALLENGE_STATE;
  const isIdle = !isSessionActive || challengeState === S.IDLE;
  const isPreparing = challengeState === S.PREPARING;
  const isBaseline = challengeState === S.BASELINE;
  const isFlashPhase = challengeState === S.FLASH || challengeState === S.RESPONSE || challengeState === S.EVALUATE;
  const isPass = challengeState === S.PASS;
  const isInconclusive = challengeState === S.INCONCLUSIVE;
  const isTimeout = challengeState === S.TIMEOUT;
  const isInvalid = challengeState === S.INVALID;
  const isResult = isPass || isInconclusive || isTimeout || isInvalid;

  return (
    <div className={`modular-panel light-challenge-slot ${!isIdle ? 'slot-active' : 'slot-idle'}`}>
      <div className="panel-header">
        <div className="panel-title-wrap">
          <Lightbulb size={16} />
          <h4>Light Challenge (Beta)</h4>
        </div>
        <span className={`slot-state-tag ${
          isPass
            ? 'tag-success'
            : isTimeout || isInvalid
            ? 'tag-error'
            : isInconclusive
            ? 'tag-calibrating'
            : isFlashPhase
            ? 'tag-challenge-active'
            : isBaseline || isPreparing
            ? 'tag-calibrating'
            : 'tag-standby'
        }`}>
          {isIdle && 'Standby'}
          {isPreparing && 'Checking Pose'}
          {isBaseline && 'Calibrating'}
          {isFlashPhase && 'Flash In Progress'}
          {isPass && 'Response Observed (PASS)'}
          {isInconclusive && 'Inconclusive'}
          {isTimeout && 'Timed Out'}
          {isInvalid && 'Invalid'}
        </span>
      </div>

      <div className="panel-body">
        {/* Photosensitivity warning — always visible, required consent before any flash can be requested. */}
        <div className="light-photosensitivity-warning">
          <ShieldAlert size={16} className="light-warning-icon" />
          <div className="light-warning-text">
            <strong>Photosensitivity notice:</strong> this challenge briefly displays a bright, saturated
            colour across the screen. If you are sensitive to flashing or bright colour changes, do not
            start this challenge.
          </div>
        </div>

        {isIdle && (
          <div className="light-idle-view">
            <label className="light-consent-row">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
              />
              <span>I understand this test will flash a bright colour on screen and want to proceed.</span>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={!isSessionActive || !consentGiven}
              onClick={() => startLightChallenge()}
            >
              <Lightbulb size={13} />
              <span>Start Light Challenge</span>
            </button>
            <p className="slot-empty-notice light-mvp-notice">
              <HelpCircle size={12} /> MVP / calibration build — thresholds are PROVISIONAL and not yet
              validated against real webcam data. This challenge reports a supplementary PASS/INCONCLUSIVE
              signal only; it does not by itself prove a human is present.
            </p>
          </div>
        )}

        {isPreparing && (
          <div className="challenge-status-box">
            <div className="status-spin-wrap">
              <Loader2 size={20} className="spin-icon text-primary" />
            </div>
            <div className="status-text-wrap">
              <span className="status-primary-text">Preparing Light Challenge</span>
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
              <span className="status-primary-text">Establishing Pre-Flash Baseline</span>
              <span className="status-secondary-text">Keep your head steady, screen stays neutral ({Math.round(baselineProgress)}%)</span>
              <div className="progress-track">
                <div className="progress-bar-fill fill-warning" style={{ width: `${baselineProgress}%` }} />
              </div>
            </div>
          </div>
        )}

        {isFlashPhase && (
          <div className="challenge-status-box">
            <div className="status-spin-wrap">
              <Loader2 size={20} className="spin-icon text-primary" />
            </div>
            <div className="status-text-wrap">
              <span className="status-primary-text">Flash in progress — hold still</span>
              <span className="status-secondary-text">{remainingTime}s remaining in this attempt</span>
            </div>
          </div>
        )}

        {isPass && (
          <div className="challenge-result-card result-success">
            <div className="result-header">
              <div className="result-icon success-icon">
                <CheckCircle2 size={24} />
              </div>
              <div className="result-title-wrap">
                <h4 className="result-title">Colour Response Observed</h4>
                <span className="result-subtitle">{telemetry?.resultReason}</span>
              </div>
            </div>
            <div className="result-metrics-row">
              <span className="metric-label">Attempt Time:</span>
              <span className="metric-value font-mono text-success">{responseTime}s</span>
            </div>
            <div className="result-metrics-row">
              <span className="metric-label">Signal Verification:</span>
              <span className="metric-value font-medium text-secondary">
                Supplementary signal only — not a standalone liveness proof.
              </span>
            </div>
            <div className="result-actions">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => retryLightChallenge()}>
                <RefreshCw size={13} />
                <span>Test Again</span>
              </button>
            </div>
          </div>
        )}

        {isInconclusive && (
          <div className="challenge-result-card result-timeout">
            <div className="result-header">
              <div className="result-icon timeout-icon">
                <HelpCircle size={24} />
              </div>
              <div className="result-title-wrap">
                <h4 className="result-title">Inconclusive</h4>
                <span className="result-subtitle">{telemetry?.resultReason}</span>
              </div>
            </div>
            <div className="result-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => retryLightChallenge()}>
                <RefreshCw size={13} />
                <span>Retry Challenge</span>
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
                <span className="result-subtitle">Attempt did not complete within {config?.timeoutSeconds}s</span>
              </div>
            </div>
            <div className="result-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => retryLightChallenge()}>
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
                <span className="result-subtitle">{invalidReason || 'Tracking was lost or samples were insufficient'}</span>
              </div>
            </div>
            <div className="result-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => retryLightChallenge()}>
                <RefreshCw size={13} />
                <span>Retry Challenge</span>
              </button>
            </div>
          </div>
        )}

        {/* Calibration telemetry — exposed so PROVISIONAL thresholds can be tuned against real webcam data. */}
        {(isBaseline || isFlashPhase || isResult) && telemetry && (
          <div className="telemetry-diagnostics-card">
            <button type="button" className="telemetry-toggle-btn" onClick={() => setShowTelemetry(!showTelemetry)}>
              <div className="telemetry-toggle-title">
                <Sliders size={14} />
                <span>Light Response Diagnostics & Telemetry</span>
              </div>
              {showTelemetry ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showTelemetry && (
              <div className="telemetry-data-table">
                <div className="telemetry-data-row">
                  <span className="data-key">Flash Colour:</span>
                  <span className="data-val font-mono text-secondary">{telemetry.flashColorCss} (channel: {telemetry.expectedResponseChannel})</span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Baseline Frames / Required:</span>
                  <span className="data-val font-mono text-secondary">{telemetry.baselineFrameCount} / {telemetry.requiredBaselineFrames}</span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">Response Frames / Min:</span>
                  <span className="data-val font-mono text-secondary">{telemetry.responseFrameCount} / {telemetry.minResponseFrames}</span>
                </div>

                {telemetry.responseDiagnostics && (
                  <>
                    <div className="telemetry-data-row">
                      <span className="data-key">Response Raw Calls / Successful:</span>
                      <span className="data-val font-mono text-secondary">{telemetry.responseDiagnostics.rawCalls} / {telemetry.responseFrameCount}</span>
                    </div>
                    <div className="telemetry-data-row">
                      <span className="data-key">Face Loss Skips:</span>
                      <span className="data-val font-mono text-secondary">{telemetry.responseDiagnostics.faceLossSkips}</span>
                    </div>
                    <div className="telemetry-data-row">
                      <span className="data-key">Multi-Face Aborts:</span>
                      <span className="data-val font-mono text-secondary">{telemetry.responseDiagnostics.multiFaceAbort}</span>
                    </div>
                    <div className="telemetry-data-row">
                      <span className="data-key">Video Not Ready Skips:</span>
                      <span className="data-val font-mono text-secondary">{telemetry.responseDiagnostics.videoNotReady}</span>
                    </div>
                    <div className="telemetry-data-row">
                      <span className="data-key">Guard Skips:</span>
                      <span className="data-val font-mono text-secondary">{telemetry.responseDiagnostics.guardSkips}</span>
                    </div>
                    <div className="telemetry-data-row">
                      <span className="data-key">Null Samples:</span>
                      <span className="data-val font-mono text-secondary">{telemetry.responseDiagnostics.nullSamples}</span>
                    </div>
                  </>
                )}

                {telemetry.baseline && (
                  <>
                    <div className="telemetry-data-row">
                      <span className="data-key">Baseline (combined) RGB:</span>
                      <span className="data-val font-mono text-secondary">
                        {telemetry.baseline.combined.mean.meanR} / {telemetry.baseline.combined.mean.meanG} / {telemetry.baseline.combined.mean.meanB}
                      </span>
                    </div>
                    <div className="telemetry-data-row">
                      <span className="data-key">Baseline Luminance / ChromaR / ChromaG:</span>
                      <span className="data-val font-mono text-secondary">
                        {telemetry.baseline.combined.mean.luminance} / {telemetry.baseline.combined.mean.chromaR} / {telemetry.baseline.combined.mean.chromaG}
                      </span>
                    </div>
                  </>
                )}

                {telemetry.response && (
                  <div className="telemetry-data-row">
                    <span className="data-key">Response (combined) RGB:</span>
                    <span className="data-val font-mono text-secondary">
                      {telemetry.response.combined.mean.meanR} / {telemetry.response.combined.mean.meanG} / {telemetry.response.combined.mean.meanB}
                    </span>
                  </div>
                )}

                {telemetry.delta && (
                  <>
                    <DeltaRow label="Δ Combined Chroma-R:" delta={telemetry.delta.combined.delta.chromaR} />
                    <DeltaRow label="Δ Combined Luminance:" delta={telemetry.delta.combined.delta.luminance} relativeDelta={telemetry.delta.combined.relativeDelta.luminance} />
                    <DeltaRow label="Δ Left Cheek Chroma-R:" delta={telemetry.delta.left.chromaR} />
                    <DeltaRow label="Δ Right Cheek Chroma-R:" delta={telemetry.delta.right.chromaR} />
                    <div className="telemetry-data-row">
                      <span className="data-key">Noise Floor / Confident Threshold:</span>
                      <span className="data-val font-mono text-secondary">{telemetry.noiseFloor} / {telemetry.confidentThreshold}</span>
                    </div>
                    <div className="telemetry-data-row">
                      <span className="data-key">Bilateral Agreement:</span>
                      <span className={`data-val font-mono ${
                        telemetry.bilateralSameSign == null
                          ? 'text-secondary'
                          : telemetry.bilateralSameSign ? 'text-success' : 'text-warning'
                      }`}>
                        {telemetry.bilateralSameSign == null
                          ? 'Not evaluated'
                          : `${telemetry.bilateralSameSign ? 'same-sign' : 'opposite-sign'}, ratio ${telemetry.bilateralMagRatio}`}
                      </span>
                    </div>
                    <div className="telemetry-data-row">
                      <span className="data-key">Full-Frame Reference Δ Luminance:</span>
                      <span className={`data-val font-mono ${telemetry.globalDriftSuspect ? 'text-warning' : 'text-secondary'}`}>
                        {telemetry.globalDelta} {telemetry.globalDriftSuspect ? '(AE/AWB drift suspected)' : ''}
                      </span>
                    </div>
                  </>
                )}

                <div className="telemetry-data-row">
                  <span className="data-key">Settle / Response Window / Flash Duration:</span>
                  <span className="data-val font-mono text-secondary">
                    {telemetry.settleDelayMsUsed}ms / {telemetry.measurementWindowMsUsed}ms / {telemetry.flashDurationMsUsed}ms
                  </span>
                </div>
                <div className="telemetry-data-row">
                  <span className="data-key">ROI Patch Pixel Count (L/R):</span>
                  <span className="data-val font-mono text-secondary">{telemetry.roiPixelCounts.left} / {telemetry.roiPixelCounts.right}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
