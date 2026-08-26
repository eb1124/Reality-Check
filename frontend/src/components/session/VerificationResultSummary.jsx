import React from 'react';
import { ShieldCheck, RotateCcw, AlertCircle } from 'lucide-react';
import { VERIFICATION_VERDICT } from '../../hooks/useVerificationOrchestrator';

const LIGHT_LABELS = {
  LIGHT_PASS: 'Colour response observed (supplementary positive signal)',
  LIGHT_INCONCLUSIVE: 'Inconclusive (insufficient evidence — not treated as a failure)',
  LIGHT_TIMEOUT: 'Timed out',
  LIGHT_INVALID: 'Invalid attempt',
  NOT_ATTEMPTED: 'Not attempted (primary challenge did not complete)',
  DECLINED: 'Declined by user'
};

/**
 * Single combined-verdict card for the orchestrated verification session.
 * Only rendered once the orchestrator reaches ORCH_COMPLETE with a verdict.
 * Presentational only — reads the verdict object produced by
 * useVerificationOrchestrator; does not touch either underlying engine.
 */
export default function VerificationResultSummary({ verdict, onRetry }) {
  if (!verdict) return null;

  const isVerified = verdict.outcome === VERIFICATION_VERDICT.VERIFIED;
  const lightLabel = LIGHT_LABELS[verdict.light.state] || verdict.light.state;

  return (
    <div className={`modular-panel verification-summary-slot slot-active`}>
      <div className="panel-header">
        <div className="panel-title-wrap">
          <ShieldCheck size={16} />
          <h4>Verification Result</h4>
        </div>
        <span className={`slot-state-tag ${isVerified ? 'tag-success' : 'tag-error'}`}>
          {isVerified ? 'VERIFIED' : 'INCOMPLETE / RETRY REQUIRED'}
        </span>
      </div>

      <div className="panel-body">
        <div className={`challenge-result-card ${isVerified ? 'result-success' : 'result-timeout'}`}>
          <div className="result-header">
            <div className={`result-icon ${isVerified ? 'success-icon' : 'timeout-icon'}`}>
              {isVerified ? <ShieldCheck size={24} /> : <AlertCircle size={24} />}
            </div>
            <div className="result-title-wrap">
              <h4 className="result-title">
                {isVerified ? 'Session Verified' : 'Verification Incomplete'}
              </h4>
              <span className="result-subtitle">
                {isVerified
                  ? 'Primary head-turn challenge completed successfully.'
                  : 'The required sequence was not completed — please retry.'}
              </span>
            </div>
          </div>

          <div className="result-metrics-row">
            <span className="metric-label">Head Turn (primary):</span>
            <span className="metric-value font-mono">
              {verdict.headTurn.state}{verdict.headTurn.reason ? ` — ${verdict.headTurn.reason}` : ''}
            </span>
          </div>

          <div className="result-metrics-row">
            <span className="metric-label">Light Challenge (supplementary):</span>
            <span className="metric-value font-mono">{lightLabel}</span>
          </div>

          <div className="result-metrics-row">
            <span className="metric-label">Signal Verification:</span>
            <span className="metric-value font-medium text-secondary">
              Light Challenge result is a supplementary signal only — not a standalone
              proof of liveness. It never overrides the primary head-turn result.
            </span>
          </div>

          <div className="result-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={() => onRetry?.()}>
              <RotateCcw size={13} />
              <span>Retry Verification</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
