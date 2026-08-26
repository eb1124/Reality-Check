import React from 'react';

/**
 * Full-viewport colour flash for the Light Challenge (Reality Check).
 *
 * Presentational only — never decides when to flash. Rendered exclusively
 * while useLightChallengeEngine's isFlashActive is true, which itself only
 * ever becomes true after the user has explicitly started the challenge
 * from LightChallengePanel's consent-gated control. Session/camera start
 * alone never triggers this.
 */
export default function LightFlashOverlay({ isActive, colorCss }) {
  if (!isActive) return null;

  return (
    <div
      className="light-flash-overlay"
      style={{ backgroundColor: colorCss }}
      role="status"
      aria-live="polite"
    >
      <span className="light-flash-overlay-label">Colour flash active</span>
    </div>
  );
}
