import React, { useMemo, useState } from 'react';
import { useWhatsAppGroups } from '../../hooks/useWhatsAppGroups';
import { relayClient } from '../../lib/relayClient';

interface GroupPickerProps {
  relayUrl: string | null;
  connected: boolean;
  selectedJid: string | null;
  selectedName: string | null;
  onChange: (jid: string | null, name: string | null) => void;
}

const GroupPicker: React.FC<GroupPickerProps> = ({
  relayUrl,
  connected,
  selectedJid,
  selectedName,
  onChange,
}) => {
  const { groups, isLoading, error, refresh } = useWhatsAppGroups({
    relayUrl,
    enabled: connected,
  });
  const [query, setQuery] = useState('');
  const [testState, setTestState] = useState<{ kind: 'idle' | 'sending' | 'ok' | 'err'; msg?: string }>({
    kind: 'idle',
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g => g.name.toLowerCase().includes(q));
  }, [groups, query]);

  const selected = useMemo(() => {
    return groups.find(g => g.jid === selectedJid) ?? null;
  }, [groups, selectedJid]);

  const handleSelect = (jid: string, name: string) => {
    onChange(jid, name);
    setQuery('');
  };

  const handleClear = () => {
    onChange(null, null);
  };

  const sendTest = async () => {
    if (!relayUrl || !selectedJid) return;
    setTestState({ kind: 'sending' });
    try {
      const client = relayClient(relayUrl);
      const text = `🧪 Test message from Streamlined Soccer auto-organiser\n\nIf you see this, the connection to ${selectedName ?? 'this group'} is working. Sent ${new Date().toLocaleString()}.`;
      await client.sendMessage(selectedJid, text);
      setTestState({ kind: 'ok', msg: 'Sent' });
      setTimeout(() => setTestState({ kind: 'idle' }), 3000);
    } catch (e) {
      setTestState({ kind: 'err', msg: (e as Error).message });
    }
  };

  if (!connected) {
    return (
      <div className="text-slate-500 text-xs">
        Connect WhatsApp above to load your groups.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Selected banner */}
      {selected ? (
        <div className="flex items-center justify-between gap-3 bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
              Selected
            </div>
            <div className="text-emerald-100 text-sm font-semibold truncate">{selected.name}</div>
            <div className="text-emerald-300/50 text-[10px] font-mono truncate">{selected.jid}</div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={sendTest}
              disabled={testState.kind === 'sending'}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-[11px] font-black uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              {testState.kind === 'sending' ? 'Sending…' : testState.kind === 'ok' ? 'Sent ✓' : 'Test send'}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-semibold transition-colors"
            >
              Change
            </button>
          </div>
        </div>
      ) : selectedJid ? (
        <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-amber-200 text-xs">
          Previously selected JID <span className="font-mono">{selectedJid}</span>
          {selectedName ? ` (${selectedName})` : ''} — not found in current group list. Pick again or refresh.
        </div>
      ) : null}

      {testState.kind === 'err' && testState.msg && (
        <div className="bg-red-950/40 border border-red-800/40 rounded-xl p-2.5 text-red-300 text-xs">
          Test send failed: {testState.msg}
        </div>
      )}

      {/* Search + refresh */}
      {(!selected || selectedJid === null) && (
        <>
          <div className="flex gap-2">
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Search ${groups.length} groups…`}
              className="flex-1 px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            />
            <button
              type="button"
              onClick={refresh}
              disabled={isLoading}
              className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg text-xs font-semibold transition-colors border border-slate-800 disabled:opacity-50"
              title="Re-fetch groups from WhatsApp"
            >
              {isLoading ? '…' : '↻'}
            </button>
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-800/40 rounded-xl p-2.5 text-red-300 text-xs">
              {error}
            </div>
          )}

          {/* Results list */}
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-800">
              {isLoading && groups.length === 0 && (
                <div className="p-4 text-slate-500 text-xs text-center">Loading groups…</div>
              )}
              {!isLoading && filtered.length === 0 && (
                <div className="p-4 text-slate-500 text-xs text-center">
                  {query ? 'No groups match your search.' : 'No groups yet.'}
                </div>
              )}
              {filtered.slice(0, 150).map(g => {
                const isSel = g.jid === selectedJid;
                return (
                  <button
                    key={g.jid}
                    type="button"
                    onClick={() => handleSelect(g.jid, g.name)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-slate-800/60 transition-colors flex items-center gap-2 ${
                      isSel ? 'bg-emerald-950/40' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm truncate">{g.name}</div>
                      <div className="text-slate-600 text-[10px] font-mono truncate">{g.jid}</div>
                    </div>
                    {isSel && (
                      <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
            {filtered.length > 150 && (
              <div className="px-3 py-2 text-slate-500 text-[10px] bg-slate-950 border-t border-slate-800 text-center">
                Showing first 150 of {filtered.length}. Type to narrow down.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default GroupPicker;
