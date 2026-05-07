import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = Deno.env.get('APP_URL') ?? 'https://streamlined-soccer-cyan.vercel.app';
// Multi-tenant: one shared Railway relay across all clubs (the relay itself is
// multi-tenant, keyed by user_id). Falls back to the original prod URL if not set.
const RELAY_URL = Deno.env.get('RELAY_URL') ?? 'https://soccer-whatsapp-relay-production.up.railway.app';

// Per-club context passed through every fire helper. Replaces the old
// "cfg" (organiser_config) singleton.
interface Club {
  id: string;
  name: string;
  timezone: string;
  bot_persona: string;
  enabled: boolean;
}

const DAY_TO_NUM: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

function localComponents(date: Date, timezone: string) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'long',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return { dow: DAY_TO_NUM[map.weekday] ?? -1, hh: parseInt(map.hour, 10), mm: parseInt(map.minute, 10), ymd: `${map.year}-${map.month}-${map.day}` };
  } catch { return { dow: -1, hh: -1, mm: -1, ymd: 'invalid' }; }
}
function timeToMinutes(t: string | null | undefined): number {
  if (!t) return -1;
  const [h, m] = t.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}
function dowDaysBefore(dow: number, daysBefore: number): number { return ((dow - daysBefore) % 7 + 7) % 7; }
function nextKickoffDate(today_ymd: string, today_dow: number, kickoff_dow: number): string {
  const daysAhead = ((kickoff_dow - today_dow) % 7 + 7) % 7;
  const [y, m, d] = today_ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + daysAhead);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function renderCallOutQuestion(s: SessionSchedule): string {
  const tpl = s.callout_poll_question || '⚽ Football {day} at {time}{pitch_suffix}. Need {target}. Are you in?';
  const dayName = Object.keys(DAY_TO_NUM).find(k => DAY_TO_NUM[k] === s.kickoff_dow) ?? '?';
  const time = s.kickoff_time?.substring(0, 5) ?? '';
  const pitch = s.pitch_label ?? '';
  const subs: Record<string, string> = { '{day}': dayName, '{time}': time, '{pitch}': pitch, '{pitch_suffix}': pitch ? ` — ${pitch}` : '', '{target}': String(s.target_players) };
  return tpl.replace(/\{(day|time|pitch|pitch_suffix|target)\}/g, m => subs[m] ?? m);
}
function renderConfirmationMessage(s: SessionSchedule, token: string): string {
  const dayName = Object.keys(DAY_TO_NUM).find(k => DAY_TO_NUM[k] === s.kickoff_dow) ?? '?';
  const time = s.kickoff_time?.substring(0, 5) ?? '';
  const pitch = s.pitch_label ? ` — ${s.pitch_label}` : '';
  const link = `${APP_URL}/confirm/${token}`;
  return `⚽ *${dayName} football at ${time}${pitch}* — still on?\n\nIf nothing changes, the call-out goes out as scheduled.\n\n_Need to skip this week? Tap here:_\n${link}`;
}

function renderNudge(s: SessionSchedule, signedIn: number, sameDay: boolean): string {
  const dayName = Object.keys(DAY_TO_NUM).find(k => DAY_TO_NUM[k] === s.kickoff_dow) ?? '?';
  const time = s.kickoff_time?.substring(0, 5) ?? '';
  const pitch = s.pitch_label ? ` — ${s.pitch_label}` : '';
  const need = Math.max(0, s.min_players - signedIn);
  const when = sameDay ? `tonight at ${time}` : `${dayName} at ${time}`;
  return `🌅 *Football ${when}${pitch}*\n\nWe've got *${signedIn}/${s.target_players}* so far — still need at least *${need}* more.\n\nIf you're in, vote on the poll above 👆`;
}

