import React, { useState } from 'react';
import { Eye, ShieldAlert } from 'lucide-react';

/**
 * One-time consent for continuous monitoring — distinct from the existing
 * per-attempt Light Challenge consent (LightChallengePanel.jsx), which
 * still gates only the screen-flash step. This gate covers the entire
 * session: the camera stays on and is actively monitored (passively, plus
 * occasional active challenges) for as long as the session runs.
 */
export default function ContinuousConsentGate({ onAccept, onDecline }) {
  const [consentGiven, setConsentGiven] = useState(false);

  return (
    <div className="modular-panel continuous-consent-gate slot-active">
      <div className="panel-header">
        <div className="panel-title-wrap">
          <ShieldAlert size={16} />
          <h4>Continuous Monitoring Consent</h4>
        </div>
      </div>
      <div className="panel-body">
        <p className="slot-empty-notice">
          This session keeps your camera on and actively monitored for its
          entire duration — not just a single check at the start. You will
          occasionally be asked to complete a short Head Turn or Light
          Challenge, at unpredictable times, for as long as the session runs.
        </p>
        <div className="intro-step-item">
          <div className="step-icon">
            <Eye size={16} />
          </div>
          <div className="step-body">
            <span className="step-label">You can end the session at any time.</span>
            <span className="step-sub">Ending stops all monitoring and releases the camera immediately.</span>
          </div>
        </div>

        <label className="light-consent-row">
          <input
            type="checkbox"
            checked={consentGiven}
            onChange={(e) => setConsentGiven(e.target.checked)}
          />
          <span>I understand my camera will be continuously monitored for the duration of this session.</span>
        </label>

        <div className="result-actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={!consentGiven}
            onClick={() => onAccept?.()}
          >
            Start Continuous Session
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => onDecline?.()}>
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
