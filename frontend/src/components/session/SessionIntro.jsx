import React from 'react';
import { Shield, Sparkles, UserCheck, Eye } from 'lucide-react';

export default function SessionIntro() {
  return (
    <div className="session-intro-card">
      <div className="intro-header">
        <div className="intro-icon-badge">
          <Shield size={18} />
        </div>
        <h3 className="intro-title">Active Liveness Verification</h3>
      </div>
      
      <p className="intro-description">
        To prevent deepfake spoofing and pre-recorded replay attacks, you will be prompted to perform a series of unpredictable live actions in front of your camera.
      </p>

      <div className="intro-steps">
        <div className="intro-step-item">
          <div className="step-icon">
            <Eye size={16} />
          </div>
          <div className="step-body">
            <span className="step-label">Live Action Prompts</span>
            <span className="step-sub">You may be asked to turn your head, blink, or make specific gestures.</span>
          </div>
        </div>

        <div className="intro-step-item">
          <div className="step-icon">
            <Sparkles size={16} />
          </div>
          <div className="step-body">
            <span className="step-label">Real-Time Validation</span>
            <span className="step-sub">Your movement responsiveness is analyzed in real-time.</span>
          </div>
        </div>

        <div className="intro-step-item">
          <div className="step-icon">
            <UserCheck size={16} />
          </div>
          <div className="step-body">
            <span className="step-label">Identity Confidence</span>
            <span className="step-sub">Pass the interactive challenges to confirm live physical presence.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
