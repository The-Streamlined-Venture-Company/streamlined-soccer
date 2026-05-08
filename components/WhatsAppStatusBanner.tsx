import React, { useState, useEffect } from 'react';
import { useWhatsAppStatus } from '../hooks/useWhatsAppStatus';

interface Props {
  onConnectClick?: () => void;
}

/**
 * Top-of-app banner that surfaces the bot's WhatsApp connection state.
 * Hidden when connected; renders a coloured strip when anything is off so
 * the organiser sees it the moment they open the app.
 */
const WhatsAppStatusBanner: React.FC<Props> = ({ onConnectClick }) => {
  const { status, isLoading } = useWhatsAppStatus();
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal whenever the state changes — a new disconnect should
  // re-show the banner even if the user dismissed an earlier one.
  useEffect(() => {
    setDismissed(false);
  }, [status.state]);

  // While we're still loading or the connection is healthy, render nothing.
  if (isLoading) return null;
  if (status.state === 'connected' || status.state === 'unknown') return null;
  if (dismissed) return null;

  const isCritical = status.state === 'disconnected' || status.state === 'qr-pending';
  const colour = isCritical
    ? 'bg-red-500/10 border-red-500/40 text-red-100'
    : 'bg-amber-500/10 border-amber-500/40 text-amber-100';
  const accent = isCritical ? 'text-red-300' : 'text-amber-300';
  const title = status.state === 'disconnected'
    ? '⚠️ WhatsApp disconnected'
    : status.state === 'qr-pending'
      ? '📱 WhatsApp needs a QR scan'
      : '🔄 WhatsApp reconnecting…';
  const body = status.state === 'disconnected'
    ? 'The bot is no longer paired. Scheduled posts cannot go out until you reconnect.'
    : status.state === 'qr-pending'
      ? 'Open the Connect panel and scan the QR with the bot phone.'
      : 'Trying to recover the connection — usually back within a minute.';

  return (
    <div className={`w-full border-b ${colour} backdrop-blur z-30`}>
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 text-sm">
        <div className="flex-1 min-w-0">
          <div className={`font-bold ${accent}`}>{title}</div>
          <div className="text-xs mt-0.5 opacity-90">{body}</div>
        </div>
        {isCritical && onConnectClick && (
          <button
            type="button"
            onClick={onConnectClick}
            className="flex-shrink-0 px-4 py-2 bg-white text-slate-900 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-slate-100 transition-all"
          >
            Reconnect
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="flex-shrink-0 p-2 hover:bg-white/10 rounded transition-all"
          title="Dismiss"
        >
          <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default WhatsAppStatusBanner;
