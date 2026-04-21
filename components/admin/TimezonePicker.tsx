import React, { useEffect, useMemo, useState } from 'react';

interface TimezonePickerProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * All IANA timezones from the JS runtime.
 * Falls back to a curated list on browsers without `Intl.supportedValuesOf`.
 */
function getAllTimezones(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supported = (Intl as any)?.supportedValuesOf;
  if (typeof supported === 'function') {
    try {
      return supported('timeZone') as string[];
    } catch {
      // fall through
    }
  }
  return [
    'UTC',
    'Europe/London',
    'Europe/Dublin',
    'Europe/Paris',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];
}

/** Live-ticking time in the given timezone, formatted as HH:mm:ss. */
function useCurrentTimeIn(timezone: string): { time: string; date: string; offset: string; valid: boolean } {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    void tick;
    try {
      const now = new Date();
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now);
      const date = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(now);
      // Compute offset like "+04:00" or "-05:00" by comparing to UTC
      const dtfParts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'shortOffset',
      })
        .formatToParts(now)
        .find(p => p.type === 'timeZoneName')?.value;
      const offset = (dtfParts || '').replace(/^GMT/i, 'UTC') || '';
      return { time, date, offset, valid: true };
    } catch {
      return { time: '—', date: '', offset: '', valid: false };
    }
  }, [timezone, tick]);
}

const TimezonePicker: React.FC<TimezonePickerProps> = ({ value, onChange }) => {
  const all = useMemo(getAllTimezones, []);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(tz => tz.toLowerCase().includes(q));
  }, [all, query]);

  const { time, date, offset, valid } = useCurrentTimeIn(value);
  const isInList = all.includes(value);

  const inputCls =
    'w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors';

  return (
    <div className="space-y-3">
      {/* Live clock */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-slate-500 text-[10px] font-black uppercase tracking-wider">
            Right now in {value}
          </div>
          <div className="text-2xl font-black tabular-nums text-emerald-400">{time}</div>
          <div className="text-slate-400 text-xs mt-0.5">{date}{offset && ` · ${offset}`}</div>
        </div>
        {!valid && (
          <span className="text-rose-300 text-xs">Not a valid timezone</span>
        )}
      </div>

      {/* Search */}
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={`Search ${all.length} timezones…`}
        className={inputCls}
      />

      {/* Browse list — buttons, not a <select size>, to avoid listbox click quirks. */}
      <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-950 max-h-64 overflow-y-auto">
        {!isInList && (
          <div className="px-3 py-2 text-amber-300 text-xs italic border-b border-slate-800">
            Current value not in list: {value}
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-slate-500 text-xs text-center">No matches</div>
        ) : (
          <ul>
            {filtered.slice(0, 200).map(tz => {
              const isSelected = tz === value;
              return (
                <li key={tz}>
                  <button
                    type="button"
                    onClick={() => onChange(tz)}
                    className={`w-full text-left px-3 py-1.5 font-mono text-xs transition-colors ${
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                    }`}
                  >
                    {tz}
                    {isSelected && <span className="ml-2 text-emerald-400">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="text-slate-500 text-[11px]">
        {filtered.length} of {all.length} shown
        {filtered.length > 200 && ' (first 200 listed — type to narrow down)'}
        {' · '}clock updates every second so you can verify accuracy
      </div>
    </div>
  );
};

export default TimezonePicker;
