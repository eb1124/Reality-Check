import React from 'react';
import { AlertTriangle, RefreshCw, HelpCircle } from 'lucide-react';

export default function ErrorBanner({ error, onRetry }) {
  if (!error) return null;

  return (
    <div className="error-banner">
      <div className="error-banner-header">
        <div className="error-icon">
          <AlertTriangle size={20} />
        </div>
        <div className="error-title-wrap">
          <h4 className="error-title">{error.title}</h4>
          <span className="error-type-tag">{error.type}</span>
        </div>
      </div>
      
      <p className="error-message">{error.message}</p>
      
      {error.resolution && (
        <div className="error-resolution">
          <div className="resolution-icon">
            <HelpCircle size={15} />
          </div>
          <span className="resolution-text"><strong>Resolution:</strong> {error.resolution}</span>
        </div>
      )}

      {onRetry && (
        <div className="error-actions">
          <button type="button" className="btn-retry" onClick={onRetry}>
            <RefreshCw size={15} />
            <span>Retry Camera Access</span>
          </button>
        </div>
      )}
    </div>
  );
}
