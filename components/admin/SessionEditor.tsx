import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SessionSchedule, SessionScheduleUpdate, DAYS_OF_WEEK } from '../../types/database';
import GroupPicker from './GroupPicker';
import { renderCallOutQuestion, formatDurationMinutes } from '../../lib/sampleMessages';
import { useRegisterDirty } from '../../contexts/DirtyChangesContext';
import { useClub } from '../../contexts/ClubContext';
import {
  TEMPLATES,
  TEMPLATE_COLUMN,
  TemplateId,
  TemplateMeta,
  renderTemplatePreview,
} from '../../lib/messageTemplates';

interface SessionEditorProps {
  schedule: SessionSchedule;
  relayUrl: string | null;
  whatsAppConnected: boolean;
  onSave: (id: string, patch: SessionScheduleUpdate) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

type Draft = Partial<SessionSchedule>;

function timeInputValue(t: string | null | undefined): string {
  if (!t) return '';
  return t.length >= 5 ? t.substring(0, 5) : t;
}

const inputCls =
  'w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors';

interface SubSectionProps {
  title: string;
  /** Read-only one-liner shown when the sub-section is collapsed. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const SubSection: React.FC<SubSectionProps> = ({
  title,
  summary,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`rounded-lg border transition-colors ${
        open ? 'border-slate-700 bg-slate-900/40' : 'border-slate-800 bg-slate-900/20'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <h4 className="text-slate-200 text-[11px] font-black uppercase tracking-widest">
            {title}
          </h4>
          {!open && summary && (
            <div className="text-slate-500 text-[11px] mt-0.5 truncate">{summary}</div>
          )}
        </div>
        <svg
          className={`w-3.5 h-3.5 text-slate-500 transition-transform flex-shrink-0 ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );
};

const Field: React.FC<{ label: React.ReactNode; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <div>
    <label className="block text-slate-300 text-[10px] font-black uppercase tracking-wider mb-1.5">
      {label}
    </label>
    {children}
    {hint && <p className="text-slate-500 text-[11px] mt-1">{hint}</p>}
  </div>
);

const Toggle: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}> = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-3 cursor-pointer select-none">
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
        checked ? 'bg-emerald-500' : 'bg-slate-700'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
    <div className="flex-1">
      <div className="text-white text-sm font-semibold">{label}</div>
      {hint && <div className="text-slate-500 text-xs mt-0.5">{hint}</div>}
    </div>
  </label>
);

/**
 * Per-message destination row used in the "Automated messages" panel. Three
 * choices — Off / DM organiser / Send to group — except for messages that
 * inherently can't go to the group (confirmation, approval), which only get
 * Off and DM.
 */
type MessageDestination = 'off' | 'group' | 'organiser_dm';

const MessageDestinationRow: React.FC<{
  value: MessageDestination;
  onChange: (v: MessageDestination) => void;
  label: string;
  timing: string;
  desc: string;
  /** When true, suppresses the "group" choice (DM-only messages). */
  dmOnly?: boolean;
  /** Caller-supplied warn-when-on label, e.g. for auto-cancel. */
  warnWhenGroup?: string;
}> = ({ value, onChange, label, timing, desc, dmOnly, warnWhenGroup }) => {
  const choices: { value: MessageDestination; label: string; sub?: string }[] = dmOnly
    ? [
        { value: 'off',           label: 'Off' },
        { value: 'organiser_dm',  label: 'DM me',     sub: 'Sent privately' },
      ]
    : [
        { value: 'off',           label: 'Off' },
        { value: 'organiser_dm',  label: 'DM me',     sub: 'Copy/paste' },
        { value: 'group',         label: 'Group',     sub: 'Auto-post' },
      ];

  const isOn = value !== 'off';
  const showWarn = warnWhenGroup && value === 'group';

  return (
    <div
      className={`px-3 py-3 rounded-lg border transition-colors ${
        showWarn
          ? 'border-amber-500/40 bg-amber-500/5'
          : isOn
            ? 'border-slate-700 bg-slate-900/40'
            : 'border-slate-800 bg-slate-900/20 opacity-80'
      }`}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-white text-sm font-semibold">{label}</span>
      </div>
      <div className="text-emerald-400/70 text-[11px] mt-0.5 font-medium">{timing}</div>
      <div className="text-slate-400 text-xs mt-1 leading-snug">{desc}</div>
      <div className="grid gap-1.5 mt-3" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
        {choices.map(c => {
          const selected = value === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => onChange(c.value)}
              className={`px-2.5 py-2 rounded-md text-xs font-bold transition-all border ${
                selected
                  ? c.value === 'off'
                    ? 'bg-slate-800 border-slate-600 text-slate-200'
                    : c.value === 'organiser_dm'
                      ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-200'
                      : 'bg-emerald-500/15 border-emerald-500/60 text-emerald-200'
                  : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="uppercase tracking-wider">{c.label}</div>
              {c.sub && (
                <div className={`text-[9px] mt-0.5 normal-case tracking-normal ${selected ? 'opacity-90' : 'opacity-70'}`}>
                  {c.sub}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {showWarn && (
        <div className="text-amber-300 text-[11px] font-bold mt-2 uppercase tracking-wider">
          ⚠ {warnWhenGroup}
        </div>
      )}
    </div>
  );
};

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayName(dow: number): string {
  return DOW_NAMES[dow] ?? '?';
}

// ── Timezone helpers ──────────────────────────────────────────────────────
// Live-ticking HH:mm in the given IANA tz, used in the "All times in X" banner
// at the top of the editor so the organiser is never guessing.
function useLiveTimeIn(tz: string | null): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!tz) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    return '';
  }
}

/** Compact timezone abbreviation, e.g. "GST" / "BST" / "GMT+4". */
function tzAbbrev(tz: string | null): string {
  if (!tz) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/**
 * Suffix shown next to every <input type="time"> so it's unambiguous which
 * timezone the value is being interpreted in. Renders e.g. "in Asia/Dubai (GST)".
 */
const TimezoneTag: React.FC<{ tz: string | null }> = ({ tz }) => {
  if (!tz) return null;
  const abbr = tzAbbrev(tz);
  return (
    <span className="text-slate-500 text-[10px] font-medium ml-2">
      in <span className="text-slate-300">{tz}</span>
      {abbr && <span className="text-slate-500"> ({abbr})</span>}
    </span>
  );
};

// ── Per-message template editor ───────────────────────────────────────────
// Collapsible "Customise wording" expander shown beneath each
// MessageDestinationRow. NULL value = use built-in default.
const MessageTemplateExpander: React.FC<{
  meta: TemplateMeta;
  session: SessionSchedule;
  onChange: (next: string | null) => void;
}> = ({ meta, session, onChange }) => {
  const column = TEMPLATE_COLUMN[meta.id];
  const value = (session[column] as string | null) ?? null;
  const isCustom = value !== null && value.trim().length > 0;
  const [open, setOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Live-rendered preview using sample values
  const preview = useMemo(() => {
    const tpl = (value ?? meta.default);
    return renderTemplatePreview(meta, session, tpl);
  }, [value, meta, session]);

  /** Insert `{var}` at the textarea cursor, leaving focus where it lands. */
  const insertVar = (varName: string) => {
    const ta = taRef.current;
    const current = value ?? meta.default;
    if (!ta) {
      onChange(current + `{${varName}}`);
      return;
    }
    const start = ta.selectionStart ?? current.length;
    const end = ta.selectionEnd ?? current.length;
    const next = current.slice(0, start) + `{${varName}}` + current.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const cursor = start + varName.length + 2;
      ta.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-300 transition-colors flex items-center gap-1.5"
      >
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {open ? 'Hide wording' : 'Customise wording'}
        {isCustom && (
          <span className="text-[9px] font-black px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded uppercase tracking-widest">
            Custom
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-2 pl-4 border-l-2 border-slate-800">
          <div>
            <div className="text-slate-500 text-[10px] font-black uppercase tracking-wider mb-1">
              Available variables
            </div>
            <div className="flex flex-wrap gap-1">
              {meta.variables.map(v => (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => insertVar(v.name)}
                  title={v.hint}
                  className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-900 hover:bg-emerald-500/15 border border-slate-800 hover:border-emerald-500/40 text-slate-300 hover:text-emerald-200 rounded transition-colors"
                >
                  {`{${v.name}}`}
                </button>
              ))}
            </div>
            <div className="text-slate-500 text-[10px] mt-1">
              Click a variable to insert at the cursor.
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="text-slate-300 text-[10px] font-black uppercase tracking-wider">
                Message template
              </label>
              {isCustom && (
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  className="text-[10px] text-slate-500 hover:text-rose-300 underline"
                  title="Revert to the built-in default"
                >
                  Reset to default
                </button>
              )}
            </div>
            <textarea
              ref={taRef}
              rows={Math.max(4, ((value ?? meta.default).match(/\n/g)?.length ?? 0) + 2)}
              value={value ?? meta.default}
              onChange={e => {
                const next = e.target.value;
                // Empty / unchanged-from-default → revert to NULL so future
                // default tweaks apply automatically.
                onChange(next === meta.default || next.trim() === '' ? null : next);
              }}
              className={`${inputCls} font-mono text-xs leading-relaxed`}
              placeholder={meta.default}
            />
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
            <div className="text-slate-500 text-[10px] font-black uppercase tracking-wider mb-1">
              Preview · sample values
            </div>
            <div className="text-emerald-100 whitespace-pre-wrap font-sans">{preview}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const SessionEditor: React.FC<SessionEditorProps> = ({
  schedule,
  relayUrl,
  whatsAppConnected,
  onSave,
  onDelete,
}) => {
  const [draft, setDraft] = useState<Draft>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { currentClub } = useClub();
  const tz = currentClub?.timezone ?? null;
  const liveLocal = useLiveTimeIn(tz);
  const tzAbbr = tzAbbrev(tz);

  useEffect(() => {
    setDraft({});
  }, [schedule.id]);

  const merged: SessionSchedule = { ...schedule, ...draft };
  const isDirty = Object.keys(draft).length > 0;

  const set = <K extends keyof SessionSchedule>(k: K, v: SessionSchedule[K]) => {
    setDraft(prev => ({ ...prev, [k]: v }));
  };

  /** Look up template metadata by id — small helper for the per-row inline expander. */
  const getTemplate = (id: TemplateId): TemplateMeta =>
    TEMPLATES.find(t => t.id === id)!;

  // Register with the page-level Save bar
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
    () => setDraft({})
  );

  return (
    <div className="space-y-6 p-4 bg-slate-950/40 rounded-xl">
      {/* Identity row */}
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

      {/* Timezone banner — every time field below is interpreted in this tz */}
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

      {/* Schedule */}
      <SubSection
        title="Schedule"
        summary={
          <>
            {DAYS_OF_WEEK[merged.kickoff_dow]} {timeInputValue(merged.kickoff_time)}
            {tzAbbr && <span className="text-slate-600"> {tzAbbr}</span>}
            {merged.pitch_label ? ` · ${merged.pitch_label}` : ''}
            {' · call-out '}
            {DAYS_OF_WEEK[merged.weekly_post_dow]} {timeInputValue(merged.weekly_post_time)}
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Game day">
            <select
              value={merged.kickoff_dow}
              onChange={e => set('kickoff_dow', Number(e.target.value))}
              className={inputCls}
            >
              {DAYS_OF_WEEK.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
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
          <Field label="Call-out day">
            <select
              value={merged.weekly_post_dow}
              onChange={e => set('weekly_post_dow', Number(e.target.value))}
              className={inputCls}
            >
              {DAYS_OF_WEEK.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label={<>Call-out time <TimezoneTag tz={tz} /></>}>
            <input
              type="time"
              value={timeInputValue(merged.weekly_post_time)}
              onChange={e => set('weekly_post_time', e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Pitch / venue label" hint="Shown in the signup post">
          <input
            type="text"
            value={merged.pitch_label ?? ''}
            onChange={e => set('pitch_label', e.target.value || null)}
            placeholder="e.g. Hackney Marshes pitch 4"
            className={inputCls}
          />
        </Field>
      </SubSection>

      {/* Automated messages — destination per outbound message */}
      <SubSection
        title="Automated messages"
        summary={(() => {
          const dests: MessageDestination[] = [
            (merged.confirmation_destination ?? 'organiser_dm') as MessageDestination,
            (merged.callout_destination ?? 'group') as MessageDestination,
            (merged.nudge_destination ?? 'group') as MessageDestination,
            (merged.auto_cancel_destination ?? 'off') as MessageDestination,
            (merged.approval_destination ?? 'organiser_dm') as MessageDestination,
            (merged.team_post_destination ?? 'group') as MessageDestination,
            (merged.mom_results_destination ?? 'group') as MessageDestination,
          ];
          const on = dests.filter(d => d !== 'off').length;
          const dm = dests.filter(d => d === 'organiser_dm').length;
          return `${on}/${dests.length} on${dm > 0 ? ` · ${dm} via DM` : ''}`;
        })()}
        defaultOpen
      >
        <p className="text-xs text-slate-500 leading-relaxed -mt-2">
          Every automated message. <span className="text-emerald-400 font-bold">DM me</span> sends it privately for you to copy/paste manually. <span className="text-emerald-400 font-bold">Group</span> posts it directly. <span className="text-slate-400 font-bold">Off</span> suppresses the message.
        </p>
        <div className="space-y-2">
          <div>
            <MessageDestinationRow
              value={(merged.confirmation_destination ?? 'organiser_dm') as MessageDestination}
              onChange={v => set('confirmation_destination', v as 'off' | 'organiser_dm')}
              label="Confirmation DM"
              timing={`${merged.confirmation_days_before}d before call-out at ${merged.confirmation_time?.slice(0, 5) ?? '—'}${tzAbbr ? ` ${tzAbbr}` : ''}`}
              desc="A short DM the day before the call-out so you can cancel that week if needed."
              dmOnly
            />
            <MessageTemplateExpander
              meta={getTemplate('confirmation')}
              session={merged}
              onChange={v => set('confirmation_template', v)}
            />
          </div>
          <div>
            <MessageDestinationRow
              value={(merged.callout_destination ?? 'group') as MessageDestination}
              onChange={v => set('callout_destination', v)}
              label="Call-out poll"
              timing={`${dayName(merged.weekly_post_dow)} at ${merged.weekly_post_time?.slice(0, 5) ?? '—'}${tzAbbr ? ` ${tzAbbr}` : ''}`}
              desc={'The weekly "Are you in?" poll. DM mode sends the question + options to you to recreate manually — heads up: when DMed, signup tracking won\'t work automatically.'}
            />
            <div className="text-[10px] text-slate-500 leading-snug mt-2 pl-3">
              The call-out poll question is editable in the <span className="font-semibold text-slate-400">Call-out poll</span> section below — it's a poll, not a free-text message.
            </div>
          </div>
          <div>
            <MessageDestinationRow
              value={(merged.nudge_destination ?? 'group') as MessageDestination}
              onChange={v => set('nudge_destination', v)}
              label="Low-signup nudge"
              timing={`${merged.nudge_days_before === 0 ? 'Same day' : `${merged.nudge_days_before}d before`} at ${merged.nudge_time?.slice(0, 5) ?? '—'}${tzAbbr ? ` ${tzAbbr}` : ''} (if signups < ${merged.nudge_below_players})`}
              desc="A reminder pinging the group when signups are low. DM mode sends you a draft to copy/paste."
            />
            <MessageTemplateExpander
              meta={getTemplate('nudge')}
              session={merged}
              onChange={v => set('nudge_template', v)}
            />
          </div>
          <div>
            <MessageDestinationRow
              value={(merged.auto_cancel_destination ?? 'off') as MessageDestination}
              onChange={v => set('auto_cancel_destination', v)}
              label="Auto-cancel"
              timing={`At team-gen time (${merged.team_gen_offset_hours}h before kickoff) if signups < ${merged.cancel_below_players}`}
              desc='Group: bot posts "called off" + cancels the session automatically. DM me: bot DMs you a draft + still marks cancelled internally. Off: never auto-cancels.'
              warnWhenGroup='Will auto-post a "called off" message to your group if signups drop below the floor'
            />
            <MessageTemplateExpander
              meta={getTemplate('auto_cancel')}
              session={merged}
              onChange={v => set('auto_cancel_template', v)}
            />
          </div>
          <div>
            <MessageDestinationRow
              value={(merged.approval_destination ?? 'organiser_dm') as MessageDestination}
              onChange={v => set('approval_destination', v as 'off' | 'organiser_dm')}
              label="Lineup approval DM"
              timing={`${merged.team_gen_offset_hours}h before kickoff (only if approval is required)`}
              desc="A DM with a link to preview/edit/approve the auto-balanced lineup before it posts."
              dmOnly
            />
            <MessageTemplateExpander
              meta={getTemplate('approval')}
              session={merged}
              onChange={v => set('approval_template', v)}
            />
          </div>
          <div>
            <MessageDestinationRow
              value={(merged.team_post_destination ?? 'group') as MessageDestination}
              onChange={v => set('team_post_destination', v)}
              label="Team image post"
              timing="As soon as the lineup is confirmed (or force-posted)"
              desc="The pitch image showing the two balanced teams. DM mode sends the image to you to forward."
            />
            <MessageTemplateExpander
              meta={getTemplate('team_caption')}
              session={merged}
              onChange={v => set('team_caption_template', v)}
            />
          </div>
          <div>
            <MessageDestinationRow
              value={(merged.mom_results_destination ?? 'group') as MessageDestination}
              onChange={v => set('mom_results_destination', v)}
              label="MoM winner announcement"
              timing={`${merged.mom_results_post_minutes}min after the MoM message`}
              desc="The post announcing the winner + runner-up. DM mode sends you a draft."
            />
            <MessageTemplateExpander
              meta={getTemplate('mom_results')}
              session={merged}
              onChange={v => set('mom_results_template', v)}
            />
          </div>
          {merged.mom_method === 'web_link' && (
            <div>
              <div className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/20">
                <div className="text-white text-sm font-semibold">MoM vote-link post</div>
                <div className="text-emerald-400/70 text-[11px] mt-0.5 font-medium">
                  Posted to the group right after the match (when MoM method = vote link)
                </div>
                <div className="text-slate-400 text-xs mt-1 leading-snug">
                  The group post containing the anonymous vote link.
                </div>
              </div>
              <MessageTemplateExpander
                meta={getTemplate('mom_link')}
                session={merged}
                onChange={v => set('mom_link_template', v)}
              />
            </div>
          )}
        </div>
        <div className="text-[10px] text-slate-500 leading-snug mt-1">
          MoM voting itself uses the method below (Vote link / WhatsApp poll / Organiser DM) — destination is part of that method.
        </div>
      </SubSection>

      {/* Call-out poll options */}
      <SubSection
        title="Call-out poll"
        summary={`${(merged.callout_poll_options ?? []).length} options · "${(merged.callout_poll_question ?? '').slice(0, 50)}${(merged.callout_poll_question ?? '').length > 50 ? '…' : ''}"`}
      >
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

        {/* Live preview of the rendered question */}
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
            <span className="text-slate-500 text-[10px]">2–12 options · WhatsApp limit</span>
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
                    onClick={() => {
                      set(
                        'callout_poll_options',
                        opts.filter((_, idx) => idx !== i)
                      );
                    }}
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
      </SubSection>

      {/* Confirmation */}
      <SubSection
        title="Weekly confirmation"
        summary={
          merged.confirmation_enabled
            ? `${merged.confirmation_days_before === 0 ? 'Same day' : `${merged.confirmation_days_before} day${merged.confirmation_days_before === 1 ? '' : 's'} before`} at ${timeInputValue(merged.confirmation_time)}${tzAbbr ? ` ${tzAbbr}` : ''}`
            : 'Off'
        }
      >
        <Toggle
          checked={merged.confirmation_enabled}
          onChange={v => set('confirmation_enabled', v)}
          label="Ask me first each week"
          hint="DM you before the call-out. No response = proceed."
        />
        {merged.confirmation_enabled && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Days before call-out">
              <input
                type="number"
                min={0}
                max={14}
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
        )}
      </SubSection>

      {/* Reminders */}
      <SubSection
        title="Nudge"
        summary={
          merged.nudge_enabled
            ? `${merged.nudge_days_before === 0 ? 'Same day' : `${merged.nudge_days_before}d before`} at ${timeInputValue(merged.nudge_time)}${tzAbbr ? ` ${tzAbbr}` : ''} (if signups < ${merged.nudge_below_players})`
            : 'Off'
        }
      >
        <Toggle
          checked={merged.nudge_enabled}
          onChange={v => set('nudge_enabled', v)}
          label="Send a group nudge if signups are low"
          hint={`Only fires if signups are below the nudge threshold (${merged.nudge_below_players}). One nudge per week.`}
        />
        {merged.nudge_enabled && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Days before kickoff" hint="0 = same day">
              <input
                type="number"
                min={0}
                max={14}
                step={1}
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
        )}
      </SubSection>

      {/* Team generation */}
      <SubSection
        title="Team generation"
        summary={`${merged.team_gen_offset_hours}h before · ${merged.team_gen_require_approval ? 'approval required' : 'auto-post'}${(merged.team_gen_instructions ?? '').trim() ? ' · custom rules' : ''}`}
      >
        <Field
          label="Generate teams — hours before kickoff"
          hint="E.g. 2 means teams are picked at this offset; if approval is required, you'll get the DM at the same time."
        >
          <input
            type="number"
            min={0}
            max={72}
            step={0.25}
            value={merged.team_gen_offset_hours}
            onChange={e => set('team_gen_offset_hours', Number(e.target.value))}
            className={inputCls}
          />
        </Field>

        <Toggle
          checked={merged.team_gen_require_approval}
          onChange={v => set('team_gen_require_approval', v)}
          label="Send teams to me first for approval"
          hint="DM with a link to preview, drag-and-drop edit, then post to the group. If you don't act before kickoff, the auto-balanced teams post anyway."
        />


        <Field
          label="Custom rules for the AI"
          hint="Free-text instructions the AI follows when picking teams for this session."
        >
          <textarea
            rows={5}
            value={merged.team_gen_instructions ?? ''}
            onChange={e => set('team_gen_instructions', e.target.value || null)}
            placeholder={
              'e.g.\n' +
              '- Always put John in black tops\n' +
              "- Don't put Mike and Sam on the same team\n" +
              '- Rotate goalkeepers if possible\n' +
              '- Newbies should be split evenly between teams'
            }
            className={`${inputCls} font-mono text-xs leading-relaxed`}
          />
        </Field>
      </SubSection>

      {/* MoM */}
      <SubSection
        title="Man of the Match"
        summary={
          merged.mom_enabled
            ? `${formatDurationMinutes(merged.mom_results_post_minutes)} window · ${
                merged.mom_method === 'web_link'
                  ? 'vote link'
                  : merged.mom_method === 'whatsapp_poll'
                    ? 'WhatsApp poll'
                    : 'organiser DM'
              }`
            : 'Off'
        }
      >
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
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  value={merged.match_duration_minutes}
                  onChange={e => set('match_duration_minutes', Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
              <Field label="Send delay (min)">
                <input
                  type="number"
                  min={0}
                  max={1440}
                  step={5}
                  value={merged.mom_delay_minutes}
                  onChange={e => set('mom_delay_minutes', Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="How to collect votes">
              <div className="space-y-2">
                {(
                  [
                    {
                      value: 'web_link',
                      label: 'Vote link',
                      tagline: 'Recommended',
                      desc: 'One anonymous link posted to the group. Players tap, pick, done. One vote per device.',
                    },
                    {
                      value: 'whatsapp_poll',
                      label: 'Per-player DM polls',
                      tagline: 'Less reliable',
                      desc: "DM each player a private poll listing the others. Aggregation depends on WhatsApp's poll API and isn't always reliable.",
                    },
                    {
                      value: 'organiser_dm',
                      label: 'Organiser DM',
                      tagline: 'No group needed',
                      desc: "One poll DM'd to you with all players as options. You decide. Use when there's no WhatsApp group.",
                    },
                  ] as const
                ).map(opt => {
                  const selected = merged.mom_method === opt.value;
                  return (
                    <button
                      type="button"
                      key={opt.value}
                      onClick={() => set('mom_method', opt.value)}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                        selected
                          ? 'bg-emerald-500/10 border-emerald-500/50'
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                            selected ? 'border-emerald-400 bg-emerald-400' : 'border-slate-600'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className={`text-sm font-medium ${selected ? 'text-white' : 'text-slate-300'}`}>
                              {opt.label}
                            </span>
                            <span
                              className={`text-[10px] font-black uppercase tracking-[0.15em] ${
                                opt.tagline === 'Recommended'
                                  ? 'text-emerald-400'
                                  : opt.tagline === 'Less reliable'
                                    ? 'text-amber-400'
                                    : 'text-slate-500'
                              }`}
                            >
                              {opt.tagline}
                            </span>
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
                type="number"
                min={0}
                max={10080}
                step={5}
                value={merged.mom_results_post_minutes}
                onChange={e => set('mom_results_post_minutes', Number(e.target.value))}
                className={inputCls}
              />
            </Field>
          </>
        )}
      </SubSection>

      {/* Player counts */}
      <SubSection
        title="Player counts"
        summary={`Target ${merged.target_players} · nudge < ${merged.nudge_below_players} · cancel < ${merged.cancel_below_players}${merged.allow_plus_ones ? ' · +1s allowed' : ''}`}
      >
        <Field
          label="Target players"
          hint="The ideal squad size. The call-out poll asks for this many."
        >
          <input
            type="number"
            min={2}
            max={50}
            value={merged.target_players}
            onChange={e => set('target_players', Number(e.target.value))}
            className={inputCls}
          />
        </Field>
        <Field
          label="Nudge below this many"
          hint={`If signups stay under this count, the bot sends a group nudge at the time you set above. Currently ${merged.nudge_below_players}.`}
        >
          <input
            type="number"
            min={0}
            max={50}
            value={merged.nudge_below_players}
            onChange={e => {
              const v = Number(e.target.value);
              set('nudge_below_players', v);
              // Keep cancel <= nudge invariant.
              if (merged.cancel_below_players > v) set('cancel_below_players', v);
            }}
            className={inputCls}
          />
        </Field>
        <Field
          label="Call the game off below this many"
          hint={`At team-generation time, if signups are below this, the bot posts "called off" instead of generating teams. Must be ≤ nudge threshold.`}
        >
          <input
            type="number"
            min={0}
            max={merged.nudge_below_players}
            value={merged.cancel_below_players}
            onChange={e => set('cancel_below_players', Number(e.target.value))}
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
      </SubSection>

      {/* Group */}
      <SubSection
        title="WhatsApp group"
        defaultOpen={!merged.whatsapp_group_jid}
        summary={merged.whatsapp_group_name || (merged.whatsapp_group_jid ? '(jid set)' : 'Not set')}
      >
        <GroupPicker
          relayUrl={relayUrl}
          connected={whatsAppConnected}
          selectedJid={merged.whatsapp_group_jid ?? null}
          selectedName={merged.whatsapp_group_name ?? null}
          onChange={(jid, name) =>
            setDraft(prev => ({ ...prev, whatsapp_group_jid: jid, whatsapp_group_name: name }))
          }
        />
      </SubSection>

      {/* Delete action (save/discard live in the floating bar) */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
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
    </div>
  );
};

export default SessionEditor;
