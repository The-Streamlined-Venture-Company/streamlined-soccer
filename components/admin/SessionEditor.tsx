import React, { useEffect, useState } from 'react';
import { SessionSchedule, SessionScheduleUpdate, DAYS_OF_WEEK } from '../../types/database';
import GroupPicker from './GroupPicker';
import { renderCallOutQuestion, formatDurationMinutes } from '../../lib/sampleMessages';
import { useRegisterDirty } from '../../contexts/DirtyChangesContext';

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

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
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

const SessionEditor: React.FC<SessionEditorProps> = ({
  schedule,
  relayUrl,
  whatsAppConnected,
  onSave,
  onDelete,
}) => {
  const [draft, setDraft] = useState<Draft>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setDraft({});
  }, [schedule.id]);

  const merged: SessionSchedule = { ...schedule, ...draft };
  const isDirty = Object.keys(draft).length > 0;

  const set = <K extends keyof SessionSchedule>(k: K, v: SessionSchedule[K]) => {
    setDraft(prev => ({ ...prev, [k]: v }));
  };

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

      {/* Schedule */}
      <SubSection
        title="Schedule"
        summary={
          <>
            {DAYS_OF_WEEK[merged.kickoff_dow]} {timeInputValue(merged.kickoff_time)}
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
          <Field label="Kickoff">
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
          <Field label="Call-out time">
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
            ? `${merged.confirmation_days_before === 0 ? 'Same day' : `${merged.confirmation_days_before} day${merged.confirmation_days_before === 1 ? '' : 's'} before`} at ${timeInputValue(merged.confirmation_time)}`
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
            <Field label="Time">
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
        title="Reminders"
        summary={
          [
            merged.followup_nudge_enabled
              ? `Follow-up ${merged.followup_threshold_low}-${merged.followup_threshold_high}`
              : null,
            merged.morning_nudge_enabled ? `Morning ${timeInputValue(merged.morning_nudge_time)}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'All off'
        }
      >
        <Toggle
          checked={merged.followup_nudge_enabled}
          onChange={v => set('followup_nudge_enabled', v)}
          label="Follow-up when numbers are low"
        />
        {merged.followup_nudge_enabled && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start at" hint="Signups at or below this">
              <input
                type="number"
                min={0}
                max={50}
                value={merged.followup_threshold_low}
                onChange={e => set('followup_threshold_low', Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field label="Stop at" hint="Once signups reach this">
              <input
                type="number"
                min={0}
                max={50}
                value={merged.followup_threshold_high}
                onChange={e => set('followup_threshold_high', Number(e.target.value))}
                className={inputCls}
              />
            </Field>
          </div>
        )}
        <Toggle
          checked={merged.morning_nudge_enabled}
          onChange={v => set('morning_nudge_enabled', v)}
          label="Morning-of group nudge"
        />
        {merged.morning_nudge_enabled && (
          <Field label="Nudge time (game day)">
            <input
              type="time"
              value={timeInputValue(merged.morning_nudge_time)}
              onChange={e => set('morning_nudge_time', e.target.value)}
              className={inputCls}
            />
          </Field>
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
            ? `${formatDurationMinutes(merged.mom_results_post_minutes)} window · ${merged.mom_method === 'auto' ? 'auto poll/link' : merged.mom_method === 'whatsapp_poll' ? 'WhatsApp poll' : 'vote link'}`
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
                <select
                  value={merged.mom_method}
                  onChange={e => set('mom_method', e.target.value as SessionSchedule['mom_method'])}
                  className={inputCls}
                >
                  <option value="auto">Auto</option>
                  <option value="whatsapp_poll">WhatsApp poll</option>
                  <option value="web_link">Vote link</option>
                </select>
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
            </div>
          </>
        )}
      </SubSection>

      {/* Player counts */}
      <SubSection
        title="Player counts"
        summary={`Target ${merged.target_players} · min ${merged.min_players}${merged.allow_plus_ones ? ' · +1s allowed' : ''}`}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target">
            <input
              type="number"
              min={2}
              max={50}
              value={merged.target_players}
              onChange={e => set('target_players', Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Minimum">
            <input
              type="number"
              min={2}
              max={50}
              value={merged.min_players}
              onChange={e => set('min_players', Number(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>
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
