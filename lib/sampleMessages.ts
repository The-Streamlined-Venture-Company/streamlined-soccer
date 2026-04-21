/**
 * Sample message generators for the Test panel.
 *
 * Each generator takes the session's config + an optional persona
 * and returns either a text message or a poll spec.
 *
 * Real production messages will use the same shapes but pull live data.
 */

import { SessionSchedule, DAYS_OF_WEEK, Player } from '../types/database';
import { formatAutomatedMessage } from './messageFormat';

export type SamplePayload =
  | { kind: 'message'; text: string }
  | { kind: 'poll'; question: string; options: string[]; selectableCount: number };

interface Ctx {
  session: SessionSchedule;
  persona: string;
  /** A handful of player names to make sample previews feel real. */
  players: Player[];
}

function dayName(dow: number): string {
  return DAYS_OF_WEEK[dow] ?? '?';
}

function timeShort(t: string | null): string {
  if (!t) return '';
  return t.length >= 5 ? t.substring(0, 5) : t;
}

function pitchSuffix(s: SessionSchedule): string {
  return s.pitch_label ? ` — ${s.pitch_label}` : '';
}

function pickNames(players: Player[], n: number): string[] {
  return players.slice(0, n).map(p => p.name.split(' ')[0]).filter(Boolean);
}

// ── Call-out poll ────────────────────────────────────────────────────────────
// Native WhatsApp poll — votes are the signups. No text-reply parsing needed.

/**
 * Replace `{day}`, `{time}`, `{pitch}`, `{pitch_suffix}`, `{target}` placeholders.
 * `{pitch_suffix}` expands to ` — <pitch>` if set, or empty — useful for grammar.
 */
export function renderCallOutQuestion(session: SessionSchedule): string {
  const tpl = session.callout_poll_question || '⚽ Football {day} at {time}{pitch_suffix}. Need {target}. Are you in?';
  const pitch = session.pitch_label ?? '';
  const subs: Record<string, string> = {
    '{day}': dayName(session.kickoff_dow),
    '{time}': timeShort(session.kickoff_time),
    '{pitch}': pitch,
    '{pitch_suffix}': pitch ? ` — ${pitch}` : '',
    '{target}': String(session.target_players),
  };
  return tpl.replace(/\{(day|time|pitch|pitch_suffix|target)\}/g, m => subs[m] ?? m);
}

export function sampleCallOut(ctx: Ctx): SamplePayload {
  const { session } = ctx;
  const question = renderCallOutQuestion(session);
  const options =
    session.callout_poll_options && session.callout_poll_options.length >= 2
      ? session.callout_poll_options
      : ['In ✅', 'Out ❌', 'Maybe 🤔'];
  return { kind: 'poll', question, options, selectableCount: 1 };
}

// ── Morning nudge (group post) ───────────────────────────────────────────────

export function sampleMorningNudge(ctx: Ctx): SamplePayload {
  const { session, persona } = ctx;
  const so_far = Math.max(0, session.min_players - 2);
  const need = session.target_players - so_far;
  const body =
    `🌅 *Morning, we still need ${need} more for tonight* (${dayName(session.kickoff_dow)} ${timeShort(session.kickoff_time)}${pitchSuffix(session)}).\n\n` +
    `Currently ${so_far} of ${session.target_players}. Reply *In* to lock your spot.`;
  return { kind: 'message', text: formatAutomatedMessage(body, persona) };
}

// ── Follow-up DM to an individual ───────────────────────────────────────────

export function sampleFollowupDm(ctx: Ctx): SamplePayload {
  const { session, persona, players } = ctx;
  const name = players[0]?.name.split(' ')[0] ?? 'mate';
  const body =
    `Hey ${name} 👋\n\n` +
    `We're a few short for ${dayName(session.kickoff_dow)} ${timeShort(session.kickoff_time)}${pitchSuffix(session)}. ` +
    `You usually play — fancy it this week?\n\n` +
    `Just reply *In* or *Out*.`;
  return { kind: 'message', text: formatAutomatedMessage(body, persona) };
}

// ── Confirmation DM to organiser (poll) ─────────────────────────────────────
// Sent privately to you before the weekly call-out. If you don't vote, the
// call-out goes ahead at its scheduled time anyway.

export function sampleConfirmationDm(ctx: Ctx): SamplePayload {
  const { session } = ctx;
  const question =
    `🤔 ${dayName(session.kickoff_dow)} football at ${timeShort(session.kickoff_time)}${pitchSuffix(session)} — still on? (no answer = yes)`;
  return {
    kind: 'poll',
    question,
    options: ['Yes, send the call-out ✅', 'No, skip this week ❌'],
    selectableCount: 1,
  };
}

// ── Team approval DM (sent to organiser when team_gen_require_approval) ────

