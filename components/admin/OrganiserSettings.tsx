import React, { useEffect, useState } from 'react';
import { useOrganiserConfig } from '../../hooks/useOrganiserConfig';
import { OrganiserConfig } from '../../types/database';
import LoadingSpinner from '../ui/LoadingSpinner';
import ErrorMessage from '../ui/ErrorMessage';
import ConnectWhatsApp from './ConnectWhatsApp';
import SessionsList from './SessionsList';
import TestPanel from './TestPanel';
import TimezonePicker from './TimezonePicker';
import { useWhatsAppConnection } from '../../hooks/useWhatsAppConnection';
import { DirtyChangesProvider, useRegisterDirty } from '../../contexts/DirtyChangesContext';

type Draft = Partial<OrganiserConfig>;

const ALERT_CHANNELS: Array<{ value: OrganiserConfig['alert_channel']; label: string }> = [
  { value: 'in_app', label: 'In-app notification' },
  { value: 'whatsapp_dm', label: 'WhatsApp DM' },
  { value: 'email', label: 'Email' },
  { value: 'push', label: 'Web push' },
];

interface SectionProps {
  title: string;
  subtitle?: string;
  /** Short read-only summary of the saved value, shown only when collapsed. */
  summary?: React.ReactNode;
  /** When false, section starts closed. Defaults to true. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({
  title,
  subtitle,
  summary,
  defaultOpen = true,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={`border rounded-2xl overflow-hidden transition-colors ${
        open ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-900/30 border-slate-800/70'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 md:px-6 py-4 flex items-center gap-4 text-left hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <h2 className="text-white text-sm font-black uppercase tracking-widest">{title}</h2>
          {!open && summary && (
            <div className="text-slate-400 text-xs mt-0.5 truncate">{summary}</div>
          )}
          {open && subtitle && <p className="text-slate-500 text-xs mt-1">{subtitle}</p>}
        </div>
        <svg
          className={`w-4 h-4 text-slate-500 transition-transform flex-shrink-0 ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-5 md:px-6 pb-5 md:pb-6 space-y-4">{children}</div>}
    </section>
  );
};

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({ label, hint, children }) => (
  <div>
    <label className="block text-slate-300 text-[11px] font-black uppercase tracking-wider mb-2">
      {label}
    </label>
    {children}
    {hint && <p className="text-slate-500 text-xs mt-1.5">{hint}</p>}
  </div>
);

const inputCls =
  'w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors';

/** Live ticking clock for the section summary line. */
const TimezoneSummary: React.FC<{ tz: string }> = ({ tz }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000); // ticks every 30s — summary doesn't need seconds
    return () => clearInterval(id);
  }, []);
  let time = '';
  try {
    void tick;
    time = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    time = '?';
  }
  return (
    <span>
      {tz} · <span className="text-emerald-400 font-semibold tabular-nums">{time}</span>
    </span>
  );
};

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({
  checked,
  onChange,
  label,
  hint,
}) => (
  <label className="flex items-start gap-3 cursor-pointer select-none">
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
        checked ? 'bg-emerald-500' : 'bg-slate-700'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
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

const OrganiserSettingsInner: React.FC = () => {
  const { config, isLoading, error, save } = useOrganiserConfig();
  const [draft, setDraft] = useState<Draft>({});

  const relayUrlForHook = config?.relay_url ?? null;
  const {
    status: waStatus,
    isLoading: waLoading,
    error: waError,
    connect: waConnect,
    disconnect: waDisconnect,
    refresh: waRefresh,
  } = useWhatsAppConnection({ relayUrl: relayUrlForHook });

  useEffect(() => {
    if (config) setDraft({});
  }, [config]);

  const isDirty = Object.keys(draft).length > 0;
  const isWhatsAppConnected = waStatus?.state === 'connected';

  // Register with the page-level Save bar
  useRegisterDirty(
    'organiser_config',
    'global settings',
    isDirty,
    async () => {
      if (!isDirty) return true;
      const ok = await save(draft);
      return ok;
    },
    () => setDraft({})
  );

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;
  if (!config) {
    return <ErrorMessage error="Organiser config not available (not authenticated or DB misconfigured)." />;
  }

  const merged: OrganiserConfig = { ...config, ...draft };

  const set = <K extends keyof OrganiserConfig>(k: K, v: OrganiserConfig[K]) => {
    setDraft(prev => ({ ...prev, [k]: v }));
  };

  return (
    <div className="space-y-5 pb-24">
      {/* Master switch */}
      <div
        className={`border rounded-2xl p-5 flex items-center justify-between gap-4 ${
          merged.enabled
            ? 'bg-emerald-950/40 border-emerald-700/50'
            : 'bg-slate-900/50 border-slate-800'
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${merged.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}
            />
            <h2 className="text-white text-sm font-black uppercase tracking-widest">
              Auto-Organiser
            </h2>
          </div>
          <p className="text-slate-400 text-xs mt-1">
            {merged.enabled
              ? 'Running. Scheduled posts, nudges, team-gen and MoM votes fire automatically across all enabled sessions.'
              : 'Paused. No automated messages will be sent for any session.'}
          </p>
        </div>
        <Toggle
          checked={merged.enabled}
          onChange={v => set('enabled', v)}
          label={merged.enabled ? 'ON' : 'OFF'}
        />
      </div>

      {/* Connect WhatsApp (global to user) */}
      <Section
        title="Your WhatsApp"
        subtitle="Pair your number so the auto-organiser can post as you."
        defaultOpen={!isWhatsAppConnected}
        summary={
          isWhatsAppConnected
            ? `Connected · ${waStatus?.phoneNumber ?? 'paired'}`
            : 'Not connected'
        }
      >
        <ConnectWhatsApp
          relayUrl={merged.relay_url ?? null}
          status={waStatus}
          isLoading={waLoading}
          error={waError}
          onConnect={waConnect}
          onDisconnect={waDisconnect}
          onRefresh={waRefresh}
        />
      </Section>

      {/* Sessions — multiple weekly schedules */}
      <Section
        title="Sessions"
        subtitle="One row per recurring session. Add as many as you need — different days, pitches, or groups."
        defaultOpen={true}
      >
        <SessionsList
          relayUrl={merged.relay_url ?? null}
          whatsAppConnected={isWhatsAppConnected}
        />
      </Section>

      {/* Global timezone */}
      <Section
        title="Timezone"
        subtitle="Used by all sessions when interpreting day/time fields. Live clock below confirms accuracy."
        defaultOpen={false}
        summary={<TimezoneSummary tz={merged.timezone} />}
      >
        <TimezonePicker
          value={merged.timezone}
          onChange={tz => set('timezone', tz)}
        />
      </Section>

{/* Bot identity */}
      <Section
        title="Bot identity"
        subtitle="A subtle italic signature is appended to every automated message so recipients can tell auto-posts apart from things you typed yourself."
        defaultOpen={false}
        summary={merged.bot_persona ? `Persona: ${merged.bot_persona}` : 'No persona set'}
      >
        <Field label="Persona name" hint="Used in the signature and any 'this is X' self-references">
          <input
            type="text"
            value={merged.bot_persona}
            onChange={e => set('bot_persona', e.target.value)}
            placeholder="e.g. Pitch Bot"
            className={inputCls}
          />
        </Field>

        <details className="group">
          <summary className="cursor-pointer text-slate-400 hover:text-white text-[11px] font-black uppercase tracking-wider select-none">
            Advanced
          </summary>
          <div className="mt-4">
            <Field label="Relay URL" hint="Override if you're running a different relay instance">
              <input
                type="url"
                value={merged.relay_url ?? ''}
                onChange={e => set('relay_url', e.target.value || null)}
                placeholder="https://soccer-whatsapp-relay-production.up.railway.app"
                className={`${inputCls} font-mono text-xs`}
              />
            </Field>
          </div>
        </details>
      </Section>

      {/* Test panel — try every automated message format end-to-end */}
      <Section
        title="Test"
        subtitle="Fire any of the automated messages right now. Pick a session for the config, a group for the target, then send."
        defaultOpen={false}
        summary="Send sample messages and polls"
      >
        <TestPanel
          relayUrl={merged.relay_url ?? null}
          connected={isWhatsAppConnected}
          persona={merged.bot_persona}
          selfPhone={waStatus?.phoneNumber ?? null}
        />
      </Section>

      {/* Alerts */}
      <Section
        title="Alerts"
        subtitle="Where the system contacts you when something needs attention."
        defaultOpen={false}
        summary={
          ALERT_CHANNELS.find(c => c.value === merged.alert_channel)?.label ?? merged.alert_channel
        }
      >
        <Field label="Alert channel">
          <select
            value={merged.alert_channel}
            onChange={e => set('alert_channel', e.target.value as OrganiserConfig['alert_channel'])}
            className={inputCls}
          >
            {ALERT_CHANNELS.map(c => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      {/* Phone push notifications via ntfy.sh */}
      <Section
        title="Phone notifications"
        subtitle="Get an instant phone notification when WhatsApp disconnects or recovers, even when this app is closed. Free, no account, powered by ntfy.sh."
        defaultOpen={false}
        summary={merged.notify_topic ? `ntfy.sh/${merged.notify_topic}` : 'Off'}
      >
        <div className="space-y-4">
          <div className="text-xs text-slate-400 leading-relaxed space-y-2">
            <p className="font-bold text-slate-300">Setup (one-time):</p>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>Install <a href="https://ntfy.sh/app" target="_blank" rel="noreferrer" className="text-emerald-400 underline">the ntfy app</a> on your phone (iOS / Android).</li>
              <li>Open the app, tap <span className="font-mono">+</span>, choose a unique secret topic name (e.g. <span className="font-mono text-slate-300">tsc-football-{(merged.id ?? 'xyz').substring(0, 6)}</span>) and Subscribe.</li>
              <li>Paste the same topic name below, then tap save.</li>
            </ol>
            <p className="text-slate-500">Your topic is your password — keep it private. Anyone who knows it can push to your phone.</p>
          </div>
          <Field label="ntfy.sh topic" hint="Letters, digits, hyphens, underscores. Leave blank to disable.">
            <input
              type="text"
              value={merged.notify_topic ?? ''}
              onChange={e => set('notify_topic', e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') || null)}
              placeholder="tsc-football-xxxxxx"
              className={`${inputCls} font-mono text-xs`}
              autoComplete="off"
            />
          </Field>
          {merged.notify_topic && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await fetch(`https://ntfy.sh/${merged.notify_topic}`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'text/plain',
                      Title: '🧪 Test push',
                      Priority: '3',
                      Tags: 'test_tube',
                    },
                    body: 'If you got this, your ntfy.sh notifications are wired up. Disconnect alerts will look like this.',
                  });
                  alert('Test notification sent. Check your phone.');
                } catch (e) {
                  alert(`Test failed: ${(e as Error).message}`);
                }
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-black uppercase tracking-widest transition-all"
            >
              Send a test push
            </button>
          )}
        </div>
      </Section>

    </div>
  );
};

const OrganiserSettings: React.FC = () => (
  <DirtyChangesProvider>
    <OrganiserSettingsInner />
  </DirtyChangesProvider>
);

export default OrganiserSettings;
