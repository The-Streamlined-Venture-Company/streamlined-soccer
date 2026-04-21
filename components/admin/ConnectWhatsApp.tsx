import React from 'react';
import { ConnectionStatus } from '../../lib/relayClient';

interface ConnectWhatsAppProps {
  relayUrl: string | null;
  status: ConnectionStatus | null;
  isLoading: boolean;
  error: string | null;
  onConnect: () => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}

const StateBadge: React.FC<{ state: string }> = ({ state }) => {
  const styles: Record<string, string> = {
    connected: 'bg-emerald-500/20 text-emerald-300 border-emerald-700/50',
    connecting: 'bg-amber-500/20 text-amber-300 border-amber-700/50',
    'qr-pending': 'bg-amber-500/20 text-amber-300 border-amber-700/50',
    disconnected: 'bg-slate-700/40 text-slate-300 border-slate-700/50',
  };
  const cls = styles[state] ?? styles.disconnected;
  const label: Record<string, string> = {
    connected: 'Connected',
    connecting: 'Connecting…',
    'qr-pending': 'Scan QR',
    disconnected: 'Not connected',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${cls}`}>
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          state === 'connected'
            ? 'bg-emerald-400'
            : state === 'connecting' || state === 'qr-pending'
            ? 'bg-amber-400 animate-pulse'
            : 'bg-slate-500'
        }`}
      />
      {label[state] ?? state}
    </span>
  );
};

const ConnectWhatsApp: React.FC<ConnectWhatsAppProps> = ({
  relayUrl,
  status,
  isLoading,
  error,
  onConnect,
  onDisconnect,
  onRefresh,
}) => {
  if (!relayUrl) {
    return (
      <div className="text-slate-500 text-xs">
        Set the Relay URL below to connect a WhatsApp number.
      </div>
    );
  }

  const state = status?.state ?? 'disconnected';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-white text-sm font-semibold mb-1">Your WhatsApp</div>
          <div className="text-slate-500 text-xs">
            {state === 'connected' && status?.phoneNumber
              ? `Paired: ${status.phoneNumber}`
              : state === 'qr-pending'
              ? 'Open WhatsApp → Settings → Linked Devices → Link a Device, then scan.'
              : state === 'connecting'
              ? 'Waking the relay. A QR code should appear in a moment.'
              : 'Connect to let the auto-organiser post from your number.'}
          </div>
        </div>
        <StateBadge state={state} />
      </div>

      {state === 'qr-pending' && status?.qrDataUrl && (
        <div className="bg-white rounded-2xl p-3 flex items-center justify-center">
          <img src={status.qrDataUrl} alt="Scan this QR with WhatsApp" className="w-64 h-64" />
        </div>
      )}

      {state === 'connecting' && !status?.qrDataUrl && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 flex items-center justify-center">
          <div className="text-slate-400 text-sm animate-pulse">Generating QR…</div>
        </div>
      )}

      {state === 'connected' && (
        <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="text-emerald-200 text-sm font-semibold">
              {status?.phoneNumber ?? 'Connected'}
            </div>
            {typeof status?.groupCount === 'number' && (
              <div className="text-emerald-300/60 text-xs">
                {status.groupCount} group{status.groupCount === 1 ? '' : 's'} visible
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-950/40 border border-red-800/40 rounded-xl p-3 text-red-300 text-xs">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(state === 'disconnected' || state === 'connecting' || state === 'qr-pending') && (
          <button
            type="button"
            onClick={onConnect}
            disabled={isLoading}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            {state === 'qr-pending' || state === 'connecting' ? 'Regenerate QR' : 'Connect'}
          </button>
        )}

        {state === 'connected' && (
          <button
            type="button"
            onClick={onDisconnect}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
          >
            Disconnect
          </button>
        )}

        <button
          type="button"
          onClick={onRefresh}
          className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg text-xs font-semibold transition-colors border border-slate-800"
        >
          Refresh
        </button>
      </div>
    </div>
  );
};

export default ConnectWhatsApp;
