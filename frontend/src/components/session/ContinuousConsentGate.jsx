import React, { useState } from 'react';
import { ShieldAlert } from 'lucide-react';

/**
 * One-time consent for continuous monitoring — distinct from the existing
 * per-attempt Light Challenge consent (LightChallengePanel.jsx), which
 * still gates only the screen-flash step. This gate covers the entire
 * session: the camera stays on and is actively monitored (passively, plus
 * occasional active challenges) for as long as the session runs.
 *
 * Phase 11: simplified to exactly one blocking action ("Start Assessment",
 * always enabled — continuous monitoring itself is a condition of taking
 * the assessment, not a separate opt-in a candidate can decline and still
 * proceed) plus exactly one checkbox, which is NOT a consent gate at all —
 * it's a photosensitivity/accessibility disclosure. Checking it disables
 * the Light Challenge for this session entirely (see
 * onAccept(disableLightChallenge) below); it never blocks starting.
 */
export default function ContinuousConsentGate({ onAccept, onDecline }) {
  const [hasPhotosensitivity, setHasPhotosensitivity] = useState(false);

  return (
    <div className="modular-panel continuous-consent-gate slot-active">
      <div className="panel-header">
        <div className="panel-title-wrap">
          <ShieldAlert size={16} />
          <h4>Before you start</h4>
        </div>
      </div>
      <div className="panel-body">
        <p className="slot-empty-notice">
          This session keeps your camera on and actively monitored for its entire
          duration. You will occasionally be asked to complete a short Head Turn or
          Light Challenge, at unpredictable times, for as long as the session runs.
          You can end the session at any time, which stops all monitoring and
          releases the camera immediately.
        </p>

        <label className="light-consent-row">
          <input
            type="checkbox"
            checked={hasPhotosensitivity}
            onChange={(e) => setHasPhotosensitivity(e.target.checked)}
          />
          <span>
            I have photosensitive epilepsy or a sensitivity to flashing/bright lights
            (this disables the Light Challenge's screen flash for this session).
          </span>
        </label>

        <div className="result-actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => onAccept?.(hasPhotosensitivity)}
          >
            Start Assessment
          </button>
          {onDecline && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => onDecline?.()}>
              Decline
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