async function mintUserJwt(userId: string, jwtSecret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: `${SUPABASE_URL}/auth/v1`, aud: 'authenticated', role: 'authenticated', sub: userId, iat: now, exp: now + 300 };
  const b64url = (s: string | Uint8Array) => {
    const bytes = typeof s === 'string' ? new TextEncoder().encode(s) : s;
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(jwtSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

function categoriseOption(label: string | undefined | null): 'in' | 'out' | 'maybe' | 'unknown' {
  if (!label || typeof label !== 'string') return 'unknown';
  const cleaned = label.toLowerCase().replace(/[^a-z\s]/g, ' ').trim();
  const tokens = cleaned.split(/\s+/);
  const has = (set: string[]) => tokens.some(t => set.includes(t));
  if (has(['in', 'yes', 'y', 'coming', 'playing'])) return 'in';
  if (has(['out', 'no', 'n', 'cant', 'cannot', 'skip', 'pass'])) return 'out';
  if (has(['maybe', 'perhaps', 'tentative', 'unsure'])) return 'maybe';
  return 'unknown';
}

function generateToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface SessionSchedule {
  id: string; name: string; enabled: boolean;
  kickoff_dow: number; kickoff_time: string; pitch_label: string | null;
  weekly_post_dow: number; weekly_post_time: string;
  confirmation_enabled: boolean; confirmation_days_before: number; confirmation_time: string | null;
  nudge_enabled: boolean; nudge_days_before: number; nudge_time: string;
  team_gen_offset_hours: number; team_gen_require_approval: boolean;
  team_force_post_minutes_before_kickoff: number;
  mom_enabled: boolean; match_duration_minutes: number; mom_delay_minutes: number; mom_results_post_minutes: number;
  mom_method: 'auto' | 'whatsapp_poll' | 'web_link' | 'organiser_dm';
  target_players: number; min_players: number;
  callout_poll_question: string; callout_poll_options: string[];
  whatsapp_group_jid: string | null; whatsapp_group_name: string | null;
}

interface PlayerRow {
  id: string; name: string; status: string;
  preferred_position: string;
  overall_score: number; is_linchpin: boolean;
  preferred_team: string; // 'any' | 'black' | 'white'
  whatsapp_jid: string | null;
}

interface LineupPosition {
  player_id: string; name: string; overall_score: number;
  preferred_position: string; is_linchpin: boolean;
  team: 'black' | 'white'; locked: boolean;
}

interface RelayPoll { chatJid: string; messageId: string; question: string; options: string[]; results: Array<{ name: string; voters: string[] }>; totalVotes: number; createdAt?: number; }

async function fetchSenderSelfJid(jwt: string): Promise<string | null> {
  try {
    const resp = await fetch(`${RELAY_URL.replace(/\/$/, '')}/status?connection=user`, { headers: { 'Authorization': `Bearer ${jwt}` } });
    if (!resp.ok) return null;
    const body = await resp.json().catch(() => null);
    const phone: string | undefined = body?.data?.phoneNumber ?? body?.phoneNumber;
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : null;
  } catch { return null; }
}

async function getOrCreateWeeklySession(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clubId: string, scheduleId: string, matchDate: string, kickoffAt: string,
  // deno-lint-ignore no-explicit-any
  log: (row: any) => Promise<unknown>,
): Promise<{ id: string; state: string; confirmation_token: string | null } | null> {
  const { data: ins, error: insErr } = await supabase
    .from('weekly_sessions')
    .insert({ club_id: clubId, session_schedule_id: scheduleId, match_date: matchDate, kickoff_at: kickoffAt, state: 'pending' })
    .select('id, state, confirmation_token').single();
  if (!insErr && ins) return ins;
  if (insErr && insErr.code === '23505') {
    const { data: existing, error: selErr } = await supabase
      .from('weekly_sessions').select('id, state, confirmation_token')
      .eq('session_schedule_id', scheduleId).eq('match_date', matchDate).single();
    if (selErr) { await log({ kind: 'error', summary: `weekly_sessions select after conflict: ${selErr.message}`, club_id: clubId }); return null; }
    return existing;
  }
  await log({ kind: 'error', summary: `weekly_sessions insert: ${insErr?.message ?? 'unknown'}`, club_id: clubId });
  return null;
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'soccer' as const } });
  // Multi-tenant log: club_id is optional (system-wide events leave it null).
  const log = (row: { kind: string; summary: string; details?: unknown; session_schedule_id?: string; weekly_session_id?: string; club_id?: string }) =>
    supabase.from('runtime_events').insert({
      kind: row.kind, summary: row.summary,
      details: row.details ? JSON.parse(JSON.stringify(row.details)) : null,
      session_schedule_id: row.session_schedule_id ?? null,
      weekly_session_id: row.weekly_session_id ?? null,
      club_id: row.club_id ?? null,
    });

  try {
    const now = new Date();

    // Outer loop: enabled clubs. (Multi-tenant change from singleton organiser_config.)
    const { data: clubs, error: clubsErr } = await supabase
      .from('clubs')
      .select('id, name, timezone, bot_persona, enabled')
      .eq('enabled', true);
    if (clubsErr) { await log({ kind: 'error', summary: `clubs load: ${clubsErr.message}` }); return new Response('clubs error', { status: 500 }); }
    if (!clubs || clubs.length === 0) {
      await log({ kind: 'tick', summary: 'No enabled clubs — skipping' });
      return new Response(JSON.stringify({ status: 'no_clubs' }), { headers: { 'Content-Type': 'application/json' } });
    }

    // JWT secret is per-project, fetch once for all clubs.
    let jwtSecret: string | null = null;
    const ensureJwtSecret = async (): Promise<string | null> => {
      if (jwtSecret) return jwtSecret;
      const { data, error } = await supabase.rpc('get_jwt_secret');
      if (error || typeof data !== 'string' || !data) { await log({ kind: 'error', summary: `jwt_secret: ${error?.message ?? 'empty'}` }); return null; }
      jwtSecret = data;
      return jwtSecret;
    };

    const allDecisions: Array<Record<string, unknown>> = [];
    let totalRefreshed = 0;
    let totalPosted = 0;
    const tickSummaries: string[] = [];

    for (const club of clubs as Club[]) {
      // Pick sender for this club: first owner/organiser member.
      const { data: senders } = await supabase
        .from('club_members')
        .select('user_id, role')
        .eq('club_id', club.id)
        .in('role', ['owner', 'organiser'])
        .order('role', { ascending: true })  // 'organiser' < 'owner' alphabetically; doesn't matter, just deterministic
        .limit(1);
      const senderUserId: string | null = senders?.[0]?.user_id ?? null;

      // Per-club JWT + JID caches (must NOT leak across clubs — would send user A's
      // messages from user B's WhatsApp).
      let cachedSenderJwt: string | null = null;
      let cachedSelfJid: string | null = null;
      const ensureSenderJwt = async (): Promise<string | null> => {
        if (cachedSenderJwt) return cachedSenderJwt;
        if (!senderUserId) return null;
        const secret = await ensureJwtSecret();
        if (!secret) return null;
        try { cachedSenderJwt = await mintUserJwt(senderUserId, secret); return cachedSenderJwt; }
        catch (e) { await log({ kind: 'error', summary: `mint JWT: ${(e as Error).message}`, club_id: club.id }); return null; }
      };
      const ensureSelfJid = async (): Promise<string | null> => {
        if (cachedSelfJid) return cachedSelfJid;
        const jwt = await ensureSenderJwt(); if (!jwt) return null;
        cachedSelfJid = await fetchSenderSelfJid(jwt);
        return cachedSelfJid;
      };

      const tz: string = club.timezone || 'UTC';
      const local = localComponents(now, tz);
      const nowMinutes = local.hh * 60 + local.mm;

      // Schedules belonging to this club only.
      const { data: schedules } = await supabase
        .from('session_schedules').select('*')
        .eq('club_id', club.id)
        .eq('enabled', true);

      const decisions: Array<Record<string, unknown>> = [];
      for (const s of (schedules ?? []) as SessionSchedule[]) {
        type Decision = { kind: string; target: 'group' | 'self_dm'; reason: string };
        const fires: Decision[] = [];
        if (s.confirmation_enabled && s.confirmation_time) {
          const cDow = dowDaysBefore(s.weekly_post_dow, s.confirmation_days_before);
          if (local.dow === cDow && nowMinutes === timeToMinutes(s.confirmation_time)) fires.push({ kind: 'confirmation_dm', target: 'self_dm', reason: `${s.confirmation_days_before}d before call-out at ${s.confirmation_time}` });
        }
        if (local.dow === s.weekly_post_dow && nowMinutes === timeToMinutes(s.weekly_post_time)) fires.push({ kind: 'callout_poll', target: 'group', reason: `weekly_post at ${s.weekly_post_time}` });
        if (s.nudge_enabled && s.nudge_time) {
          const nDow = dowDaysBefore(s.kickoff_dow, s.nudge_days_before);
          if (local.dow === nDow && nowMinutes === timeToMinutes(s.nudge_time)) fires.push({ kind: 'nudge', target: 'group', reason: `${s.nudge_days_before === 0 ? 'same day' : `${s.nudge_days_before}d before`} at ${s.nudge_time}` });
        }
        const tMin = timeToMinutes(s.kickoff_time) - Math.round(Number(s.team_gen_offset_hours) * 60);
        if (local.dow === s.kickoff_dow && nowMinutes === tMin) fires.push({ kind: 'team_gen', target: s.team_gen_require_approval ? 'self_dm' : 'group', reason: `${s.team_gen_offset_hours}h before kickoff` });
        const forceMin = timeToMinutes(s.kickoff_time) - Number(s.team_force_post_minutes_before_kickoff ?? 30);
        if (local.dow === s.kickoff_dow && nowMinutes === forceMin) fires.push({ kind: 'team_force_post', target: 'group', reason: `${s.team_force_post_minutes_before_kickoff}min before kickoff — force-post if pending` });
        if (s.mom_enabled) {
          const kMin = timeToMinutes(s.kickoff_time);
          const mMin = kMin + Number(s.match_duration_minutes) + Number(s.mom_delay_minutes);
          if (local.dow === s.kickoff_dow && nowMinutes === mMin) fires.push({ kind: 'mom_poll', target: 'group', reason: `MoM time` });
          const rMin = mMin + Number(s.mom_results_post_minutes);
          if (local.dow === s.kickoff_dow && nowMinutes === rMin) fires.push({ kind: 'mom_results', target: 'group', reason: `voting closed` });
        }
        for (const d of fires) {
          decisions.push({ club_id: club.id, club: club.name, schedule_id: s.id, schedule: s.name, ...d });
          if (d.kind === 'callout_poll') await fireCalloutPoll(supabase, log, club, s, local, ensureSenderJwt);
          else if (d.kind === 'confirmation_dm') await fireConfirmationDm(supabase, log, club, s, local, ensureSenderJwt, ensureSelfJid);
          else if (d.kind === 'nudge') await fireNudge(supabase, log, club, s, local, ensureSenderJwt);
          else if (d.kind === 'team_gen') await fireTeamGen(supabase, log, club, s, local, ensureSenderJwt, ensureSelfJid);
          else if (d.kind === 'team_force_post') await fireTeamForcePost(supabase, log, club, s, local, ensureSenderJwt);
          else if (d.kind === 'mom_poll') await fireMomPoll(supabase, log, club, s, local, ensureSenderJwt, ensureSelfJid);
          else if (d.kind === 'mom_results') await fireMomResults(supabase, log, club, s, local, ensureSenderJwt);
          else await log({ session_schedule_id: s.id, club_id: club.id, kind: 'decided', summary: `${s.name}: ${d.kind} → ${d.target} (dry-run, ${d.reason})`, details: { decision: d, local } });
        }
      }

      let refreshed = 0;
      try { refreshed += await refreshActiveSignups(supabase, log, club, ensureSenderJwt, schedules ?? []); }
      catch (e) { await log({ kind: 'error', summary: `refresh signups crashed: ${(e as Error).message}`, details: { stack: (e as Error).stack?.substring(0, 500) }, club_id: club.id }); }

      let posted = 0;
      try { posted += await postConfirmedLineups(supabase, log, club, ensureSenderJwt); }
      catch (e) { await log({ kind: 'error', summary: `post confirmed lineups crashed: ${(e as Error).message}`, details: { stack: (e as Error).stack?.substring(0, 500) }, club_id: club.id }); }

      allDecisions.push(...decisions);
      totalRefreshed += refreshed;
      totalPosted += posted;

      const extras = [refreshed ? `refreshed ${refreshed}` : '', posted ? `posted ${posted}` : ''].filter(Boolean).join(', ');
      const clubSummary = decisions.length === 0
        ? `${club.name}: ${local.ymd} ${String(local.hh).padStart(2,'0')}:${String(local.mm).padStart(2,'0')} ${tz} — no fires${extras ? `, ${extras}` : ''}`
        : `${club.name}: ${local.ymd} ${String(local.hh).padStart(2,'0')}:${String(local.mm).padStart(2,'0')} ${tz} — ${decisions.length} fire(s)${extras ? `, ${extras}` : ''}`;
      tickSummaries.push(clubSummary);
      await log({ kind: 'tick', summary: clubSummary, club_id: club.id, details: { local, tz, decisions, refreshed, posted } });
    }

    return new Response(JSON.stringify({ ok: true, clubs: clubs.length, decisions: allDecisions, refreshed: totalRefreshed, posted: totalPosted, summaries: tickSummaries }, null, 2), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const err = e as Error;
    await log({ kind: 'error', summary: `runtime-tick crashed: ${err.message}`, details: { stack: err.stack?.substring(0, 1000) } }).catch(() => undefined);
    return new Response(`Crashed: ${err.message}`, { status: 500 });
  }
});

