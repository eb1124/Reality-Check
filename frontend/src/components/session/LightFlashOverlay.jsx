import React from 'react';

/**
 * Full-viewport colour flash for the Light Challenge (Reality Check).
 *
 * Presentational only — never decides when to flash. Rendered exclusively
 * while useLightChallengeEngine's isFlashActive is true, which itself only
 * ever becomes true after the user has explicitly started the challenge
 * from LightChallengePanel's consent-gated control. Session/camera start
 * alone never triggers this.
 *
 * Phase 9: the positioning/layout that makes this a full-viewport overlay
 * above everything else used to live only in src/styles/App.css — fine for
 * this project's own pages, which all load that stylesheet, but an
 * embedding OA's bundle has no reason to import Reality Check's CSS at all.
 * Those properties are inlined here (kept alongside the `light-flash-overlay`
 * class for anyone who *does* load the CSS and wants to override it) so the
 * physical screen flash the Light Challenge depends on stays visible with
 * zero stylesheet dependency — the createRealityCheckSession contract is
 * "import one JS module," not "import this JS module and also this CSS file."
 */
const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 2147483000, // above practically anything a host page could stack
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  paddingBottom: 24,
  pointerEvents: 'none'
};

const LABEL_STYLE = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.75rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'rgba(0, 0, 0, 0.55)',
  backgroundColor: 'rgba(255, 255, 255, 0.35)',
  padding: '4px 10px',
  borderRadius: 9999
};

export default function LightFlashOverlay({ isActive, colorCss }) {
  if (!isActive) return null;

  return (
    <div
      className="light-flash-overlay"
      style={{ ...OVERLAY_STYLE, backgroundColor: colorCss }}
      role="status"
      aria-live="polite"
    >
      <span className="light-flash-overlay-label" style={LABEL_STYLE}>
        Colour flash active
      </span>
    </div>
  );
}
