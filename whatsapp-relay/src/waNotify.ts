/**
 * WhatsApp connection-state notifier.
 *
 * Two side-effects on every connection-state change:
 *   1. POST to Supabase RPC `log_wa_state` so the event lands in
 *      runtime_events (the frontend reads this to render the live status
 *      banner). Returns the club's notify_topic so we know whether to push.
 *   2. If a notify_topic is set, POST to https://ntfy.sh/<topic> so the
 *      organiser gets a phone notification (free, no-account service).
 *
 * Both calls are best-effort and never throw — a notify failure must not
 * destabilise the WhatsApp session.
 */

export type WaConnectionState = 'connected' | 'disconnected' | 'reconnecting' | 'qr-pending';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NTFY_BASE = process.env.NTFY_BASE_URL ?? 'https://ntfy.sh';

interface LogWaStateResponse {
  ok: boolean;
  error?: string;
  club_id?: string;
  notify_topic?: string | null;
}

/** Throttle: don't push the same state for the same user within this window. */
const PUSH_DEBOUNCE_MS = 30_000;
const lastPush = new Map<string, { state: WaConnectionState; at: number }>();

function shouldPush(userId: string, state: WaConnectionState): boolean {
  const prev = lastPush.get(userId);
  if (!prev) return true;
  if (prev.state !== state) return true;
  if (Date.now() - prev.at > PUSH_DEBOUNCE_MS) return true;
  return false;
}

export async function notifyWaState(
  userId: string,
  state: WaConnectionState,
  phoneNumber: string | null,
): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.warn('[waNotify] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — skipping log_wa_state');
    return;
  }
  if (!shouldPush(userId, state)) return;
  lastPush.set(userId, { state, at: Date.now() });

  // 1. Log to Supabase + fetch notify_topic
  let resp: LogWaStateResponse | null = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/log_wa_state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Profile': 'soccer',
        'Content-Profile': 'soccer',
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_state: state,
        p_phone: phoneNumber,
      }),
    });
    if (!r.ok) {
      console.warn(`[waNotify] log_wa_state HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return;
    }
    resp = await r.json() as LogWaStateResponse;
  } catch (e) {
    console.warn(`[waNotify] log_wa_state network err: ${(e as Error).message}`);
    return;
  }

  if (!resp?.ok || !resp.notify_topic) return;

  // 2. Optional ntfy.sh push for phone notifications
  const topic = resp.notify_topic.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!topic) return;

  const message = formatPushMessage(state, phoneNumber);
  const priority = state === 'disconnected' ? '4' : '3'; // 4 = high (sound + vibrate)
  const tags = state === 'connected' ? 'white_check_mark' : state === 'disconnected' ? 'warning' : 'hourglass';
  const title = state === 'connected'
    ? '✅ WhatsApp connected'
    : state === 'disconnected'
      ? '⚠️ WhatsApp disconnected'
      : state === 'reconnecting'
        ? '🔄 WhatsApp reconnecting'
        : '📱 WhatsApp needs QR scan';

  try {
    await fetch(`${NTFY_BASE.replace(/\/$/, '')}/${topic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Title: title,
        Priority: priority,
        Tags: tags,
        // Click action takes the organiser straight to the Settings page
        Click: 'https://streamlined-soccer-cyan.vercel.app',
      },
      body: message,
    });
  } catch (e) {
    console.warn(`[waNotify] ntfy push failed: ${(e as Error).message}`);
  }
}

function formatPushMessage(state: WaConnectionState, phone: string | null): string {
  switch (state) {
    case 'connected':
      return phone
        ? `Bot is online and ready. Paired to ${phone}.`
        : 'Bot is online and ready.';
    case 'disconnected':
      return 'The bot is no longer paired with WhatsApp. Open the app and tap Connect to scan a fresh QR. Until then, no scheduled posts can go out.';
    case 'reconnecting':
      return 'Recovering the connection — should be back in a few seconds. No action needed.';
    case 'qr-pending':
      return 'A QR scan is required to pair. Open the app and tap Connect.';
    default:
      return `WhatsApp state: ${state}`;
  }
}