// ── Confirmation DM (text + skip-link) ───────────────────────────────────
async function fireConfirmationDm(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  log: (row: any) => Promise<unknown>,
  club: Club,
  s: SessionSchedule,
  local: { dow: number; hh: number; mm: number; ymd: string },
  ensureSenderJwt: () => Promise<string | null>,
  ensureSelfJid: () => Promise<string | null>,
): Promise<void> {
  const matchDate = nextKickoffDate(local.ymd, local.dow, s.kickoff_dow);
  const kickoffAt = `${matchDate}T${s.kickoff_time.padEnd(8, ':00').substring(0, 8)}Z`;
  const ws = await getOrCreateWeeklySession(supabase, club.id, s.id, matchDate, kickoffAt, log);
  if (!ws) return;
  const skipStates = ['confirmation_sent', 'confirmation_declined', 'callout_sent', 'morning_nudge_sent', 'followup_sent', 'teams_pending_approval', 'teams_posted', 'mom_sent', 'mom_closed', 'cancelled'];
  if (skipStates.includes(ws.state)) {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: confirmation skipped — weekly_session in state '${ws.state}'` });
    return;
  }
  const jwt = await ensureSenderJwt();
  if (!jwt) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `no JWT` }); return; }
  const selfJid = await ensureSelfJid();
  if (!selfJid) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `no self JID` }); return; }

  const token = ws.confirmation_token ?? generateToken();
  if (!ws.confirmation_token) {
    await supabase.from('weekly_sessions').update({ confirmation_token: token }).eq('id', ws.id);
  }
  const text = renderConfirmationMessage(s, token);
  const url = RELAY_URL.replace(/\/$/, '') + '/message?connection=user';
  let resp: Response;
  try { resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }, body: JSON.stringify({ to: selfJid, text }) }); }
  catch (e) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `relay net err: ${(e as Error).message}` }); return; }
  const respText = await resp.text();
  if (!resp.ok) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `relay ${resp.status} on /message`, details: { body: respText.substring(0, 300) } }); return; }
  await supabase.from('weekly_sessions').update({ state: 'confirmation_sent', confirmation_chat_jid: selfJid }).eq('id', ws.id);
  await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'sent', summary: `${s.name}: confirmation DM (text + skip-link) sent for ${matchDate}`, details: { self_jid: selfJid, match_date: matchDate, token, text: text.substring(0, 200) } });
}

async function refreshActiveSignups(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  log: (row: any) => Promise<unknown>,
  club: Club,
  ensureSenderJwt: () => Promise<string | null>,
  schedules: SessionSchedule[],
): Promise<number> {
  const { data: actives, error } = await supabase
    .from('weekly_sessions')
    .select('id, session_schedule_id, callout_chat_jid, signups_in, signups_out, signups_maybe, signup_voter_jids, kickoff_at')
    .eq('club_id', club.id)
    .in('state', ['callout_sent', 'morning_nudge_sent', 'followup_sent', 'teams_pending_approval'])
    .gt('kickoff_at', new Date().toISOString())
    .not('callout_chat_jid', 'is', null);
  if (error) { await log({ kind: 'error', summary: `refresh load: ${error.message}`, club_id: club.id }); return 0; }
  if (!actives || actives.length === 0) return 0;
  const jwt = await ensureSenderJwt();
  if (!jwt) return 0;

  // Pull this club's known JIDs (players in club_players ∩ players.whatsapp_jid IS NOT NULL).
  const { data: clubPlayerRows } = await supabase
    .from('club_players').select('player_id').eq('club_id', club.id);
  const clubPlayerIds: string[] = (clubPlayerRows ?? []).map((r: { player_id: string }) => r.player_id);
  const knownJids = new Set<string>();
  if (clubPlayerIds.length > 0) {
    const { data: knownPlayers } = await supabase
      .from('players').select('whatsapp_jid').in('id', clubPlayerIds).not('whatsapp_jid', 'is', null);
    for (const p of (knownPlayers ?? []) as Array<{ whatsapp_jid: string }>) knownJids.add(p.whatsapp_jid);
  }

  const scheduleById = new Map<string, SessionSchedule>();
  for (const s of schedules) scheduleById.set(s.id, s);
  const byChat: Record<string, typeof actives> = {};
  for (const a of actives) { if (!byChat[a.callout_chat_jid]) byChat[a.callout_chat_jid] = []; byChat[a.callout_chat_jid].push(a); }
  let refreshed = 0;
  for (const chatJid of Object.keys(byChat)) {
    const sessions = byChat[chatJid];
    const url = `${RELAY_URL.replace(/\/$/, '')}/polls?connection=user&chatJid=${encodeURIComponent(chatJid)}`;
    let resp: Response;
    try { resp = await fetch(url, { headers: { 'Authorization': `Bearer ${jwt}` } }); }
    catch (e) { await log({ kind: 'error', summary: `polls fetch network: ${(e as Error).message}` }); continue; }
    if (!resp.ok) { const body = (await resp.text()).substring(0, 300); await log({ kind: 'error', summary: `polls fetch ${resp.status}`, details: { url, body } }); continue; }
    // deno-lint-ignore no-explicit-any
    const body: any = await resp.json().catch(() => null);
    const polls: RelayPoll[] = Array.isArray(body) ? body : (body?.data ?? []);
    for (const ws of sessions) {
      const sched = scheduleById.get(ws.session_schedule_id);
      const expectedQuestion: string = sched ? renderCallOutQuestion(sched) : '';
      const matches = polls.filter(p => p.question === expectedQuestion);
      const poll = (matches.length > 0 ? matches : polls).slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
      if (!poll) continue;
      let inCount = 0, outCount = 0, maybeCount = 0;
      const inVoterJids: string[] = [];
      for (const r of (poll.results ?? [])) {
        const cat = categoriseOption(r.name);
        const voters = Array.isArray(r.voters) ? r.voters : [];
        if (cat === 'in') { inCount += voters.length; inVoterJids.push(...voters); }
        else if (cat === 'out') outCount += voters.length;
        else if (cat === 'maybe') maybeCount += voters.length;
      }
      // Dedup (a single voter can only be in one bucket but be defensive)
      const uniqueInJids = Array.from(new Set(inVoterJids));
      const unmappedJids = uniqueInJids.filter(jid => !knownJids.has(jid));

      const oldJids: string[] = Array.isArray(ws.signup_voter_jids) ? ws.signup_voter_jids : [];
      const jidsChanged = oldJids.length !== uniqueInJids.length || oldJids.some(j => !uniqueInJids.includes(j));
      const countsChanged = inCount !== ws.signups_in || outCount !== ws.signups_out || maybeCount !== ws.signups_maybe;
      if (!countsChanged && !jidsChanged) continue;

      await supabase.from('weekly_sessions').update({
        signups_in: inCount,
        signups_out: outCount,
        signups_maybe: maybeCount,
        signup_voter_jids: uniqueInJids,
        unmapped_voter_jids: unmappedJids,
      }).eq('id', ws.id);
      await log({ weekly_session_id: ws.id, session_schedule_id: ws.session_schedule_id, kind: 'counts_updated',
        summary: `Signups: ${inCount} in, ${outCount} out, ${maybeCount} maybe (was ${ws.signups_in}/${ws.signups_out}/${ws.signups_maybe})${unmappedJids.length ? ` · ${unmappedJids.length} unmapped` : ''}`,
        details: { in: inCount, out: outCount, maybe: maybeCount, voter_jids: uniqueInJids, unmapped_jids: unmappedJids, message_id: poll.messageId, total: poll.totalVotes } });
      refreshed++;
    }
  }
  return refreshed;
}

async function fireCalloutPoll(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  log: (row: any) => Promise<unknown>,
  club: Club,
  s: SessionSchedule,
  local: { dow: number; hh: number; mm: number; ymd: string },
  ensureSenderJwt: () => Promise<string | null>,
): Promise<void> {
  const matchDate = nextKickoffDate(local.ymd, local.dow, s.kickoff_dow);
  const kickoffAt = `${matchDate}T${s.kickoff_time.padEnd(8, ':00').substring(0, 8)}Z`;
  const ws = await getOrCreateWeeklySession(supabase, club.id, s.id, matchDate, kickoffAt, log);
  if (!ws) return;
  if (ws.state === 'confirmation_declined' || ws.state === 'cancelled') {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: call-out skipped — state '${ws.state}'` });
    return;
  }
  if (['callout_sent','followup_sent','morning_nudge_sent','teams_pending_approval','teams_posted','mom_sent','mom_closed'].includes(ws.state)) {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: callout already past in state '${ws.state}'` });
    return;
  }
  if (!s.whatsapp_group_jid) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `no whatsapp_group_jid` }); return; }
  const jwt = await ensureSenderJwt();
  if (!jwt) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `no JWT` }); return; }
  const question = renderCallOutQuestion(s);
  const options = (s.callout_poll_options && s.callout_poll_options.length >= 2) ? s.callout_poll_options : ['In ✅', 'Out ❌', 'Maybe 🤔'];
  const url = RELAY_URL.replace(/\/$/, '') + '/poll?connection=user';
  let resp: Response;
  try { resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }, body: JSON.stringify({ to: s.whatsapp_group_jid, question, options, selectableCount: 1 }) }); }
  catch (e) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `relay net err: ${(e as Error).message}` }); return; }
  const respText = await resp.text();
  if (!resp.ok) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `relay ${resp.status} on /poll`, details: { body: respText.substring(0, 300) } }); return; }
  await supabase.from('weekly_sessions').update({ state: 'callout_sent', callout_chat_jid: s.whatsapp_group_jid }).eq('id', ws.id);
  await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'sent', summary: `${s.name}: callout poll sent to ${s.whatsapp_group_name ?? s.whatsapp_group_jid} for ${matchDate}`, details: { question, options, group_jid: s.whatsapp_group_jid, match_date: matchDate, response: respText.substring(0, 300) } });
}

// ── Nudge: group post N days before kickoff if signups < min ────────────────
async function fireNudge(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  log: (row: any) => Promise<unknown>,
  club: Club,
  s: SessionSchedule,
  local: { dow: number; hh: number; mm: number; ymd: string },
  ensureSenderJwt: () => Promise<string | null>,
): Promise<void> {
  const matchDate = nextKickoffDate(local.ymd, local.dow, s.kickoff_dow);
  const { data: ws, error: wsErr } = await supabase
    .from('weekly_sessions')
    .select('id, state, signups_in, morning_nudge_message_id')
    .eq('session_schedule_id', s.id)
    .eq('match_date', matchDate)
    .single();
  if (wsErr || !ws) {
    await log({ session_schedule_id: s.id, kind: 'skipped', summary: `${s.name}: nudge skipped — no weekly_session for ${matchDate}`, details: { match_date: matchDate, error: wsErr?.message } });
    return;
  }
  if (ws.state === 'confirmation_declined' || ws.state === 'cancelled') {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: nudge skipped — state '${ws.state}'` });
    return;
  }
  // Only nudge after the call-out has gone out — otherwise "vote on the poll above" is meaningless.
  const liveStates = ['callout_sent', 'morning_nudge_sent', 'followup_sent'];
  if (!liveStates.includes(ws.state)) {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: nudge skipped — call-out not sent yet (state '${ws.state}')` });
    return;
  }
  if (ws.morning_nudge_message_id) {
    // Re-using this column as a "nudge already sent this week" sentinel
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: nudge already sent this week` });
    return;
  }
  if (ws.signups_in >= s.min_players) {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: nudge skipped — already at ${ws.signups_in}/${s.min_players} min` });
    return;
  }
  if (!s.whatsapp_group_jid) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `no whatsapp_group_jid` }); return; }
  const jwt = await ensureSenderJwt();
  if (!jwt) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `no JWT` }); return; }

  const sameDay = s.nudge_days_before === 0;
  const text = renderNudge(s, ws.signups_in, sameDay);
  const url = RELAY_URL.replace(/\/$/, '') + '/message?connection=user';
  let resp: Response;
  try { resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }, body: JSON.stringify({ to: s.whatsapp_group_jid, text }) }); }
  catch (e) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `relay net err: ${(e as Error).message}` }); return; }
  const respText = await resp.text();
  if (!resp.ok) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `relay ${resp.status} on /message`, details: { body: respText.substring(0, 300) } }); return; }

  // Don't change main state — keep callout_sent so vote refresh keeps working.
  // Use morning_nudge_message_id column as the "sent this week" sentinel.
  await supabase.from('weekly_sessions').update({ morning_nudge_message_id: 'sent' }).eq('id', ws.id);
  await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'sent', summary: `${s.name}: nudge sent (${ws.signups_in}/${s.target_players}, min ${s.min_players})`, details: { signups_in: ws.signups_in, target: s.target_players, min: s.min_players, same_day: sameDay, text: text.substring(0, 200) } });
}

// ── Team Balancer ──────────────────────────────────────────────────────────
// Two-team split honouring preferred_team + linchpins, then snake-draft by
// overall_score, then a swap-pass to minimise the score difference.

function balanceTeams(players: PlayerRow[]): { black: PlayerRow[]; white: PlayerRow[] } {
  const black: PlayerRow[] = [];
  const white: PlayerRow[] = [];
  const sumScore = (xs: PlayerRow[]) => xs.reduce((s, p) => s + (p.overall_score ?? 0), 0);

  // 1. Honour preferred_team — pin those first
  const remaining: PlayerRow[] = [];
  for (const p of players) {
    if (p.preferred_team === 'black') black.push(p);
    else if (p.preferred_team === 'white') white.push(p);
    else remaining.push(p);
  }

  // 2. Linchpins next: split them so neither team gets all of them.
  //    Sort by score desc, alternate placements (best linchpin → smaller team).
  const linchpins = remaining.filter(p => p.is_linchpin).sort((a, b) => b.overall_score - a.overall_score);
  const nonLinch = remaining.filter(p => !p.is_linchpin);
  for (const p of linchpins) {
    const target = sumScore(black) <= sumScore(white) ? black : white;
    target.push(p);
  }

  // 3. Snake-draft the rest by score desc — assign to the lower-total team each pick
  nonLinch.sort((a, b) => b.overall_score - a.overall_score);
  for (const p of nonLinch) {
    if (black.length === white.length) {
      const target = sumScore(black) <= sumScore(white) ? black : white;
      target.push(p);
    } else {
      const target = black.length < white.length ? black : white;
      target.push(p);
    }
  }

  // 4. Swap-improvement pass: try every cross-team pair, take the swap that
  //    reduces |diff| the most (without breaking team-size parity). Repeat until
  //    no improvement. Bounded — n is small (<=20) so n^2 per pass is fine.
  let improved = true;
  let safety = 50;
  while (improved && safety-- > 0) {
    improved = false;
    let bestSwap: { bi: number; wi: number; newDiff: number } | null = null;
    const curDiff = Math.abs(sumScore(black) - sumScore(white));
    for (let bi = 0; bi < black.length; bi++) {
      const bp = black[bi];
      if (bp.preferred_team === 'black') continue; // pinned
      for (let wi = 0; wi < white.length; wi++) {
        const wp = white[wi];
        if (wp.preferred_team === 'white') continue;
        const newBlackSum = sumScore(black) - bp.overall_score + wp.overall_score;
        const newWhiteSum = sumScore(white) - wp.overall_score + bp.overall_score;
        const newDiff = Math.abs(newBlackSum - newWhiteSum);
        if (newDiff < curDiff && (!bestSwap || newDiff < bestSwap.newDiff)) {
          bestSwap = { bi, wi, newDiff };
        }
      }
    }
    if (bestSwap) {
      const { bi, wi } = bestSwap;
      [black[bi], white[wi]] = [white[wi], black[bi]];
      improved = true;
    }
  }

  return { black, white };
}

/** Lean one-line caption that appears below the pitch image in WhatsApp. */
function renderTeamsCaption(s: SessionSchedule): string {
  const dayName = Object.keys(DAY_TO_NUM).find(k => DAY_TO_NUM[k] === s.kickoff_dow) ?? '?';
  const time = s.kickoff_time?.substring(0, 5) ?? '';
  const pitch = s.pitch_label ? ` · ${s.pitch_label}` : '';
  return `🏟 *${dayName} ${time}*${pitch}\n\nLate dropouts? Let me know.`;
}

function renderTeamAnnouncement(s: SessionSchedule, lineup: LineupPosition[]): string {
  const dayName = Object.keys(DAY_TO_NUM).find(k => DAY_TO_NUM[k] === s.kickoff_dow) ?? '?';
  const time = s.kickoff_time?.substring(0, 5) ?? '';
  const pitch = s.pitch_label ? ` — ${s.pitch_label}` : '';
  const sortByName = (a: LineupPosition, b: LineupPosition) => a.name.localeCompare(b.name);
  const black = lineup.filter(p => p.team === 'black').sort(sortByName);
  const white = lineup.filter(p => p.team === 'white').sort(sortByName);
  const list = (xs: LineupPosition[]) =>
    xs.map(p => `• ${p.name}${p.is_linchpin ? ' ★' : ''}`).join('\n');
  return [
    `🏟 *Teams for ${dayName} ${time}${pitch}*`,
    '',
    `*⚫ Black tops* (${black.length})`,
    list(black),
    '',
    `*⚪ White tops* (${white.length})`,
    list(white),
    '',
    `Late dropouts? Let me know.`,
  ].join('\n');
}

function renderApprovalDm(s: SessionSchedule, token: string, lineup: LineupPosition[]): string {
  const dayName = Object.keys(DAY_TO_NUM).find(k => DAY_TO_NUM[k] === s.kickoff_dow) ?? '?';
  const time = s.kickoff_time?.substring(0, 5) ?? '';
  const pitch = s.pitch_label ? ` — ${s.pitch_label}` : '';
  const link = `${APP_URL}/approve/${token}`;
  const blackN = lineup.filter(p => p.team === 'black').length;
  const whiteN = lineup.filter(p => p.team === 'white').length;
  const fallbackMin = s.team_force_post_minutes_before_kickoff ?? 30;
  return [
    `🏟 *Teams ready for ${dayName} ${time}${pitch}*`,
    '',
    `I've auto-balanced ${lineup.length} players: ⚫ ${blackN} vs ⚪ ${whiteN}.`,
    '',
    `👉 *Preview, edit, or confirm:*`,
    link,
    '',
    `_If I don't hear from you, I'll post these as-is ${fallbackMin} min before kickoff._`,
  ].join('\n');
}

