/**
 * Consolidated session editor — proposed replacement for SessionEditor.
 *
 * Key idea: every automated message is a self-contained card holding its
 * destination, timing, threshold, AND wording. No more cross-section hunting.
 *
 * 5 sections (down from 9):
 *   1. Match basics  — when/where + target/+1s + WhatsApp group
 *   2. Sign-ups      — confirmation, call-out, nudge (cards in chronological order)
 *   3. Team gen      — offset/force-post + AI rules + auto-cancel/approval/team-image cards
 *   4. MoM           — method picker + voting window + link/results wording cards
 *   5. Danger zone   — delete
 *
 * The component reuses the helpers exported from SessionEditor.tsx
 * (MessageDestinationRow, MessageTemplateExpander, etc) so the live preview,
 * tz tagging, and template engine all behave identically — only the
 * arrangement changes.
 */
import React, { useEffect, useState } from 'react';
import { SessionSchedule, SessionScheduleUpdate, DAYS_OF_WEEK } from '../../types/database';
import GroupPicker from './GroupPicker';
import { renderCallOutQuestion, formatDurationMinutes } from '../../lib/sampleMessages';
import { useRegisterDirty } from '../../contexts/DirtyChangesContext';
import { useClub } from '../../contexts/ClubContext';
import { TEMPLATES, TemplateId, TemplateMeta } from '../../lib/messageTemplates';
import {
  inputCls,
  timeInputValue,
  Field,
  Toggle,
  MessageDestination,
  MessageDestinationRow,
  MessageTemplateExpander,
  useLiveTimeIn,
  tzAbbrev,
  TimezoneTag,
} from './SessionEditor';

