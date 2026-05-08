import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export type WaState = 'connected' | 'disconnected' | 'reconnecting' | 'qr-pending' | 'unknown';

interface WaStatusPayload {
  state: WaState;
  phone: string | null;
  occurred_at: string | null;
  summary: string | null;
}

interface UseWhatsAppStatusReturn {
  status: WaStatusPayload;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 30_000;
const NOTIFICATION_KEY = 'soccer-wa-notify-permission';

export function useWhatsAppStatus(): UseWhatsAppStatusReturn {
  const { isAuthenticated, isPasswordRecovery } = useAuth();
  const canUse =
    isSupabaseConfigured() && supabase !== null && isAuthenticated && !isPasswordRecovery;

  const [status, setStatus] = useState<WaStatusPayload>({ state: 'unknown', phone: null, occurred_at: null, summary: null });
  const [isLoading, setIsLoading] = useState(true);
  const previousState = useRef<WaState>('unknown');

  const load = useCallback(async () => {
    if (!canUse || !supabase) {
      setIsLoading(false);
      return;
    }
    const { data, error } = await (supabase.rpc as unknown as (n: string, a?: unknown) => Promise<{ data: unknown; error: { message: string } | null }>)(
      'latest_wa_state'
    );
    if (error) {
      console.warn('useWhatsAppStatus: load error', error.message);
      setIsLoading(false);
      return;
    }
    const payload = (data as Partial<WaStatusPayload>) ?? null;
    const next: WaStatusPayload = {
      state: (payload?.state as WaState) ?? 'unknown',
      phone: payload?.phone ?? null,
      occurred_at: payload?.occurred_at ?? null,
      summary: payload?.summary ?? null,
    };

    // Native browser notification on transition into a bad state. We only
    // alert on the EDGE — going from anything → disconnected/qr-pending —
    // so the user isn't spammed by the polling loop.
    if (previousState.current !== 'unknown'
        && previousState.current !== next.state
        && (next.state === 'disconnected' || next.state === 'qr-pending')) {
      void fireBrowserNotification(next);
    }
    previousState.current = next.state;

    setStatus(next);
    setIsLoading(false);
  }, [canUse]);

  useEffect(() => {
    if (!isAuthenticated || isPasswordRecovery) {
      setStatus({ state: 'unknown', phone: null, occurred_at: null, summary: null });
      setIsLoading(false);
      return;
    }
    void load();
    const t = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [isAuthenticated, isPasswordRecovery, load]);

  return { status, isLoading, refresh: load };
}

async function fireBrowserNotification(s: WaStatusPayload): Promise<void> {
  if (typeof Notification === 'undefined') return;
  try {
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
      try { localStorage.setItem(NOTIFICATION_KEY, permission); } catch { /* ignore */ }
    }
    if (permission !== 'granted') return;

    const title = s.state === 'disconnected'
      ? '⚠️ WhatsApp disconnected'
      : s.state === 'qr-pending'
        ? '📱 WhatsApp needs QR scan'
        : 'WhatsApp status changed';
    const body = s.state === 'disconnected'
      ? 'The bot is no longer paired. Open the app and reconnect — until then, no scheduled posts go out.'
      : 'A QR scan is required to pair. Open the app and tap Connect.';
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'wa-status',  // collapses repeats
    });
  } catch (e) {
    console.warn('useWhatsAppStatus: notification failed', e);
  }
}