// ── Team Generation ───────────────────────────────────────────────────────
// At T-team_gen_offset_hours: take the voters who said "in", map to player
// records, balance teams, save lineup, and either DM the organiser an approval
// link or post the teams to the group directly (per team_gen_require_approval).
async function fireTeamGen(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  log: (row: any) => Promise<unknown>,
  club: Club,
  s: SessionSchedule,
  local: { dow: number; hh: number; mm: number; ymd: string },
  ensureSenderJwt: () => Promise<string | null>,
  ensureSelfJid: () => Promise<string | null>,
): Promise<void> {
  const matchDate = nextKickoffDate(local.ymd, local.dow, s.kickoff_dow);
  const { data: ws, error: wsErr } = await supabase
    .from('weekly_sessions')
    .select('id, state, signup_voter_jids, lineup_id, forced_lineup_player_ids')
    .eq('session_schedule_id', s.id)
    .eq('match_date', matchDate)
    .single();
  if (wsErr || !ws) {
    await log({ session_schedule_id: s.id, kind: 'skipped', summary: `${s.name}: team_gen skipped — no weekly_session for ${matchDate}` });
    return;
  }
  if (ws.state === 'confirmation_declined' || ws.state === 'cancelled') {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: team_gen skipped — state '${ws.state}'` });
    return;
  }
  if (ws.lineup_id) {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: team_gen skipped — lineup ${ws.lineup_id} already exists` });
    return;
  }

  const voterJids: string[] = Array.isArray(ws.signup_voter_jids) ? ws.signup_voter_jids : [];
  const forcedPlayerIds: string[] = Array.isArray(ws.forced_lineup_player_ids) ? ws.forced_lineup_player_ids : [];

  // Multi-tenant: the candidate pool is restricted to this club's roster.
  // (Service role bypasses RLS so we filter explicitly.)
  const { data: clubPlayerRows } = await supabase
    .from('club_players').select('player_id').eq('club_id', club.id);
  const clubPlayerIds: string[] = (clubPlayerRows ?? []).map((r: { player_id: string }) => r.player_id);
  if (clubPlayerIds.length === 0) {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `${s.name}: team_gen aborted — club has no players in roster`, club_id: club.id });
    return;
  }

  // Priority: (1) manually-forced player IDs (intersected with club roster for safety),
  //           (2) map voter JIDs to players in this club,
  //           (3) top-N regulars fallback so the bot still produces something.
  let playerSet: PlayerRow[] = [];
  let unmappedJids: string[] = [];
  let pickStrategy: 'forced' | 'voters' | 'top_regulars' = 'voters';

  if (forcedPlayerIds.length > 0) {
    const safeIds = forcedPlayerIds.filter(id => clubPlayerIds.includes(id));
    const { data: forcedRaw } = await supabase
      .from('players').select('id, name, status, preferred_position, overall_score, is_linchpin, preferred_team, whatsapp_jid')
      .in('id', safeIds);
    playerSet = (forcedRaw ?? []) as PlayerRow[];
    pickStrategy = 'forced';
  } else if (voterJids.length > 0) {
    // Direct match on whatsapp_jid first, restricted to this club's roster.
    const { data: directRaw } = await supabase
      .from('players').select('id, name, status, preferred_position, overall_score, is_linchpin, preferred_team, whatsapp_jid, whatsapp_phone')
      .in('id', clubPlayerIds)
      .in('whatsapp_jid', voterJids);
    const direct = (directRaw ?? []) as (PlayerRow & { whatsapp_phone: string | null })[];
    const directJids = new Set(direct.map(p => p.whatsapp_jid));
    const stillMissing = voterJids.filter(j => !directJids.has(j));

    let phoneMatched: PlayerRow[] = [];
    if (stillMissing.length > 0) {
      const missingPhones = stillMissing
        .map(j => j.split('@')[0])
        .filter(p => /^\d+$/.test(p));
      if (missingPhones.length > 0) {
        const { data: byPhoneRaw } = await supabase
          .from('players').select('id, name, status, preferred_position, overall_score, is_linchpin, preferred_team, whatsapp_jid, whatsapp_phone')
          .in('id', clubPlayerIds)
          .in('whatsapp_phone', missingPhones);
        phoneMatched = ((byPhoneRaw ?? []) as (PlayerRow & { whatsapp_phone: string | null })[])
          .filter(p => !direct.some(d => d.id === p.id));
        const resolvedPhones = new Set(phoneMatched.map(p => p.whatsapp_phone));
        for (const j of stillMissing) {
          const phone = j.split('@')[0];
          if (resolvedPhones.has(phone)) directJids.add(j);
        }
      }
    }

    unmappedJids = voterJids.filter(j => !directJids.has(j));
    playerSet = [...direct, ...phoneMatched];
  }

  if (playerSet.length === 0) {
    // Fallback: top-N regulars from THIS club's roster.
    const { data: fallback } = await supabase
      .from('players').select('id, name, status, preferred_position, overall_score, is_linchpin, preferred_team, whatsapp_jid')
      .in('id', clubPlayerIds)
      .eq('status', 'regular')
      .order('overall_score', { ascending: false })
      .limit(s.target_players);
    playerSet = (fallback ?? []) as PlayerRow[];
    pickStrategy = 'top_regulars';
  }

  if (playerSet.length < 2) {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `${s.name}: team_gen aborted — only ${playerSet.length} player(s) available` });
    return;
  }

  // If we have more voters than target_players, take the top N by score
  if (playerSet.length > s.target_players) {
    playerSet = [...playerSet].sort((a, b) => b.overall_score - a.overall_score).slice(0, s.target_players);
  }

  const { black, white } = balanceTeams(playerSet);
  const positions: LineupPosition[] = [
    ...black.map(p => ({ player_id: p.id, name: p.name, overall_score: p.overall_score, preferred_position: p.preferred_position, is_linchpin: p.is_linchpin, team: 'black' as const, locked: false })),
    ...white.map(p => ({ player_id: p.id, name: p.name, overall_score: p.overall_score, preferred_position: p.preferred_position, is_linchpin: p.is_linchpin, team: 'white' as const, locked: false })),
  ];

  const requireApproval = s.team_gen_require_approval !== false; // default true
  const approvalToken = requireApproval ? generateToken() : null;
  const lineupName = `${s.name} — ${matchDate}`;

  const { data: lineupIns, error: lineupErr } = await supabase
    .from('lineups')
    .insert({
      club_id: club.id,
      name: lineupName,
      player_positions: positions,
      status: requireApproval ? 'pending_approval' : 'confirmed',
      approval_token: approvalToken,
      session_schedule_id: s.id,
      match_date: matchDate,
    })
    .select('id, approval_token')
    .single();
  if (lineupErr || !lineupIns) {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `lineup insert failed: ${lineupErr?.message ?? 'unknown'}` });
    return;
  }

  // Update weekly_session with the lineup + state + unmapped voters
  await supabase.from('weekly_sessions').update({
    lineup_id: lineupIns.id,
    state: requireApproval ? 'teams_pending_approval' : 'teams_pending_approval', // post step flips to teams_posted
    unmapped_voter_jids: unmappedJids,
  }).eq('id', ws.id);

  await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'sent',
    summary: `${s.name}: lineup created (${positions.length} players, ${pickStrategy}${unmappedJids.length ? `, ${unmappedJids.length} unmapped` : ''})`,
    details: { lineup_id: lineupIns.id, players: positions.length, strategy: pickStrategy, unmapped_count: unmappedJids.length, require_approval: requireApproval } });

  if (!requireApproval) {
    // Post immediately — let postConfirmedLineups (called every tick) handle it
    return;
  }

  // Send approval DM to organiser
  const jwt = await ensureSenderJwt();
  if (!jwt) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: 'no JWT' }); return; }
  const selfJid = await ensureSelfJid();
  if (!selfJid) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: 'no self JID' }); return; }

  const text = renderApprovalDm(s, lineupIns.approval_token!, positions);
  const url = RELAY_URL.replace(/\/$/, '') + '/message?connection=user';
  let resp: Response;
  try { resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }, body: JSON.stringify({ to: selfJid, text }) }); }
  catch (e) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `approval DM net err: ${(e as Error).message}` }); return; }
  const respText = await resp.text();
  if (!resp.ok) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `approval DM ${resp.status}`, details: { body: respText.substring(0, 300) } }); return; }
  await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'sent', summary: `${s.name}: approval DM sent for lineup ${lineupIns.id}`, details: { token: lineupIns.approval_token, players: positions.length } });
}

