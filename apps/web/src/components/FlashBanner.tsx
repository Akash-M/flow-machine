import { createPortal } from 'react-dom';

interface FlashBannerProps {
  notifications: Array<{
    id: string;
    level: 'error' | 'info' | 'success' | 'warn';
    message: string;
  }>;
  onDismiss: (id: string) => void;
}

export function FlashBanner({ notifications, onDismiss }: FlashBannerProps) {
  if (notifications.length === 0) {
    return null;
  }

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div aria-atomic="false" aria-live="polite" className="flash-banner-stack">
      {notifications.map((notification) => (
        <div className={`flash-banner flash-banner--${notification.level}`} key={notification.id} role="status">
          <p>{notification.message}</p>
          <button className="button button--ghost button--small" onClick={() => onDismiss(notification.id)} type="button">
            Dismiss
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}