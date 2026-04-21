/**
 * Thin client for the soccer-whatsapp-relay REST API.
 *
 * All requests carry the current Supabase user's JWT in Authorization: Bearer.
 * The relay validates the JWT and routes to the user's isolated Baileys session.
 */

import { supabase } from './supabase';

export interface ConnectionStatus {
  state: 'disconnected' | 'connecting' | 'qr-pending' | 'connected';
  phoneNumber: string | null;
  groupCount: number;
  qrDataUrl: string | null;
  health?: {
    lastHeartbeatAt?: number;
    reconnectAttempts?: number;
  };
  timestamp: string;
}

export interface Group {
  jid: string;
  name: string;
  participantCount?: number;
}

export interface RelayError extends Error {
  status?: number;
  code?: string;
}

async function getJwt(): Promise<string> {
  if (!supabase) throw Object.assign(new Error('Supabase not configured'), { code: 'NO_SUPABASE' });
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw Object.assign(new Error('Not signed in'), { code: 'NO_JWT' });
  return token;
}

async function request<T>(relayUrl: string, path: string, init?: RequestInit): Promise<T> {
  const jwt = await getJwt();
  const url = relayUrl.replace(/\/$/, '') + path;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        ...(init?.headers || {}),
      },
    });
  } catch (err) {
    const e: RelayError = new Error(`Network error calling relay: ${(err as Error).message}`);
    e.code = 'NETWORK';
    throw e;
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const err: RelayError = new Error(
      (body as { error?: string })?.error || `Relay returned ${res.status}`
    );
    err.status = res.status;
    throw err;
  }

  const wrapped = body as { success?: boolean; data?: T; error?: string };
  if (wrapped.success === false) {
    const err: RelayError = new Error(wrapped.error || 'Relay request failed');
    err.status = res.status;
    throw err;
  }
  return (wrapped.data ?? body) as T;
}

export function relayClient(relayUrl: string) {
  return {
    status: () => request<ConnectionStatus>(relayUrl, '/status?connection=user'),
    connect: () =>
      request<{ state: string; message?: string }>(relayUrl, '/connect?connection=user', {
        method: 'POST',
      }),
    disconnect: () =>
      request<{ disconnected: true }>(relayUrl, '/disconnect?connection=user', {
        method: 'POST',
      }),
    groups: () => request<Group[]>(relayUrl, '/groups?connection=user'),
    sendMessage: (to: string, text: string) =>
      request<{ sent: boolean; to: string }>(relayUrl, '/message?connection=user', {
        method: 'POST',
        body: JSON.stringify({ to, text }),
      }),
    sendPoll: (
      to: string,
      question: string,
      options: string[],
      selectableCount: number = 1
    ) =>
      request<{ sent: boolean; question: string; optionCount: number }>(
        relayUrl,
        '/poll?connection=user',
        {
          method: 'POST',
          body: JSON.stringify({ to, question, options, selectableCount }),
        }
      ),
    pollResults: (chatJid?: string) =>
      request<
        Array<{
          chatJid: string;
          messageId: string;
          question: string;
          options: Array<{ name: string; voters: string[]; voteCount: number }>;
          totalVotes: number;
        }>
      >(relayUrl, `/polls?connection=user${chatJid ? `&chatJid=${encodeURIComponent(chatJid)}` : ''}`),
    /** Register the current Supabase session with the relay. Some relay modes
     *  use this to bind userId for scheduled sends. Safe to call repeatedly. */
    auth: async () => {
      if (!supabase) throw new Error('Supabase not configured');
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      if (!s) throw new Error('Not signed in');
      return request<{ authenticated: boolean }>(relayUrl, '/auth', {
        method: 'POST',
        body: JSON.stringify({
          accessToken: s.access_token,
          refreshToken: s.refresh_token,
          userId: s.user.id,
        }),
      });
    },
  };
}

export type RelayClient = ReturnType<typeof relayClient>;