// ── Auto-post lineup once it's confirmed (or auto-generated without approval) ─
async function postConfirmedLineups(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  log: (row: any) => Promise<unknown>,
  club: Club,
  ensureSenderJwt: () => Promise<string | null>,
): Promise<number> {
  const { data: lineups, error } = await supabase
    .from('lineups')
    .select('id, name, player_positions, status, session_schedule_id, match_date, posted_at, updated_at')
    .eq('club_id', club.id)
    .eq('status', 'confirmed')
    .is('posted_at', null);
  if (error) { await log({ kind: 'error', summary: `postConfirmedLineups load: ${error.message}`, club_id: club.id }); return 0; }
  if (!lineups || lineups.length === 0) return 0;

  let posted = 0;
  for (const lineup of lineups) {
    const { data: sched } = await supabase
      .from('session_schedules').select('*').eq('id', lineup.session_schedule_id).single();
    if (!sched) { await log({ kind: 'error', summary: `lineup ${lineup.id}: schedule not found` }); continue; }
    const s = sched as SessionSchedule;
    if (!s.whatsapp_group_jid) { await log({ session_schedule_id: s.id, kind: 'error', summary: `lineup ${lineup.id}: no group_jid` }); continue; }

    const positions = (Array.isArray(lineup.player_positions) ? lineup.player_positions : []) as LineupPosition[];
    if (positions.length === 0) { await log({ session_schedule_id: s.id, kind: 'error', summary: `lineup ${lineup.id}: empty positions` }); continue; }

    const jwt = await ensureSenderJwt();
    if (!jwt) continue;

    // Post ONLY the pitch image (with a short caption). Text roster list is
    // redundant once the visual is there — the user explicitly asked for image-only.
    // Cache-bust based on lineup updated_at so rendering changes propagate
    // even with Vercel's aggressive image-response cache.
    const cacheBust = lineup.updated_at ? Date.parse(lineup.updated_at) : Date.now();
    const imageUrl = `${APP_URL}/api/lineup-image?id=${encodeURIComponent(lineup.id)}&v=${cacheBust}`;
    const mediaUrl = RELAY_URL.replace(/\/$/, '') + '/media?connection=user';
    let mResp: Response;
    try {
      mResp = await fetch(mediaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
        body: JSON.stringify({ to: s.whatsapp_group_jid, type: 'image', url: imageUrl }),
      });
    } catch (e) {
      await log({ session_schedule_id: s.id, kind: 'error', summary: `team image net err: ${(e as Error).message}` });
      continue;
    }
    if (!mResp.ok) {
      const mBody = (await mResp.text()).substring(0, 300);
      await log({ session_schedule_id: s.id, kind: 'error', summary: `team image post ${mResp.status}`, details: { image_url: imageUrl, body: mBody } });
      continue;
    }

    // Mark lineup posted + update weekly_session
    await supabase.from('lineups').update({ status: 'posted', posted_at: new Date().toISOString() }).eq('id', lineup.id);
    if (lineup.match_date) {
      await supabase.from('weekly_sessions').update({ state: 'teams_posted' })
        .eq('session_schedule_id', s.id).eq('match_date', lineup.match_date);
    }
    await log({ session_schedule_id: s.id, kind: 'sent', summary: `${s.name}: teams (image) posted to ${s.whatsapp_group_name ?? s.whatsapp_group_jid}`, details: { lineup_id: lineup.id, players: positions.length, image_url: imageUrl } });
    posted++;
  }
  return posted;
}

