import React from 'react';
import { ShieldCheck, Video } from 'lucide-react';
import StatusBadge from './StatusBadge';

export default function Header({ cameraStatus }) {
  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="brand-icon">
          <ShieldCheck size={26} strokeWidth={2.2} />
        </div>
        <div className="brand-text">
          <h1 className="brand-title">Reality Check</h1>
          <span className="brand-subtitle">Real-Time Active Liveness Verification</span>
        </div>
      </div>
      <div className="header-status">
        <StatusBadge status={cameraStatus} />
      </div>
    </header>
  );
}