export function sampleTeamApprovalDm(ctx: Ctx): SamplePayload {
  const { session, persona } = ctx;
  const sample_token = 'demo-abc123';
  const link = `https://streamlined-soccer.vercel.app/approve/${sample_token}`;
  const body =
    `🏟 *Teams ready for ${dayName(session.kickoff_dow)} ${timeShort(session.kickoff_time)}${pitchSuffix(session)}*\n\n` +
    `I've auto-balanced ${session.target_players} players into two teams.\n\n` +
    `👉 *Preview, edit, or confirm:*\n${link}\n\n` +
    `If I don't hear from you by kickoff, I'll post these teams to the group as-is.`;
  return { kind: 'message', text: formatAutomatedMessage(body, persona) };
}

// ── Team announcement ───────────────────────────────────────────────────────

export function sampleTeamAnnouncement(ctx: Ctx): SamplePayload {
  const { session, persona, players } = ctx;
  const half = Math.max(3, Math.min(7, Math.floor(session.target_players / 2)));
  const black = pickNames(players.slice(0, half), half);
  const white = pickNames(players.slice(half, half * 2), half);
  const fmtList = (xs: string[]) => xs.map(n => `• ${n}`).join('\n');
  const body =
    `🏟 *Teams for ${dayName(session.kickoff_dow)} ${timeShort(session.kickoff_time)}*${pitchSuffix(session)}\n\n` +
    `*⚫ Black tops*\n${fmtList(black)}\n\n` +
    `*⚪ White tops*\n${fmtList(white)}\n\n` +
    `Late dropouts? Let me know.`;
  return { kind: 'message', text: formatAutomatedMessage(body, persona) };
}

// ── MoM poll ────────────────────────────────────────────────────────────────

/**
 * Human-friendly duration:
 *   45 → "45 min"
 *   60 → "1 hour"
 *   90 → "1h 30m"
 *   120 → "2 hours"
 *   1440 → "24 hours"
 */
export function formatDurationMinutes(minutes: number): string {
  if (minutes <= 0) return 'until everyone votes';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} hour${h === 1 ? '' : 's'}`;
  return `${h}h ${m}m`;
}

export function sampleMomPoll(ctx: Ctx): SamplePayload {
  const { players, session } = ctx;
  const n = Math.min(12, Math.max(2, players.length));
  const options = pickNames(players, n);
  const window = formatDurationMinutes(session.mom_results_post_minutes);
  return {
    kind: 'poll',
    question: `🏆 Man of the Match? · ${window} to vote`,
    options,
    selectableCount: 1,
  };
}

// ── MoM results announcement ────────────────────────────────────────────────

export function sampleMomResults(ctx: Ctx): SamplePayload {
  const { persona, players, session } = ctx;
  const winner = players[0]?.name ?? 'TBD';
  const runnerUp = players[1]?.name ?? 'TBD';
  const window = formatDurationMinutes(session.mom_results_post_minutes);
  const body =
    `🏆 *Man of the Match*\n\n` +
    `Voting closed after ${window}.\n\n` +
    `Winner: *${winner}* (5 votes)\n` +
    `Runner-up: ${runnerUp} (3 votes)\n\n` +
    `Nice one ${winner.split(' ')[0]} 👏`;
  return { kind: 'message', text: formatAutomatedMessage(body, persona) };
}

// ── Registry ────────────────────────────────────────────────────────────────

export interface TestEntry {
  id: string;
  label: string;
  description: string;
  /** Where the test send actually goes:
   *  - 'group' = uses the group picker in the test panel
   *  - 'self_dm' = sends to the connected user's own WhatsApp number
   */
  target: 'group' | 'self_dm';
  generate: (ctx: Ctx) => SamplePayload;
}

export const TESTS: TestEntry[] = [
  {
    id: 'callout',
    label: 'Call-out poll',
    description: "The weekly poll that opens signups — votes are the signups.",
    target: 'group',
    generate: sampleCallOut,
  },
  {
    id: 'morning_nudge',
    label: 'Morning nudge',
    description: 'Group post on game-day morning when numbers are low.',
    target: 'group',
    generate: sampleMorningNudge,
  },
  {
    id: 'followup_dm',
    label: 'Follow-up DM',
    description: 'A DM to a regular who hasn\'t responded yet (sent here as a group post for preview).',
    target: 'group',
    generate: sampleFollowupDm,
  },
  {
    id: 'confirmation_dm',
    label: 'Confirmation DM',
    description: 'The yes/no DM to you before the call-out fires (sent to your own WhatsApp).',
    target: 'self_dm',
    generate: sampleConfirmationDm,
  },
  {
    id: 'team_approval_dm',
    label: 'Team approval DM',
    description:
      "Real DM to your own WhatsApp with a link to preview, edit, and confirm the auto-balanced teams before they post.",
    target: 'self_dm',
    generate: sampleTeamApprovalDm,
  },
  {
    id: 'team_announcement',
    label: 'Team announcement',
    description: 'The teams post that goes up to the group, after approval (or auto if no approval needed).',
    target: 'group',
    generate: sampleTeamAnnouncement,
  },
  {
    id: 'mom_poll',
    label: 'MoM poll',
    description: 'Native WhatsApp poll asking who deserves Man of the Match.',
    target: 'group',
    generate: sampleMomPoll,
  },
  {
    id: 'mom_results',
    label: 'MoM results',
    description: 'The post announcing the winner once voting wraps.',
    target: 'group',
    generate: sampleMomResults,
  },
];