// ── Force-post fallback: at T-N if still pending_approval, post anyway ───────
async function fireTeamForcePost(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  log: (row: any) => Promise<unknown>,
  club: Club,
  s: SessionSchedule,
  local: { dow: number; hh: number; mm: number; ymd: string },
  ensureSenderJwt: () => Promise<string | null>,
): Promise<void> {
  const matchDate = nextKickoffDate(local.ymd, local.dow, s.kickoff_dow);
  const { data: ws } = await supabase
    .from('weekly_sessions')
    .select('id, state, lineup_id')
    .eq('session_schedule_id', s.id)
    .eq('match_date', matchDate)
    .single();
  if (!ws || !ws.lineup_id) {
    await log({ session_schedule_id: s.id, kind: 'skipped', summary: `${s.name}: force-post skipped — no lineup yet` });
    return;
  }
  if (ws.state === 'teams_posted' || ws.state === 'cancelled' || ws.state === 'confirmation_declined') {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: force-post skipped — state '${ws.state}'` });
    return;
  }

  // Promote the pending lineup → confirmed; postConfirmedLineups (also called this tick) will pick it up
  const { data: lineup } = await supabase.from('lineups').select('id, status').eq('id', ws.lineup_id).single();
  if (!lineup) return;
  if (lineup.status === 'pending_approval' || lineup.status === 'draft') {
    await supabase.from('lineups').update({
      status: 'confirmed',
      approved_at: new Date().toISOString(),
      rejection_reason: null,
    }).eq('id', lineup.id);
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'sent', summary: `${s.name}: force-confirmed lineup ${lineup.id} (no organiser approval received)` });
  } else if (lineup.status === 'rejected') {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: force-post skipped — lineup was rejected` });
  }
}

