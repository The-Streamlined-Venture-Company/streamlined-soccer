import { useEffect, useRef, useState, useCallback } from 'react';
import { relayClient, ConnectionStatus, RelayError } from '../lib/relayClient';

/**
 * Synthesize a "disconnected" status for the case where the relay returns
 * 503 because no tenant session exists yet. Multi-tenant sessions are lazy;
 * they only spring into being on POST /connect. Until then /status 503s.
 */
const DISCONNECTED_STATUS: ConnectionStatus = {
  state: 'disconnected',
  phoneNumber: null,
  groupCount: 0,
  qrDataUrl: null,
  timestamp: new Date().toISOString(),
};

interface UseWhatsAppConnectionOptions {
  relayUrl: string | null | undefined;
  /** Auto-refresh interval in ms when connecting / QR pending. Default 2000. */
  pollIntervalMs?: number;
}

interface UseWhatsAppConnectionReturn {
  status: ConnectionStatus | null;
  isLoading: boolean;
  error: string | null;
  /** Trigger a new pairing (POST /connect). Pauses nothing; polling continues. */
  connect: () => Promise<void>;
  /** Disconnect the current pairing (POST /disconnect). */
  disconnect: () => Promise<void>;
  /** Force an immediate status refresh. */
  refresh: () => Promise<void>;
}

/**
 * Live-polling hook for the relay's /status endpoint.
 * Polls every `pollIntervalMs` when state is connecting/qr-pending,
 * and every 30s otherwise (just to catch remote disconnects).
 */
export function useWhatsAppConnection({
  relayUrl,
  pollIntervalMs = 2000,
}: UseWhatsAppConnectionOptions): UseWhatsAppConnectionReturn {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const client = relayUrl ? relayClient(relayUrl) : null;

  const schedule = useCallback((ms: number, fn: () => void) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(fn, ms);
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!client) return;
    try {
      const s = await client.status();
      if (!mountedRef.current) return;
      setStatus(s);
      setError(null);
      // Faster polling while connecting; slower when idle.
      const isActive = s.state === 'connecting' || s.state === 'qr-pending';
      schedule(isActive ? pollIntervalMs : 30_000, fetchStatus);
    } catch (e) {
      if (!mountedRef.current) return;
      const err = e as RelayError;
      // 503 "No WhatsApp session" = not yet paired. This is the normal state
      // before the first /connect call; don't surface it as an error.
      if (err.status === 503) {
        setStatus({ ...DISCONNECTED_STATUS, timestamp: new Date().toISOString() });
        setError(null);
        schedule(30_000, fetchStatus);
        return;
      }
      const msg = err.message || 'Failed to contact relay';
      setError(msg);
      // Retry on error after 10s
      schedule(10_000, fetchStatus);
    }
  }, [client, pollIntervalMs, schedule]);

  useEffect(() => {
    mountedRef.current = true;
    if (!relayUrl) {
      setStatus(null);
      return;
    }
    setIsLoading(true);
    fetchStatus().finally(() => {
      if (mountedRef.current) setIsLoading(false);
    });
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayUrl]);

  const connect = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      await client.connect();
      // Force immediate refresh so user sees the QR asap.
      await fetchStatus();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [client, fetchStatus]);

  const disconnect = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      await client.disconnect();
      await fetchStatus();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [client, fetchStatus]);

  const refresh = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  return { status, isLoading, error, connect, disconnect, refresh };
}
