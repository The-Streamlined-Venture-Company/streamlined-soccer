/**
 * Shared registry for editable message templates.
 *
 * For each automated WhatsApp message we let the organiser override the
 * body text. The DB column is `<id>_template` on `soccer.session_schedules`
 * — NULL means "use the built-in default", a non-NULL string is the
 * custom template with `{placeholder}` substitutions.
 *
 * This file is the single source of truth for:
 *  - default templates (also embedded in runtime-tick for the edge fn)
 *  - the variable list shown in the UI
 *  - sample-value generators for the live preview in SessionEditor
 *
 * The runtime-tick edge function (Deno) cannot import this file, so the
 * defaults are duplicated there. Keep them in sync — or better, treat
 * this file as the source and copy any change into runtime-tick when
 * shipping. There's a comment in runtime-tick pointing here.
 */
import { SessionSchedule, DAYS_OF_WEEK } from '../types/database';

export type TemplateId =
  | 'confirmation'
  | 'nudge'
  | 'auto_cancel'
  | 'approval'
  | 'team_caption'
  | 'mom_link'
  | 'mom_results';

/** Map TemplateId → the DB column on session_schedules. */
export const TEMPLATE_COLUMN: Record<TemplateId, keyof SessionSchedule> = {
  confirmation: 'confirmation_template',
  nudge:        'nudge_template',
  auto_cancel:  'auto_cancel_template',
  approval:     'approval_template',
  team_caption: 'team_caption_template',
  mom_link:     'mom_link_template',
  mom_results:  'mom_results_template',
};

export interface TemplateMeta {
  id: TemplateId;
  /** Short human label shown in the UI. */
  label: string;
  /** When this fires + where it lands. */
  description: string;
  /** Default body when the template column is NULL. */
  default: string;
  /** Ordered list of supported `{placeholder}` names + a one-line hint each. */
  variables: Array<{ name: string; hint: string }>;
}

// ── Defaults (copy of runtime-tick's render fns, kept in sync) ──────────────

const DEFAULT_CONFIRMATION =
  '⚽ *{day} football at {time}{pitch_suffix}* — still on?\n\n' +
  'If nothing changes, the call-out goes out as scheduled.\n\n' +
  '_Need to skip this week? Tap here:_\n{link}';

const DEFAULT_NUDGE =
  '🌅 *Football {when}{pitch_suffix}*\n\n' +
  "We've got *{signups_in}/{target}* so far — still need at least *{need}* more or the game gets called off.\n\n" +
  "If you're in, vote on the poll above 👆";

const DEFAULT_AUTO_CANCEL =
  '🚫 *{day} football{pitch_suffix} called off*\n\n' +
  'Only *{signups_in}* signed up — we need at least *{cancel_floor}* to play. Sorry team, see you next week ⚽';

const DEFAULT_APPROVAL =
  '🏟 *Teams ready for {day} {time}{pitch_suffix}*\n\n' +
  "I've auto-balanced {total} players: ⚫ {black_count} vs ⚪ {white_count}.\n\n" +
  '👉 *Preview, edit, or confirm:*\n{link}\n\n' +
  "_If I don't hear from you, I'll post these as-is {fallback_min} min before kickoff._";

const DEFAULT_TEAM_CAPTION =
  '🏟 *{day} {time}*{pitch_dot}\n\nLate dropouts? Let me know.';

const DEFAULT_MOM_LINK =
  '🏆 *Man of the Match — {day}*\n\n' +
  'Vote privately — anonymous.\n{link}\n\n' +
  'You have *{window}* to cast your vote ⏱';

const DEFAULT_MOM_RESULTS =
  '🏆 *Man of the Match — {day}*\n\n' +
  'Winner: *{winner}* ({winner_votes} vote{winner_votes_plural}){runner_up_line}\n\n' +
  'Nice one {winner_first} 👏';

// ── Registry ───────────────────────────────────────────────────────────────