// ── MoM: Man of the Match polls ─────────────────────────────────────────────
// Two modes:
//   'organiser_dm'  — one DM poll to the organiser, options = all lineup players.
//                     Simpler, great for tonight's test + small-trust groups.
//   everything else — per-player DM: each player gets a private poll with the
//                     OTHER players as options (no self-vote). More faithful,
//                     requires every player has a mapped whatsapp_jid.
async function fireMomPoll(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  log: (row: any) => Promise<unknown>,
  club: Club,
  s: SessionSchedule,
  local: { dow: number; hh: number; mm: number; ymd: string },
  ensureSenderJwt: () => Promise<string | null>,
  ensureSelfJid: () => Promise<string | null>,
): Promise<void> {
  const matchDate = nextKickoffDate(local.ymd, local.dow, s.kickoff_dow);
  const { data: ws } = await supabase
    .from('weekly_sessions')
    .select('id, state, lineup_id, mom_ballots, mom_message_id')
    .eq('session_schedule_id', s.id)
    .eq('match_date', matchDate)
    .single();
  if (!ws) { await log({ session_schedule_id: s.id, kind: 'skipped', summary: `${s.name}: mom_poll skipped — no weekly_session` }); return; }
  if (ws.state === 'cancelled' || ws.state === 'confirmation_declined') { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: mom_poll skipped — state '${ws.state}'` }); return; }
  if (ws.mom_message_id) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: mom_poll already sent` }); return; }
  if (!ws.lineup_id) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: mom_poll skipped — no lineup` }); return; }

  // Fetch the lineup's player_positions
  const { data: lineup } = await supabase.from('lineups').select('player_positions').eq('id', ws.lineup_id).single();
  const positions = (Array.isArray(lineup?.player_positions) ? lineup.player_positions : []) as LineupPosition[];
  if (positions.length === 0) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: 'mom_poll: empty lineup' }); return; }

  const jwt = await ensureSenderJwt();
  if (!jwt) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: 'no JWT' }); return; }
  // Relay enforces 5 polls/minute per user. If we hit 429, wait out a full
  // rate-limit window (~65s) and retry once. Also includes a basic retry for
  // transient 503 "WhatsApp not connected" errors.
  const sendPoll = async (to: string, question: string, options: string[], attempt = 1): Promise<boolean> => {
    const url = RELAY_URL.replace(/\/$/, '') + '/poll?connection=user';
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }, body: JSON.stringify({ to, question, options, selectableCount: 1 }) });
      if (resp.ok) return true;
      // Retryable statuses: 429 rate-limited, 503 WhatsApp not connected (transient reconnect)
      if ((resp.status === 429 || resp.status === 503) && attempt < 3) {
        const waitMs = resp.status === 429 ? 65000 : 5000;
        await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'decided', summary: `mom poll retry (${resp.status}) for ${to.slice(0, 14)}… in ${waitMs}ms`, details: { attempt, status: resp.status } });
        await new Promise(r => setTimeout(r, waitMs));
        return sendPoll(to, question, options, attempt + 1);
      }
      const body = await resp.text();
      await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `mom poll send ${resp.status}`, details: { to, attempt, body: body.substring(0, 200) } });
      return false;
    } catch (e) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `mom poll net err: ${(e as Error).message}` }); return false; }
  };

  const dayName = Object.keys(DAY_TO_NUM).find(k => DAY_TO_NUM[k] === s.kickoff_dow) ?? '?';
  const question = `🏆 Man of the Match — ${dayName}?`;

  if (s.mom_method === 'organiser_dm') {
    // Simpler flow: one poll DM'd to the organiser with all lineup players as options.
    const selfJid = await ensureSelfJid();
    if (!selfJid) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: 'mom_poll: no self JID' }); return; }
    const options = positions.map(p => p.name);
    const ok = await sendPoll(selfJid, question, options);
    if (!ok) return;
    // Record a single "ballot" (the organiser's DM) so the results step knows where to read
    const ballots = [{ recipient_player_id: null, recipient_jid: selfJid, poll_message_id: null, option_player_ids: positions.map(p => p.player_id) }];
    await supabase.from('weekly_sessions').update({ mom_ballots: ballots, mom_message_id: 'organiser', state: 'mom_sent' }).eq('id', ws.id);
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'sent', summary: `${s.name}: MoM DM poll sent to organiser (${positions.length} options)`, details: { to: selfJid, question, options } });
    return;
  }

  if (s.mom_method === 'web_link') {
    // Web-link flow: post an anonymous vote link to the group. Players tap,
    // pick, dedup is per-device. Aggregation reads from soccer.mom_votes.
    if (!s.whatsapp_group_jid) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: 'mom_poll: no whatsapp_group_jid' }); return; }
    const voteToken = generateToken();
    const { error: tokErr } = await supabase
      .from('weekly_sessions')
      .update({ mom_vote_token: voteToken, mom_message_id: 'web_link', state: 'mom_sent' })
      .eq('id', ws.id);
    if (tokErr) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `mom_poll token save: ${tokErr.message}` }); return; }
    const link = `${APP_URL}/mom/${voteToken}`;
    const windowMin = s.mom_results_post_minutes;
    const text =
      `🏆 *Man of the Match — ${question.replace('🏆 Man of the Match — ', '').replace('?','')}*\n\n` +
      `Vote privately — anonymous.\n${link}\n\n` +
      `You have *${windowMin} min* to cast your vote ⏱`;
    const url = RELAY_URL.replace(/\/$/, '') + '/message?connection=user';
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }, body: JSON.stringify({ to: s.whatsapp_group_jid, text }) });
      if (!resp.ok) {
        const body = (await resp.text()).substring(0, 300);
        await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `mom web link post ${resp.status}`, details: { body } });
        return;
      }
    } catch (e) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `mom web link net err: ${(e as Error).message}` }); return; }
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'sent', summary: `${s.name}: MoM vote link posted`, details: { link, window_min: windowMin } });
    return;
  }

  // Per-player DM flow (production fallback when web_link not chosen): send a poll to each player with the OTHERS as options.
  const ballots: Array<{ recipient_player_id: string; recipient_jid: string; poll_message_id: string | null; option_player_ids: string[] }> = [];
  const unmappedNames: string[] = [];

  // Look up the players' JIDs
  const { data: pRows } = await supabase
    .from('players').select('id, name, whatsapp_jid')
    .in('id', positions.map(p => p.player_id));
  const jidById = new Map<string, string | null>();
  for (const p of (pRows ?? [])) jidById.set(p.id, p.whatsapp_jid ?? null);

  // Mark the sentinel IMMEDIATELY so the next cron tick can't retry this
  // fire mid-way through the long send loop (prevents duplicate polls).
  // If the function dies partway, the ballots written so far are still valid —
  // aggregation just counts whoever made it in.
  await supabase.from('weekly_sessions').update({
    mom_message_id: 'sending',
    state: 'mom_sent',
  }).eq('id', ws.id);

  for (const player of positions) {
    const jid = jidById.get(player.player_id) ?? null;
    if (!jid) { unmappedNames.push(player.name); continue; }
    const others = positions.filter(p => p.player_id !== player.player_id);
    const options = others.map(p => p.name);
    const ok = await sendPoll(jid, question, options);
    if (ok) {
      const ballot = { recipient_player_id: player.player_id, recipient_jid: jid, poll_message_id: null, option_player_ids: others.map(p => p.player_id) };
      ballots.push(ballot);
      // Persist ballot incrementally so a mid-loop timeout doesn't lose what we've sent
      await supabase.from('weekly_sessions').update({ mom_ballots: ballots }).eq('id', ws.id);
    }
    // Relay rate limit is 5 polls/minute → 12s/poll is the floor. We use 13s
    // for a safety margin. For a 12-player lineup this makes the full send
    // loop ~156s, which is well under the Edge Function wall-clock limit.
    await new Promise(r => setTimeout(r, 13000));
  }

  // DM the organiser about players we couldn't reach
  if (unmappedNames.length > 0) {
    const selfJid = await ensureSelfJid();
    if (selfJid) {
      const text = `🏆 *MoM coverage — ${unmappedNames.length} player${unmappedNames.length === 1 ? '' : 's'} didn't get a DM*\n\n` +
        unmappedNames.map(n => `• ${n}`).join('\n') + '\n\nAsk them directly + reply here with their picks if you want them counted.';
      const url = RELAY_URL.replace(/\/$/, '') + '/message?connection=user';
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }, body: JSON.stringify({ to: selfJid, text }) }).catch(() => undefined);
    }
  }

  await supabase.from('weekly_sessions').update({
    mom_unmapped_names: unmappedNames,
    mom_message_id: ballots.length > 0 ? 'sent' : null,
  }).eq('id', ws.id);
  await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'sent', summary: `${s.name}: MoM DMs sent (${ballots.length} players reached, ${unmappedNames.length} unmapped)`, details: { ballots_count: ballots.length, unmapped_count: unmappedNames.length } });
}

