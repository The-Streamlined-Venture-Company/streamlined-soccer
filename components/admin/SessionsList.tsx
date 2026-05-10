import React, { useEffect, useState } from 'react';
import { useSessionSchedules, defaultScheduleInsert } from '../../hooks/useSessionSchedules';
import { DAYS_OF_WEEK, SessionSchedule } from '../../types/database';
import SessionEditor from './SessionEditor';
import SessionEditorV2 from './SessionEditorV2';
import LoadingSpinner from '../ui/LoadingSpinner';

// localStorage key for the editor-layout preview toggle. While we A/B the
// consolidated layout vs. the classic layout, the choice persists so an
// organiser doesn't have to flip back every page-load.
const LAYOUT_KEY = 'sessionEditorLayout';
type Layout = 'classic' | 'consolidated';
function getInitialLayout(): Layout {
  if (typeof window === 'undefined') return 'classic';
  const v = window.localStorage.getItem(LAYOUT_KEY);
  return v === 'consolidated' ? 'consolidated' : 'classic';
}

interface SessionsListProps {
  relayUrl: string | null;
  whatsAppConnected: boolean;
}

function formatTime(t: string): string {
  if (!t) return '';
  return t.length >= 5 ? t.substring(0, 5) : t;
}

function summarise(s: SessionSchedule): string {
  const day = DAYS_OF_WEEK[s.kickoff_dow] ?? '?';
  const time = formatTime(s.kickoff_time);
  const where = s.pitch_label ? ` · ${s.pitch_label}` : '';
  return `${day}s, ${time}${where}`;
}

const SessionsList: React.FC<SessionsListProps> = ({ relayUrl, whatsAppConnected }) => {
  const { schedules, isLoading, error, add, update, remove } = useSessionSchedules();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [layout, setLayout] = useState<Layout>(getInitialLayout);

  // Persist the layout choice across reloads.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LAYOUT_KEY, layout);
    }
  }, [layout]);

  const handleAdd = async () => {
    setIsAdding(true);
    const created = await add(defaultScheduleInsert(`Session ${schedules.length + 1}`));
    setIsAdding(false);
    if (created) setExpandedId(created.id);
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-3">
      {/* A/B layout toggle — temporary while we evaluate the consolidated editor.
          Sticky-persistent per browser via localStorage. Remove the loser side later. */}
      <div className="flex items-center justify-end gap-2 text-[10px]">
        <span className="text-slate-500 uppercase tracking-widest font-bold">Editor layout:</span>
        <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
          {(['classic', 'consolidated'] as const).map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => setLayout(opt)}
              className={`px-2.5 py-1 font-bold uppercase tracking-wider transition-colors ${
                layout === opt
                  ? 'bg-emerald-500/15 text-emerald-200'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              title={opt === 'consolidated' ? 'New 5-section layout (preview)' : 'Original layout'}
            >
              {opt === 'classic' ? 'Classic' : 'Consolidated (new)'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800/40 rounded-xl p-2.5 text-red-300 text-xs">
          {error}
        </div>
      )}

      {schedules.length === 0 && (
        <div className="text-slate-500 text-xs italic">
          No sessions yet. Add one to get started.
        </div>
      )}

      {schedules.map(s => {
        const isExpanded = expandedId === s.id;
        return (
          <div
            key={s.id}
            className={`border rounded-2xl overflow-hidden transition-colors ${
              isExpanded ? 'border-emerald-700/50 bg-slate-900/40' : 'border-slate-800 bg-slate-900/30'
            }`}
          >
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : s.id)}
              className="w-full p-4 flex items-center gap-4 text-left hover:bg-slate-800/30 transition-colors"
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  s.enabled ? 'bg-emerald-400' : 'bg-slate-600'
                }`}
                title={s.enabled ? 'Enabled' : 'Disabled'}
              />
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm font-semibold truncate">{s.name}</div>
                <div className="text-slate-500 text-xs truncate">
                  {summarise(s)}
                  {s.whatsapp_group_name && (
                    <>
                      {' · '}
                      <span className="text-slate-400">{s.whatsapp_group_name}</span>
                    </>
                  )}
                </div>
              </div>
              <svg
                className={`w-4 h-4 text-slate-500 transition-transform flex-shrink-0 ${
                  isExpanded ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isExpanded && (
              <div className="border-t border-slate-800 p-3">
                {layout === 'consolidated' ? (
                  <SessionEditorV2
                    schedule={s}
                    relayUrl={relayUrl}
                    whatsAppConnected={whatsAppConnected}
                    onSave={update}
                    onDelete={async id => {
                      const ok = await remove(id);
                      if (ok && expandedId === id) setExpandedId(null);
                      return ok;
                    }}
                  />
                ) : (
                  <SessionEditor
                    schedule={s}
                    relayUrl={relayUrl}
                    whatsAppConnected={whatsAppConnected}
                    onSave={update}
                    onDelete={async id => {
                      const ok = await remove(id);
                      if (ok && expandedId === id) setExpandedId(null);
                      return ok;
                    }}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={handleAdd}
        disabled={isAdding}
        className="w-full py-3 border-2 border-dashed border-slate-700 hover:border-emerald-500/50 text-slate-400 hover:text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50"
      >
        {isAdding ? 'Adding…' : '+ Add session'}
      </button>
    </div>
  );
};

export default SessionsList;
