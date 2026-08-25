import React from 'react';
import { CAMERA_STATUS } from '../../constants/sessionConstants';

export default function StatusBadge({ status }) {
  const getBadgeConfig = () => {
    switch (status) {
      case CAMERA_STATUS.ACTIVE:
        return {
          label: 'Camera Active',
          className: 'status-active',
          dotClass: 'dot-active'
        };
      case CAMERA_STATUS.REQUESTING:
        return {
          label: 'Requesting Camera...',
          className: 'status-requesting',
          dotClass: 'dot-requesting'
        };
      case CAMERA_STATUS.PERMISSION_DENIED:
        return {
          label: 'Permission Denied',
          className: 'status-error',
          dotClass: 'dot-error'
        };
      case CAMERA_STATUS.ERROR:
        return {
          label: 'Camera Error',
          className: 'status-error',
          dotClass: 'dot-error'
        };
      case CAMERA_STATUS.IDLE:
      default:
        return {
          label: 'Camera Not Started',
          className: 'status-idle',
          dotClass: 'dot-idle'
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <div className={`status-badge ${config.className}`}>
      <span className={`status-dot ${config.dotClass}`} />
      <span className="status-label">{config.label}</span>
    </div>
  );
}
