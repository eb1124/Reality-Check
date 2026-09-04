import React from 'react';
import { Radio, Square } from 'lucide-react';
import { CONTINUOUS_STATE } from '../../hooks/useContinuousVerification';

/**
 * Persistent, always-visible indicator (§8: "A persistent, always-visible
 * indicator must show the session is active. The user must be able to end
 * the session at any time.") Presentational only.
 */
export default function ContinuousSessionIndicator({ state, challengesRun, onEnd }) {
  if (state === CONTINUOUS_STATE.IDLE) return null;

  const isActive = state === CONTINUOUS_STATE.ACTIVE || state === CONTINUOUS_STATE.CHALLENGE_ACTIVE;
  const label =
    state === CONTINUOUS_STATE.STARTING
      ? 'Starting…'
      : state === CONTINUOUS_STATE.CHALLENGE_ACTIVE
      ? 'Reality Check: Challenge in progress'
      : state === CONTINUOUS_STATE.ACTIVE
      ? 'Reality Check: Session Active'
      : state === CONTINUOUS_STATE.ENDED
      ? 'Reality Check: Session Ended'
      : 'Reality Check: Error';

  return (
    <div className={`continuous-session-indicator ${isActive ? 'indicator-active' : 'indicator-inactive'}`} role="status">
      <Radio size={14} className={isActive ? 'pulse-icon' : ''} />
      <span>{label}</span>
      <span className="indicator-challenge-count">{challengesRun} challenge{challengesRun === 1 ? '' : 's'} run</span>
      {isActive && (
        <button type="button" className="btn btn-secondary btn-small" onClick={() => onEnd?.()}>
          <Square size={12} />
          <span>End Session</span>
        </button>
      )}
    </div>
  );
}