export const TEMPLATES: TemplateMeta[] = [
  {
    id: 'confirmation',
    label: 'Confirmation DM',
    description: 'DMed to you the day before the call-out. Lets you skip the week with one tap.',
    default: DEFAULT_CONFIRMATION,
    variables: [
      { name: 'day',         hint: 'Day of the week (Thursday)' },
      { name: 'time',        hint: 'Kickoff time (20:00)' },
      { name: 'pitch',       hint: 'Pitch label, raw' },
      { name: 'pitch_suffix',hint: 'Pitch with em-dash prefix, or empty' },
      { name: 'link',        hint: 'Skip-this-week URL' },
    ],
  },
  {
    id: 'nudge',
    label: 'Low-signup nudge',
    description: 'Sent if signups are below the nudge floor at nudge time.',
    default: DEFAULT_NUDGE,
    variables: [
      { name: 'day',          hint: 'Day of the week' },
      { name: 'time',         hint: 'Kickoff time' },
      { name: 'when',         hint: '"tonight at 20:00" (same-day) or "Thursday at 20:00"' },
      { name: 'pitch',        hint: 'Pitch label' },
      { name: 'pitch_suffix', hint: 'Pitch with em-dash prefix, or empty' },
      { name: 'signups_in',   hint: 'How many have signed up' },
      { name: 'target',       hint: 'Target squad size' },
      { name: 'need',         hint: 'How many more to hit cancel floor' },
      { name: 'cancel_floor', hint: 'Min players before game is called off' },
    ],
  },
  {
    id: 'auto_cancel',
    label: 'Auto-cancel notice',
    description: 'Posted (or DMed) if signups are below the cancel floor at team-gen time.',
    default: DEFAULT_AUTO_CANCEL,
    variables: [
      { name: 'day',          hint: 'Day of the week' },
      { name: 'time',         hint: 'Kickoff time' },
      { name: 'pitch',        hint: 'Pitch label' },
      { name: 'pitch_suffix', hint: 'Pitch with em-dash prefix, or empty' },
      { name: 'signups_in',   hint: 'How many had signed up' },
      { name: 'cancel_floor', hint: 'Cancel threshold' },
    ],
  },
  {
    id: 'approval',
    label: 'Lineup approval DM',
    description: 'DMed to you when teams are auto-generated and approval is required.',
    default: DEFAULT_APPROVAL,
    variables: [
      { name: 'day',          hint: 'Day of the week' },
      { name: 'time',         hint: 'Kickoff time' },
      { name: 'pitch',        hint: 'Pitch label' },
      { name: 'pitch_suffix', hint: 'Pitch with em-dash prefix, or empty' },
      { name: 'total',        hint: 'Total players in the lineup' },
      { name: 'black_count',  hint: 'Players in black tops' },
      { name: 'white_count',  hint: 'Players in white tops' },
      { name: 'link',         hint: 'Approval URL' },
      { name: 'fallback_min', hint: 'Force-post offset (minutes before kickoff)' },
    ],
  },
  {
    id: 'team_caption',
    label: 'Team image caption',
    description: 'Short caption attached to the pitch image when teams post.',
    default: DEFAULT_TEAM_CAPTION,
    variables: [
      { name: 'day',          hint: 'Day of the week' },
      { name: 'time',         hint: 'Kickoff time' },
      { name: 'pitch',        hint: 'Pitch label' },
      { name: 'pitch_suffix', hint: 'Pitch with em-dash prefix, or empty' },
      { name: 'pitch_dot',    hint: 'Pitch with " · " prefix, or empty' },
    ],
  },
  {
    id: 'mom_link',
    label: 'MoM vote link post',
    description: 'Group post with the anonymous vote link (when MoM method = vote link).',
    default: DEFAULT_MOM_LINK,
    variables: [
      { name: 'day',     hint: 'Day of the week' },
      { name: 'link',    hint: 'Anonymous vote URL' },
      { name: 'window',  hint: 'How long voting is open ("1 hour", "30 min")' },
    ],
  },
  {
    id: 'mom_results',
    label: 'MoM winner announcement',
    description: 'Posted (or DMed) once voting closes. Has a separate "no votes" branch we keep hardcoded.',
    default: DEFAULT_MOM_RESULTS,
    variables: [
      { name: 'day',              hint: 'Day of the week' },
      { name: 'winner',           hint: 'Winner full name' },
      { name: 'winner_first',     hint: 'Winner first name (for the kicker)' },
      { name: 'winner_votes',     hint: 'Vote count for the winner' },
      { name: 'winner_votes_plural', hint: '"" or "s" for pluralisation' },
      { name: 'runner_up',        hint: 'Runner-up name' },
      { name: 'runner_up_votes',  hint: 'Runner-up vote count' },
      { name: 'total_votes',      hint: 'Total ballots cast' },
      { name: 'runner_up_line',   hint: 'Pre-formatted blank or "\\nRunner-up: …"' },
    ],
  },
];