interface Props {
  schedule: SessionSchedule;
  relayUrl: string | null;
  whatsAppConnected: boolean;
  onSave: (id: string, patch: SessionScheduleUpdate) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

type Draft = Partial<SessionSchedule>;

// ── A self-contained "message card" — destination + when/threshold + wording.
// This is the unit that replaces the old triple of (Automated messages row,
// scattered timing inputs, scattered threshold inputs, separate template editor).
const MessageCard: React.FC<{
  /** Visible label, e.g. "Low-signup nudge" */
  title: string;
  /** Right-side micro-summary line shown when collapsed (e.g. "Same day · 09:00 GST · < 12") */
  summary: string;
  /** Destination row props — set to null to hide the destination buttons (e.g. always-on parts). */
  destination?: {
    value: MessageDestination;
    onChange: (v: MessageDestination) => void;
    dmOnly?: boolean;
    warnWhenGroup?: string;
  };
  /** Helper paragraph shown above the timing/threshold inputs when expanded. */
  desc?: string;
  /** Whether the section starts open. Default false. */
  defaultOpen?: boolean;
  /** Optional template metadata + change handler — renders the wording expander inside the card. */
  template?: { meta: TemplateMeta; session: SessionSchedule; onChange: (v: string | null) => void };
  /** Optional inline body (timing/threshold inputs) shown above the wording expander. */
  children?: React.ReactNode;
}> = ({ title, summary, destination, desc, defaultOpen = false, template, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const isOff = destination?.value === 'off';
  const showWarn = destination?.warnWhenGroup && destination.value === 'group';

  return (
    <div
      className={`rounded-xl border transition-colors ${
        showWarn
          ? 'border-amber-500/40 bg-amber-500/5'
          : isOff
            ? 'border-slate-800 bg-slate-900/20'
            : 'border-slate-700 bg-slate-900/40'
      }`}
    >
      {/* Header: click to toggle. Shows title + summary + a status chip. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-sm font-semibold ${isOff ? 'text-slate-400' : 'text-white'}`}>{title}</span>
            {destination && (
              <span
                className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                  destination.value === 'off'
                    ? 'bg-slate-800 text-slate-400'
                    : destination.value === 'organiser_dm'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-emerald-500/20 text-emerald-200'
                }`}
              >
                {destination.value === 'off' ? 'Off' : destination.value === 'organiser_dm' ? 'DM' : 'Group'}
              </span>
            )}
          </div>
          <div className="text-slate-500 text-[11px] mt-0.5 truncate">{summary}</div>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-slate-500 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-800/60 pt-3">
          {desc && <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>}

          {/* Destination buttons (3-up or 2-up depending on dmOnly). */}
          {destination && (
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${destination.dmOnly ? 2 : 3}, minmax(0, 1fr))` }}
            >
              {(destination.dmOnly
                ? ([
                    { value: 'off', label: 'Off', sub: 'Suppress' },
                    { value: 'organiser_dm', label: 'DM me', sub: 'Sent privately' },
                  ] as const)
                : ([
                    { value: 'off', label: 'Off', sub: 'Suppress' },
                    { value: 'organiser_dm', label: 'DM me', sub: 'Draft to copy' },
                    { value: 'group', label: 'Group', sub: 'Auto-post' },
                  ] as const)
              ).map(c => {
                const selected = destination.value === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => destination.onChange(c.value as MessageDestination)}
                    className={`px-2.5 py-2 rounded-md text-xs font-bold transition-all border ${
                      selected
                        ? c.value === 'off'
                          ? 'bg-slate-800 border-slate-600 text-slate-200'
                          : 'bg-emerald-500/15 border-emerald-500/60 text-emerald-200'
                        : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="uppercase tracking-wider">{c.label}</div>
                    <div className={`text-[9px] mt-0.5 normal-case tracking-normal ${selected ? 'opacity-90' : 'opacity-70'}`}>
                      {c.sub}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {showWarn && destination?.warnWhenGroup && (
            <div className="text-amber-300 text-[11px] font-bold uppercase tracking-wider">
              ⚠ {destination.warnWhenGroup}
            </div>
          )}

          {/* Timing / threshold inputs from caller. */}
          {children}

          {/* Wording editor inline. */}
          {template && (
            <MessageTemplateExpander
              meta={template.meta}
              session={template.session}
              onChange={template.onChange}
            />
          )}
        </div>
      )}
    </div>
  );
};

// ── Top-level section — collapsible. Defaults to closed so the editor opens
// as a tidy 5-row table of contents with the subtitle giving status at a glance,
// matching the SubSection pattern from the classic editor.
const Section: React.FC<{
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <h3 className="text-emerald-400 text-[11px] font-black uppercase tracking-[0.2em]">
            {title}
          </h3>
          {subtitle && (
            <div className="text-slate-500 text-[11px] mt-1 truncate">{subtitle}</div>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-slate-500 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-800/60">{children}</div>
      )}
    </section>
  );
};

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayName(dow: number): string {
  return DOW_NAMES[dow] ?? '?';
}

const SessionEditorV2: React.FC<Props> = ({
  schedule, relayUrl, whatsAppConnected, onSave, onDelete,
}) => {
  const [draft, setDraft] = useState<Draft>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { currentClub } = useClub();
  const tz = currentClub?.timezone ?? null;
  const liveLocal = useLiveTimeIn(tz);
  const tzAbbr = tzAbbrev(tz);

  useEffect(() => { setDraft({}); }, [schedule.id]);

  const merged: SessionSchedule = { ...schedule, ...draft };
  const isDirty = Object.keys(draft).length > 0;

  const set = <K extends keyof SessionSchedule>(k: K, v: SessionSchedule[K]) => {
    setDraft(prev => ({ ...prev, [k]: v }));
  };

  useRegisterDirty(
    `session:${schedule.id}`,
    schedule.name || 'session',
    isDirty,
    async () => {
      if (!isDirty) return true;
      const ok = await onSave(schedule.id, draft);
      if (ok) setDraft({});
      return ok;
    },
    () => setDraft({}),
  );

  const getTpl = (id: TemplateId): TemplateMeta => TEMPLATES.find(t => t.id === id)!;

  const tzSuffix = tzAbbr ? ` ${tzAbbr}` : '';
  const calloutTime = `${timeInputValue(merged.weekly_post_time)}${tzSuffix}`;
  const confirmTime = `${timeInputValue(merged.confirmation_time)}${tzSuffix}`;
  const nudgeTime = `${timeInputValue(merged.nudge_time)}${tzSuffix}`;
  const kickoffTime = `${timeInputValue(merged.kickoff_time)}${tzSuffix}`;

  return (
    <div className="space-y-6 p-4 bg-slate-950/40 rounded-xl">
      {/* Identity row — same as classic */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={merged.name}
          onChange={e => set('name', e.target.value)}
          placeholder="Session name"
          className={`${inputCls} flex-1 min-w-[200px] text-base font-semibold`}
        />
        <Toggle
          checked={merged.enabled}
          onChange={v => set('enabled', v)}
          label={merged.enabled ? 'Enabled' : 'Disabled'}
        />
      </div>

      {/* Timezone banner — every time below is interpreted in this tz */}
      {tz && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-[12px]">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-emerald-300 font-bold uppercase tracking-wider text-[10px]">
              All times in
            </span>
            <span className="text-white font-semibold">{tz}</span>
            {tzAbbr && <span className="text-slate-400">({tzAbbr})</span>}
          </div>
          <div className="text-slate-400">
            now: <span className="text-emerald-200 font-mono">{liveLocal}</span>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* 1 · MATCH BASICS                                                    */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <Section
        title="1 · Match basics"
        subtitle={`${DAYS_OF_WEEK[merged.kickoff_dow]} ${kickoffTime}${merged.pitch_label ? ` · ${merged.pitch_label}` : ''} · target ${merged.target_players}`}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Game day">
            <select
              value={merged.kickoff_dow}
              onChange={e => set('kickoff_dow', Number(e.target.value))}
              className={inputCls}
            >
              {DAYS_OF_WEEK.map((d, i) => (
                <option key={d} value={i}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label={<>Kickoff <TimezoneTag tz={tz} /></>}>
            <input
              type="time"
              value={timeInputValue(merged.kickoff_time)}
              onChange={e => set('kickoff_time', e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Pitch / venue label" hint="Shown in the call-out post.">
          <input
            type="text"
            value={merged.pitch_label ?? ''}
            onChange={e => set('pitch_label', e.target.value || null)}
            placeholder="e.g. Hackney Marshes pitch 4"
            className={inputCls}
          />
        </Field>

        <Field label="Target players" hint="Ideal squad size — the call-out poll asks for this many.">
          <input
            type="number" min={2} max={50}
            value={merged.target_players}
            onChange={e => set('target_players', Number(e.target.value))}
            className={inputCls}
          />
        </Field>

        <Toggle
          checked={merged.allow_plus_ones}
          onChange={v => set('allow_plus_ones', v)}
          label="Allow +1 / guest signups"
        />
        {merged.allow_plus_ones && (
          <Toggle
            checked={merged.plus_ones_count_toward_target}
            onChange={v => set('plus_ones_count_toward_target', v)}
            label="+1s count toward target"
          />
        )}

        <Field label="WhatsApp group" hint="Where call-out polls and team posts go (when their destination is 'Group').">
          <GroupPicker
            relayUrl={relayUrl}
            connected={whatsAppConnected}
            selectedJid={merged.whatsapp_group_jid ?? null}
            selectedName={merged.whatsapp_group_name ?? null}
            onChange={(jid, name) =>
              setDraft(prev => ({ ...prev, whatsapp_group_jid: jid, whatsapp_group_name: name }))
            }
          />
        </Field>
      </Section>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* 2 · SIGN-UPS                                                        */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <Section
        title="2 · Sign-ups"
        subtitle="The flow that gets people to commit, in order"
      >
        {/* Confirmation DM */}
        <MessageCard
          title="Confirmation DM"
          summary={
            merged.confirmation_destination === 'off'
              ? 'Off'
              : `${merged.confirmation_days_before === 0 ? 'Same day' : `${merged.confirmation_days_before}d before`} call-out · ${confirmTime}`
          }
          destination={{
            value: (merged.confirmation_destination ?? 'organiser_dm') as MessageDestination,
            onChange: v => set('confirmation_destination', v as 'off' | 'organiser_dm'),
            dmOnly: true,
          }}
          desc="A short DM to you the day before the call-out so you can skip the week if needed."
          template={{ meta: getTpl('confirmation'), session: merged, onChange: v => set('confirmation_template', v) }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Days before call-out">
              <input
                type="number" min={0} max={14}
                value={merged.confirmation_days_before}
                onChange={e => set('confirmation_days_before', Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field label={<>Time <TimezoneTag tz={tz} /></>}>
              <input
                type="time"
                value={timeInputValue(merged.confirmation_time)}
                onChange={e => set('confirmation_time', e.target.value || null)}
                className={inputCls}
              />
            </Field>
          </div>
        </MessageCard>

        {/* Call-out poll */}
        <MessageCard
          title="Call-out poll"
          summary={
            merged.callout_destination === 'off'
              ? 'Off'
              : `${dayName(merged.weekly_post_dow)} · ${calloutTime} · ${(merged.callout_poll_options ?? []).length} options`
          }
          destination={{
            value: (merged.callout_destination ?? 'group') as MessageDestination,
            onChange: v => set('callout_destination', v),
          }}
          desc='The weekly "Are you in?" poll. DM mode sends question + options to you to recreate manually — heads up: when DMed, signup tracking won’t work automatically.'
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Call-out day">
              <select
                value={merged.weekly_post_dow}
                onChange={e => set('weekly_post_dow', Number(e.target.value))}
                className={inputCls}
              >
                {DAYS_OF_WEEK.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </Field>
            <Field label={<>Time <TimezoneTag tz={tz} /></>}>
              <input
                type="time"
                value={timeInputValue(merged.weekly_post_time)}
                onChange={e => set('weekly_post_time', e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <Field
            label="Question"
            hint="Placeholders: {day} {time} {pitch} {pitch_suffix} {target} — replaced when the poll is sent."
          >
            <input
              type="text"
              value={merged.callout_poll_question ?? ''}
              onChange={e => set('callout_poll_question', e.target.value)}
              placeholder="⚽ Football {day} at {time}{pitch_suffix}. Need {target}. Are you in?"
              maxLength={255}
              className={inputCls}
            />
          </Field>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
            <div className="text-slate-500 text-[10px] font-black uppercase tracking-wider mb-1">
              Preview
            </div>
            <div className="text-emerald-100">{renderCallOutQuestion(merged)}</div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label className="block text-slate-300 text-[10px] font-black uppercase tracking-wider">
                Vote options ({(merged.callout_poll_options ?? []).length}/12)
              </label>
              <span className="text-slate-500 text-[10px]">2–12 · WhatsApp limit</span>
            </div>
            <ul className="space-y-2">
              {(merged.callout_poll_options ?? []).map((opt, i) => {
                const opts = merged.callout_poll_options ?? [];
                return (
                  <li key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={e => {
                        const next = [...opts];
                        next[i] = e.target.value;
                        set('callout_poll_options', next);
                      }}
                      placeholder={`Option ${i + 1}`}
                      maxLength={100}
                      className={`${inputCls} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        set('callout_poll_options', opts.filter((_, idx) => idx !== i))
                      }
                      disabled={opts.length <= 2}
                      className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-500 hover:text-rose-400 rounded-lg border border-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Remove option"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => {
                const opts = merged.callout_poll_options ?? [];
                if (opts.length >= 12) return;
                set('callout_poll_options', [...opts, '']);
              }}
              disabled={(merged.callout_poll_options ?? []).length >= 12}
              className="mt-2 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg text-[11px] font-semibold border border-slate-800 disabled:opacity-40"
            >
              + Add option
            </button>
          </div>
        </MessageCard>

        {/* Nudge */}
        <MessageCard
          title="Low-signup nudge"
          summary={
            merged.nudge_destination === 'off'
              ? 'Off'
              : `${merged.nudge_days_before === 0 ? 'Same day' : `${merged.nudge_days_before}d before`} · ${nudgeTime} · if signups < ${merged.nudge_below_players}`
          }
          destination={{
            value: (merged.nudge_destination ?? 'group') as MessageDestination,
            onChange: v => set('nudge_destination', v),
          }}
          desc="A reminder pinging the group when signups are low. DM mode sends you a draft to copy/paste."
          template={{ meta: getTpl('nudge'), session: merged, onChange: v => set('nudge_template', v) }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Days before kickoff" hint="0 = same day">
              <input
                type="number" min={0} max={14} step={1}
                value={merged.nudge_days_before}
                onChange={e => set('nudge_days_before', Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field label={<>Time <TimezoneTag tz={tz} /></>}>
              <input
                type="time"
                value={timeInputValue(merged.nudge_time)}
                onChange={e => set('nudge_time', e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <Field
            label="Send if signups below this many"
            hint={`Only fires while signups stay under this. One nudge per week.`}
          >
            <input
              type="number" min={0} max={50}
              value={merged.nudge_below_players}
              onChange={e => {
                const v = Number(e.target.value);
                set('nudge_below_players', v);
                // Keep cancel ≤ nudge invariant.
                if (merged.cancel_below_players > v) set('cancel_below_players', v);
              }}
              className={inputCls}
            />
          </Field>
        </MessageCard>
      </Section>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* 3 · TEAM GENERATION                                                 */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <Section
        title="3 · Team generation"
        subtitle={
          `${merged.team_gen_offset_hours}h before` +
          (merged.approval_destination === 'off'
            ? ' · teams auto-post (no approval needed)'
            : ` · approval via DM${
                (merged.team_force_post_minutes_before_kickoff ?? 30) > 0
                  ? `, fallback at T-${merged.team_force_post_minutes_before_kickoff ?? 30}min`
                  : ', no fallback'
              }`) +
          ((merged.team_gen_instructions ?? '').trim() ? ' · custom rules' : '')
        }
      >
        {/* Common settings */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-3 space-y-3">
          <Field
            label={<>Generate teams — hours before kickoff <TimezoneTag tz={tz} /></>}
            hint="Auto-cancel check + lineup creation + approval DM all fire at this offset."
          >
            <input
              type="number" min={0} max={72} step={0.25}
              value={merged.team_gen_offset_hours}
              onChange={e => set('team_gen_offset_hours', Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Custom rules for the AI" hint="Free-text instructions the balancer follows for this session.">
            <textarea
              rows={4}
              value={merged.team_gen_instructions ?? ''}
              onChange={e => set('team_gen_instructions', e.target.value || null)}
              placeholder={
                'e.g.\n- Always put John in black tops\n- Don\'t put Mike and Sam on the same team\n- Rotate goalkeepers if possible'
              }
              className={`${inputCls} font-mono text-xs leading-relaxed`}
            />
          </Field>
        </div>

        {/* Auto-cancel */}
        <MessageCard
          title="Auto-cancel"
          summary={
            merged.auto_cancel_destination === 'off'
              ? 'Off — never auto-cancels'
              : `If signups < ${merged.cancel_below_players} at team-gen time`
          }
          destination={{
            value: (merged.auto_cancel_destination ?? 'off') as MessageDestination,
            onChange: v => set('auto_cancel_destination', v),
            warnWhenGroup: 'Will auto-post a "called off" message to your group if signups drop below the floor',
          }}
          desc='Group: bot posts "called off" + cancels the session. DM me: bot DMs you a draft + still marks cancelled. Off: never auto-cancels.'
          template={{ meta: getTpl('auto_cancel'), session: merged, onChange: v => set('auto_cancel_template', v) }}
        >
          <Field
            label="Call the game off below this many"
            hint={`Must be ≤ nudge threshold (${merged.nudge_below_players}).`}
          >
            <input
              type="number" min={0} max={merged.nudge_below_players}
              value={merged.cancel_below_players}
              onChange={e => set('cancel_below_players', Number(e.target.value))}
              className={inputCls}
            />
          </Field>
        </MessageCard>

        {/* Approval DM — destination IS the control. 'Off' = no approval flow,
            teams post directly. 'DM me' = require approval, DM goes out, optional
            fallback if you don't tap. team_gen_require_approval is auto-synced
            here so it's never out of step with destination. */}
        <MessageCard
          title="Lineup approval DM"
          summary={
            merged.approval_destination === 'off'
              ? 'Off — teams post directly when generated'
              : (merged.team_force_post_minutes_before_kickoff ?? 30) > 0
                ? `${merged.team_gen_offset_hours}h before kickoff · fallback at T-${merged.team_force_post_minutes_before_kickoff ?? 30}min`
                : `${merged.team_gen_offset_hours}h before kickoff · no fallback (approval required)`
          }
          destination={{
            value: (merged.approval_destination ?? 'organiser_dm') as MessageDestination,
            onChange: v => {
              const next = v as 'off' | 'organiser_dm';
              set('approval_destination', next);
              // Auto-sync the legacy require-approval boolean so the runtime gate
              // matches the user's mental model: Off = no approval flow at all.
              set('team_gen_require_approval', next !== 'off');
            },
            dmOnly: true,
          }}
          desc={
            merged.approval_destination === 'off'
              ? 'Teams will be auto-balanced at the offset above and posted directly via the Team image post card below — no approval step.'
              : "DM with a link to preview/edit/approve the auto-balanced lineup before it posts. Without your approval, the lineup waits — set the fallback below if you'd like a safety net."
          }
          template={{ meta: getTpl('approval'), session: merged, onChange: v => set('approval_template', v) }}
        >
          {merged.approval_destination !== 'off' && (
            <div className="space-y-3 pt-1">
              <Toggle
                checked={(merged.team_force_post_minutes_before_kickoff ?? 30) > 0}
                onChange={v =>
                  // Toggle on → 30 (sensible default). Toggle off → 0, which the
                  // runtime treats as "never auto-post; wait for me forever".
                  set('team_force_post_minutes_before_kickoff', v ? 30 : 0)
                }
                label="If I don't approve in time, post the auto-balanced lineup anyway"
                hint={
                  (merged.team_force_post_minutes_before_kickoff ?? 30) > 0
                    ? 'Safety net: the lineup is promoted to confirmed and shared via the Team image post card below. Use this if a forgotten approval would mean nobody knows the teams.'
                    : 'Off: the lineup waits for your approval indefinitely. If you forget, no team image gets posted.'
                }
              />
              {(merged.team_force_post_minutes_before_kickoff ?? 30) > 0 && (
                <Field
                  label={<>Minutes before kickoff <TimezoneTag tz={tz} /></>}
                  hint={`30 is a safe default (last call to react). Lower = closer to kickoff = less time to react.`}
                >
                  <input
                    type="number" min={1} max={1440} step={1}
                    value={merged.team_force_post_minutes_before_kickoff ?? 30}
                    onChange={e => set('team_force_post_minutes_before_kickoff', Math.max(1, Number(e.target.value)))}
                    className={inputCls}
                  />
                </Field>
              )}
            </div>
          )}
        </MessageCard>

        {/* Team image post */}
        <MessageCard
          title="Team image post"
          summary={
            merged.team_post_destination === 'off'
              ? 'Off — lineup ready but not auto-shared'
              : 'When the lineup is confirmed (or force-posted)'
          }
          destination={{
            value: (merged.team_post_destination ?? 'group') as MessageDestination,
            onChange: v => set('team_post_destination', v),
          }}
          desc="The pitch image showing the two balanced teams. DM mode sends the image to you to forward. The caption text is editable below."
          template={{ meta: getTpl('team_caption'), session: merged, onChange: v => set('team_caption_template', v) }}
        />
      </Section>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* 4 · MAN OF THE MATCH                                                */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <Section
        title="4 · Man of the Match"
        subtitle={
          merged.mom_enabled
            ? `${formatDurationMinutes(merged.mom_results_post_minutes)} window · ${
                merged.mom_method === 'web_link'
                  ? `vote link (${
                      merged.mom_link_destination === 'organiser_dm'
                        ? 'DM me'
                        : merged.mom_link_destination === 'off'
                          ? 'off'
                          : 'group'
                    })`
                  : merged.mom_method === 'whatsapp_poll'
                    ? 'WhatsApp poll'
                    : 'organiser DM'
              }`
            : 'Off'
        }
      >
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-3 space-y-3">
          <Toggle
            checked={merged.mom_enabled}
            onChange={v => set('mom_enabled', v)}
            label="Run a MoM vote after each match"
          />
          {merged.mom_enabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Match duration (min)">
                  <input
                    type="number" min={5} max={480} step={5}
                    value={merged.match_duration_minutes}
                    onChange={e => set('match_duration_minutes', Number(e.target.value))}
                    className={inputCls}
                  />
                </Field>
                <Field label="Send delay after match (min)">
                  <input
                    type="number" min={0} max={1440} step={5}
                    value={merged.mom_delay_minutes}
                    onChange={e => set('mom_delay_minutes', Number(e.target.value))}
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="How to collect votes">
                <div className="space-y-2">
                  {/* `whatsapp_poll` (per-player DM polls) is intentionally not
                      exposed — its aggregation is unreliable. The runtime still
                      handles existing rows that have it set; it just isn't
                      presented as a fresh choice anywhere. */}
                  {([
                    { value: 'web_link', label: 'Vote link', tagline: 'Recommended', desc: 'One anonymous link posted to the group. Players tap, pick, done. One vote per device.' },
                    { value: 'organiser_dm', label: 'Organiser DM', tagline: 'No group needed', desc: "One poll DM'd to you with all players as options. You decide. Use when there's no WhatsApp group." },
                  ] as const).map(opt => {
                    const selected = merged.mom_method === opt.value;
                    return (
                      <button
                        type="button"
                        key={opt.value}
                        onClick={() => set('mom_method', opt.value)}
                        className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                          selected ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${selected ? 'border-emerald-400 bg-emerald-400' : 'border-slate-600'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className={`text-sm font-medium ${selected ? 'text-white' : 'text-slate-300'}`}>{opt.label}</span>
                              <span className={`text-[10px] font-black uppercase tracking-[0.15em] ${
                                opt.tagline === 'Recommended' ? 'text-emerald-400' : 'text-slate-500'
                              }`}>{opt.tagline}</span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1 leading-snug">{opt.desc}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Voting window (minutes)">
                <input
                  type="number" min={0} max={10080} step={5}
                  value={merged.mom_results_post_minutes}
                  onChange={e => set('mom_results_post_minutes', Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
            </>
          )}
        </div>

        {merged.mom_enabled && merged.mom_method === 'web_link' && (
          <MessageCard
            title="MoM vote-link post"
            summary={
              merged.mom_link_destination === 'off'
                ? 'Off — link in runtime logs only; you share manually'
                : merged.mom_link_destination === 'organiser_dm'
                  ? 'DMed to you as a draft to copy/paste'
                  : 'Posted directly to the group'
            }
            destination={{
              value: (merged.mom_link_destination ?? 'group') as MessageDestination,
              onChange: v => set('mom_link_destination', v),
            }}
            desc="The post containing the anonymous vote link. DM mode sends you the draft so you can share it manually — votes still aggregate the same way."
            template={{ meta: getTpl('mom_link'), session: merged, onChange: v => set('mom_link_template', v) }}
          />
        )}

        {merged.mom_enabled && (
          <MessageCard
            title="MoM winner announcement"
            summary={
              merged.mom_results_destination === 'off'
                ? 'Off — tally only stored in DB'
                : `${merged.mom_results_post_minutes} min after the MoM message`
            }
            destination={{
              value: (merged.mom_results_destination ?? 'group') as MessageDestination,
              onChange: v => set('mom_results_destination', v),
            }}
            desc="The post announcing the winner + runner-up once voting closes."
            template={{ meta: getTpl('mom_results'), session: merged, onChange: v => set('mom_results_template', v) }}
          />
        )}
      </Section>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* 5 · DANGER ZONE                                                     */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <Section title="5 · Danger zone">
        <div className="flex items-center justify-end gap-3 pt-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-rose-300 text-xs font-semibold">Delete this session?</span>
              <button
                type="button"
                onClick={() => onDelete(schedule.id)}
                className="px-3 py-1.5 bg-rose-500 hover:bg-rose-400 text-white rounded-lg text-[11px] font-black uppercase tracking-wider"
              >
                Yes, delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-semibold"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-rose-400 hover:text-rose-300 text-xs font-semibold"
            >
              Delete session
            </button>
          )}
        </div>
      </Section>
    </div>
  );
};

export default SessionEditorV2;
