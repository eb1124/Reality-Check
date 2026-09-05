import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';

const RISK_LABELS = {
  LOW_RISK: 'Low Risk',
  REVIEW_RECOMMENDED: 'Review Recommended',
  INCONCLUSIVE: 'Inconclusive'
};

// INCONCLUSIVE means "we cannot say", not "high risk" — see
// backend/app/risk.py's module docstring. Deliberately not styled as a
// risk tier (no warning color) so this distinction reads visually too.
const RISK_ICON = {
  LOW_RISK: <CheckCircle2 size={18} className="text-success" />,
  REVIEW_RECOMMENDED: <AlertTriangle size={18} className="text-warning" />,
  INCONCLUSIVE: <HelpCircle size={18} className="text-secondary" />
};

function formatDuration(ms) {
  if (ms == null) return 'unknown';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Session integrity report (Phase 7 §9). Plain summary first, full
 * technical timeline behind a toggle — not a dashboard. Standing
 * disclaimer always visible, never hidden behind the toggle.
 */
export default function IntegrityReport({ report }) {
  const [showTimeline, setShowTimeline] = useState(false);

  if (!report) return null;

  const riskLabel = RISK_LABELS[report.riskState] || report.riskState || 'Unknown';

  return (
    <div className="modular-panel integrity-report slot-active">
      <div className="panel-header">
        <div className="panel-title-wrap">
          <FileText size={16} />
          <h4>Session Integrity Report</h4>
        </div>
      </div>

      <div className="panel-body">
        <div className="result-header">
          <div className="result-icon">{RISK_ICON[report.riskState] || <HelpCircle size={18} />}</div>
          <div className="result-title-wrap">
            <h4 className="result-title">
              {riskLabel}
              {report.riskEscalated ? ' (Escalated)' : ''}
            </h4>
            <span className="result-subtitle">
              {report.riskState === 'INCONCLUSIVE'
                ? 'Not enough evidence was collected to make a determination — this is not a finding of risk.'
                : 'Based on completed challenges and monitored session events.'}
            </span>
          </div>
        </div>

        <div className="result-metrics-row">
          <span className="metric-label">Session Duration:</span>
          <span className="metric-value font-mono">{formatDuration(report.durationMs)}</span>
        </div>
        <div className="result-metrics-row">
          <span className="metric-label">Final State:</span>
          <span className="metric-value font-mono">{report.state}</span>
        </div>
        <div className="result-metrics-row">
          <span className="metric-label">Challenges:</span>
          <span className="metric-value font-mono">
            {report.challenges?.requested ?? 0} requested / {report.challenges?.passed ?? 0} passed /{' '}
            {report.challenges?.failed ?? 0} failed
          </span>
        </div>
        <div className="result-metrics-row">
          <span className="metric-label">Suspicious Events:</span>
          <span className="metric-value font-mono">{report.suspiciousEventCount ?? 0}</span>
        </div>

        <div className="telemetry-diagnostics-card">
          <button type="button" className="telemetry-toggle-btn" onClick={() => setShowTimeline(!showTimeline)}>
            <span>Technical Detail (Timeline)</span>
            {showTimeline ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showTimeline && (
            <div className="telemetry-data-table">
              {(report.timeline || []).map((entry, i) => (
                <div className="telemetry-data-row" key={i}>
                  <span className="data-key">{entry.serverTimestamp}</span>
                  <span className="data-val font-mono">
                    {entry.eventType} <span className="text-secondary">({entry.severity})</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="result-subtitle" style={{ marginTop: '1rem' }}>
          <strong>Disclaimer:</strong> Reality Check provides active liveness evidence, camera and session
          continuity monitoring, and challenge-response verification. It does not provide OS-level
          anti-tampering and cannot guarantee an unmanipulated camera feed.
        </p>
      </div>
    </div>
  );
}