// ── Substitution + sample preview ──────────────────────────────────────────

/** Replace `{var}` placeholders with values from `vars`. Unknown vars left intact. */
export function applyTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, name) => {
    const v = vars[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

/**
 * Build sample variables for the given session, used for the live preview
 * in SessionEditor. Numbers are plausible defaults so the preview reads
 * like a real message would.
 */
export function sampleVarsForSession(s: SessionSchedule): Record<TemplateId, Record<string, string | number>> {
  const day = DAYS_OF_WEEK[s.kickoff_dow] ?? '?';
  const time = (s.kickoff_time ?? '00:00').slice(0, 5);
  const pitch = s.pitch_label ?? '';
  const pitch_suffix = pitch ? ` — ${pitch}` : '';
  const pitch_dot = pitch ? ` · ${pitch}` : '';
  const target = s.target_players;
  const cancel_floor = s.cancel_below_players ?? s.min_players;
  const signups_in = Math.max(0, cancel_floor - 2);
  const need = Math.max(0, cancel_floor - signups_in);
  const fallback_min = s.team_force_post_minutes_before_kickoff ?? 30;
  const black_count = Math.ceil(target / 2);
  const white_count = target - black_count;
  const winner_votes: number = 5;
  const runner_up_votes: number = 3;
  return {
    confirmation: { day, time, pitch, pitch_suffix, link: 'https://soccer.app/confirm/abc123' },
    nudge: {
      day, time,
      when: `${day} at ${time}`,
      pitch, pitch_suffix,
      signups_in, target, need, cancel_floor,
    },
    auto_cancel: { day, time, pitch, pitch_suffix, signups_in, cancel_floor },
    approval: {
      day, time, pitch, pitch_suffix,
      total: target, black_count, white_count,
      link: 'https://soccer.app/approve/abc123',
      fallback_min,
    },
    team_caption: { day, time, pitch, pitch_suffix, pitch_dot },
    mom_link: { day, link: 'https://soccer.app/mom/abc123', window: '1 hour' },
    mom_results: {
      day,
      winner: 'Sample Player',
      winner_first: 'Sample',
      winner_votes,
      winner_votes_plural: winner_votes === 1 ? '' : 's',
      runner_up: 'Other Player',
      runner_up_votes,
      total_votes: winner_votes + runner_up_votes + 2,
      runner_up_line: `\nRunner-up: Other Player (${runner_up_votes} votes)`,
    },
  };
}

/** Render a sample preview for a given template + session. */
export function renderTemplatePreview(meta: TemplateMeta, session: SessionSchedule, override?: string): string {
  const tpl = (override ?? session[TEMPLATE_COLUMN[meta.id]] as string | null) || meta.default;
  const vars = sampleVarsForSession(session)[meta.id];
  return applyTemplate(tpl, vars);
}