async function fireMomResults(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  log: (row: any) => Promise<unknown>,
  club: Club,
  s: SessionSchedule,
  local: { dow: number; hh: number; mm: number; ymd: string },
  ensureSenderJwt: () => Promise<string | null>,
): Promise<void> {
  const matchDate = nextKickoffDate(local.ymd, local.dow, s.kickoff_dow);
  const { data: ws } = await supabase
    .from('weekly_sessions').select('id, state, lineup_id, mom_ballots, mom_results_message_id, mom_vote_token')
    .eq('session_schedule_id', s.id).eq('match_date', matchDate).single();
  if (!ws) return;
  if (ws.state === 'cancelled' || ws.state === 'confirmation_declined') { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: mom_results skipped — state '${ws.state}'` }); return; }
  if (ws.mom_results_message_id) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: mom_results already posted` }); return; }

  const jwt = await ensureSenderJwt();
  if (!jwt) return;

  const tally = new Map<string, number>(); // player_id → votes

  if (s.mom_method === 'web_link' && ws.mom_vote_token) {
    // Web-link path: read from soccer.mom_votes (canonical, per-device dedup)
    const { data: votes, error: vErr } = await supabase
      .from('mom_votes').select('voted_for_player_id')
      .eq('weekly_session_id', ws.id);
    if (vErr) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `mom_results: fetch votes failed: ${vErr.message}` }); return; }
    for (const v of (votes ?? []) as Array<{ voted_for_player_id: string }>) {
      tally.set(v.voted_for_player_id, (tally.get(v.voted_for_player_id) ?? 0) + 1);
    }
  } else {
    // DM/organiser_dm path: read poll votes via the relay
    const ballots = Array.isArray(ws.mom_ballots) ? ws.mom_ballots : [];
    if (ballots.length === 0) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'skipped', summary: `${s.name}: mom_results skipped — no ballots` }); return; }
    for (const b of ballots as Array<{ recipient_jid: string; option_player_ids: string[] }>) {
      const url = `${RELAY_URL.replace(/\/$/, '')}/polls?connection=user&chatJid=${encodeURIComponent(b.recipient_jid)}`;
      try {
        const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${jwt}` } });
        if (!resp.ok) continue;
        // deno-lint-ignore no-explicit-any
        const body: any = await resp.json().catch(() => null);
        const polls: RelayPoll[] = Array.isArray(body) ? body : (body?.data ?? []);
        // Pick the most recent poll — that's our MoM DM
        const poll = polls.slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
        if (!poll) continue;
        for (const r of (poll.results ?? [])) {
          const idx = poll.options.indexOf(r.name);
          const pid = idx >= 0 ? b.option_player_ids[idx] : null;
          if (!pid) continue;
          const count = Array.isArray(r.voters) ? r.voters.length : 0;
          tally.set(pid, (tally.get(pid) ?? 0) + count);
        }
      } catch (_e) { /* swallow per-ballot errors */ }
    }
  }

  // Load lineup to map ids → names
  const { data: lineup } = await supabase.from('lineups').select('player_positions').eq('id', ws.lineup_id).single();
  const positions = (Array.isArray(lineup?.player_positions) ? lineup.player_positions : []) as LineupPosition[];
  const nameById = new Map<string, string>();
  for (const p of positions) nameById.set(p.player_id, p.name);

  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const totalVotes = [...tally.values()].reduce((a, b) => a + b, 0);
  const dayName = Object.keys(DAY_TO_NUM).find(k => DAY_TO_NUM[k] === s.kickoff_dow) ?? '?';

  let body: string;
  if (ranked.length === 0 || totalVotes === 0) {
    body = `🏆 *Man of the Match — ${dayName}*\n\nNo votes were cast. No winner crowned this week 🤷`;
  } else {
    const [winnerId, winnerVotes] = ranked[0];
    const winnerName = nameById.get(winnerId) ?? 'Unknown';
    const firstName = winnerName.split(' ')[0];
    let runnerUpLine = '';
    if (ranked.length > 1 && ranked[1][1] > 0) {
      const [ruId, ruVotes] = ranked[1];
      runnerUpLine = `\nRunner-up: ${nameById.get(ruId) ?? '?'} (${ruVotes} vote${ruVotes === 1 ? '' : 's'})`;
    }
    body =
      `🏆 *Man of the Match — ${dayName}*\n\n` +
      `Winner: *${winnerName}* (${winnerVotes} vote${winnerVotes === 1 ? '' : 's'})${runnerUpLine}\n\n` +
      `Nice one ${firstName} 👏`;
  }

  if (!s.whatsapp_group_jid) { await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: 'mom_results: no group_jid' }); return; }
  const url = RELAY_URL.replace(/\/$/, '') + '/message?connection=user';
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }, body: JSON.stringify({ to: s.whatsapp_group_jid, text: body }) });
    if (!resp.ok) { const b = await resp.text(); await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `mom_results post ${resp.status}`, details: { body: b.substring(0, 300) } }); return; }
    await supabase.from('weekly_sessions').update({ state: 'mom_closed', mom_results_message_id: 'sent' }).eq('id', ws.id);
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'sent', summary: `${s.name}: MoM results posted (${totalVotes} total votes)`, details: { total_votes: totalVotes, ranked: ranked.map(([id, v]) => ({ name: nameById.get(id) ?? '?', votes: v })), text: body.substring(0, 400) } });
  } catch (e) {
    await log({ session_schedule_id: s.id, weekly_session_id: ws.id, kind: 'error', summary: `mom_results net err: ${(e as Error).message}` });
  }
}
