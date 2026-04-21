import React, { useEffect, useMemo, useState } from 'react';
import { useSessionSchedules } from '../../hooks/useSessionSchedules';
import { useWhatsAppGroups } from '../../hooks/useWhatsAppGroups';
import { usePlayers } from '../../hooks/usePlayers';
import { relayClient } from '../../lib/relayClient';
import { TESTS, SamplePayload } from '../../lib/sampleMessages';

interface TestPanelProps {
  relayUrl: string | null;
  connected: boolean;
  persona: string;
  /** Connected user's own phone number (digits or formatted) — used for self-DM tests. */
  selfPhone?: string | null;
}

const inputCls =
  'w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors';

interface SendState {
  testId: string | null;
  status: 'idle' | 'sending' | 'ok' | 'err';
  msg?: string;
}

interface PollResult {
  chatJid: string;
  messageId: string;
  question: string;
  options: Array<{ name: string; voters: string[]; voteCount: number }>;
  totalVotes: number;
}

interface LastPoll {
  testId: string;
  chatJid: string;
  question: string;
  sentAt: number;
}

interface PollEditorProps {
  payload: Extract<SamplePayload, { kind: 'poll' }>;
  onChange: (next: Extract<SamplePayload, { kind: 'poll' }>) => void;
}

function PollEditor({ payload, onChange }: PollEditorProps) {
  const setOption = (i: number, v: string) => {
    onChange({ ...payload, options: payload.options.map((o, idx) => (idx === i ? v : o)) });
  };
  const addOption = () => {
    if (payload.options.length >= 12) return;
    onChange({ ...payload, options: [...payload.options, ''] });
  };
  const removeOption = (i: number) => {
    if (payload.options.length <= 2) return;
    onChange({ ...payload, options: payload.options.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-3 max-w-md space-y-3">
      <div className="text-xs text-emerald-300/70 uppercase tracking-wider">WhatsApp poll</div>

      <div>
        <label className="block text-[10px] font-black uppercase tracking-wider text-emerald-300/70 mb-1.5">
          Question
        </label>
        <input
          type="text"
          value={payload.question}
          onChange={e => onChange({ ...payload, question: e.target.value })}
          maxLength={255}
          className="w-full px-3 py-2 bg-slate-950 border border-emerald-900/40 rounded-lg text-emerald-50 text-sm focus:outline-none focus:border-emerald-500"
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label className="block text-[10px] font-black uppercase tracking-wider text-emerald-300/70">
            Options ({payload.options.filter(o => o.trim()).length}/12)
          </label>
          <span className="text-emerald-300/40 text-[10px]">2–12</span>
        </div>
        <ul className="space-y-1.5">
          {payload.options.map((o, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-emerald-400 rounded-full flex-shrink-0" />
              <input
                type="text"
                value={o}
                onChange={e => setOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                maxLength={100}
                className="flex-1 px-2.5 py-1.5 bg-slate-950 border border-emerald-900/40 rounded text-emerald-100 text-sm focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => removeOption(i)}
                disabled={payload.options.length <= 2}
                className="p-1.5 text-emerald-400/40 hover:text-rose-400 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addOption}
          disabled={payload.options.length >= 12}
          className="mt-2 text-emerald-400 hover:text-emerald-300 text-[11px] font-semibold disabled:opacity-30"
        >
          + Add option
        </button>
      </div>

      <label className="inline-flex items-center gap-2 text-emerald-100 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={payload.selectableCount > 1}
          onChange={e =>
            onChange({
              ...payload,
              selectableCount: e.target.checked ? Math.max(2, payload.options.length) : 1,
            })
          }
          className="w-3.5 h-3.5 accent-emerald-500"
        />
        Allow multiple selections
      </label>
    </div>
  );
}

function PollResultsBlock({
  results,
  fetchedFromSelf,
}: {
  results: PollResult[];
  fetchedFromSelf?: boolean;
}) {
  if (results.length === 0) {
    return (
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-400 text-xs">
        No responses captured yet.
        {fetchedFromSelf && (
          <>
            {' '}
            Self-DM polls may not register your own vote — vote in WhatsApp and try again, or have someone else vote.
          </>
        )}
      </div>
    );
  }
  return (
    <div className="bg-slate-950 border border-emerald-800/40 rounded-xl p-3 space-y-3">
      <div className="text-[10px] font-black uppercase tracking-wider text-emerald-300">
        Latest captured responses
      </div>
      {results.slice(0, 3).map(r => {
        const max = Math.max(1, ...r.options.map(o => o.voteCount));
        return (
          <div key={r.messageId} className="space-y-2">
            <div className="text-emerald-50 text-sm font-semibold">{r.question}</div>
            <ul className="space-y-1.5">
              {r.options.map(o => (
                <li key={o.name}>
                  <div className="flex justify-between text-xs text-slate-300 mb-0.5">
                    <span>{o.name}</span>
                    <span className="text-slate-500">{o.voteCount}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${(o.voteCount / max) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="text-slate-500 text-[10px]">{r.totalVotes} total votes</div>
          </div>
        );
      })}
    </div>
  );
}

interface MessageEditorProps {
  payload: Extract<SamplePayload, { kind: 'message' }>;
  onChange: (next: Extract<SamplePayload, { kind: 'message' }>) => void;
}

function MessageEditor({ payload, onChange }: MessageEditorProps) {
  return (
    <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl px-3 py-3 max-w-md">
      <textarea
        value={payload.text}
        onChange={e => onChange({ ...payload, text: e.target.value })}
        rows={Math.min(20, Math.max(4, payload.text.split('\n').length))}
        className="w-full bg-transparent text-emerald-50 text-sm leading-relaxed font-sans resize-none focus:outline-none"
      />
    </div>
  );
}

const TestPanel: React.FC<TestPanelProps> = ({ relayUrl, connected, persona, selfPhone }) => {
  const { schedules, isLoading: schedulesLoading } = useSessionSchedules();
  const { groups, isLoading: groupsLoading } = useWhatsAppGroups({ relayUrl, enabled: connected });
  const { players } = usePlayers();

  const [sessionId, setSessionId] = useState<string>('');
  const [groupJid, setGroupJid] = useState<string>('');
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [send, setSend] = useState<SendState>({ testId: null, status: 'idle' });
  /** Per-test override of the generated payload. Reset when the test is re-opened. */
  const [edits, setEdits] = useState<Record<string, SamplePayload>>({});
  /** Last poll send per testId — enables a "Fetch responses" button. */
  const [lastPolls, setLastPolls] = useState<Record<string, LastPoll>>({});
  /** Captured poll results per testId. */
  const [pollResults, setPollResults] = useState<Record<string, PollResult[]>>({});
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<{ id: string; msg: string } | null>(null);

  // Auto-pick the first session once loaded
  useEffect(() => {
    if (!sessionId && schedules.length > 0) {
      const firstEnabled = schedules.find(s => s.enabled) ?? schedules[0];
      setSessionId(firstEnabled.id);
    }
  }, [schedules, sessionId]);

  const session = useMemo(
    () => schedules.find(s => s.id === sessionId) ?? null,
    [schedules, sessionId]
  );

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g => g.name.toLowerCase().includes(q));
  }, [groups, filter]);

  if (!connected) {
    return (
      <div className="text-slate-500 text-xs">
        Connect WhatsApp first to send test messages.
      </div>
    );
  }

  if (schedulesLoading) {
    return <div className="text-slate-500 text-xs">Loading sessions…</div>;
  }

  if (!session) {
    return (
      <div className="text-slate-500 text-xs">
        Add a session above first — tests need a session config to render against.
      </div>
    );
  }

  const ctx = { session, persona, players };

  const handleSend = async (
    testId: string,
    payload: SamplePayload,
    target: 'group' | 'self_dm'
  ) => {
    if (!relayUrl) return;

    let recipient: string | null = null;
    if (target === 'self_dm') {
      const digits = (selfPhone ?? '').replace(/\D/g, '');
      if (!digits) {
        setSend({ testId, status: 'err', msg: 'WhatsApp phone not detected. Reconnect WhatsApp.' });
        return;
      }
      recipient = `${digits}@s.whatsapp.net`;
    } else {
      if (!groupJid) {
        setSend({ testId, status: 'err', msg: 'Pick a test group first.' });
        return;
      }
      recipient = groupJid;
    }

    setSend({ testId, status: 'sending' });
    try {
      const client = relayClient(relayUrl);
      if (payload.kind === 'message') {
        await client.sendMessage(recipient, payload.text);
      } else {
        await client.sendPoll(
          recipient,
          payload.question,
          payload.options,
          payload.selectableCount
        );
        // Remember poll send so "Fetch responses" can find it
        setLastPolls(prev => ({
          ...prev,
          [testId]: { testId, chatJid: recipient, question: payload.question, sentAt: Date.now() },
        }));
        // Clear stale results for this test
        setPollResults(prev => {
          if (!prev[testId]) return prev;
          const next = { ...prev };
          delete next[testId];
          return next;
        });
      }
      setSend({ testId, status: 'ok' });
      setTimeout(
        () =>
          setSend(prev => (prev.testId === testId && prev.status === 'ok' ? { testId: null, status: 'idle' } : prev)),
        3000
      );
    } catch (e) {
      setSend({ testId, status: 'err', msg: (e as Error).message });
    }
  };

  const handleFetch = async (testId: string) => {
    if (!relayUrl) return;
    const last = lastPolls[testId];
    if (!last) return;
    setFetchingId(testId);
    setFetchError(null);
    try {
      const client = relayClient(relayUrl);
      const all = await client.pollResults(last.chatJid);
      // Filter to the most relevant result — same question, after sentAt
      const matching = all.filter(r => r.question === last.question);
      const ours = matching.length > 0 ? matching : all;
      setPollResults(prev => ({ ...prev, [testId]: ours }));
    } catch (e) {
      setFetchError({ id: testId, msg: (e as Error).message });
    } finally {
      setFetchingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Source + target pickers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-300 mb-1.5">
            Use config from
          </label>
          <select
            value={sessionId}
            onChange={e => setSessionId(e.target.value)}
            className={inputCls}
          >
            {schedules.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} {s.enabled ? '' : '(disabled)'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-300 mb-1.5">
            Send test to
          </label>
          <div className="flex gap-2">
            <input
              type="search"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter groups…"
              className={`${inputCls} flex-1`}
            />
            <select
              value={groupJid}
              onChange={e => setGroupJid(e.target.value)}
              className={`${inputCls} flex-[2]`}
            >
              <option value="">{groupsLoading ? 'Loading groups…' : 'Pick a test group…'}</option>
              {filteredGroups.slice(0, 100).map(g => (
                <option key={g.jid} value={g.jid}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!groupJid && (
        <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-amber-200 text-xs">
          Pick a test group above. Tests always send into the group you pick — point at a private/test group to avoid spamming the real one.
        </div>
      )}

      {/* Test list */}
      <ul className="space-y-2">
        {TESTS.map(t => {
          const isOpen = openId === t.id;
          const payload = isOpen ? (edits[t.id] ?? t.generate(ctx)) : null;
          const sending = send.testId === t.id && send.status === 'sending';
          const sentOk = send.testId === t.id && send.status === 'ok';
          const sentErr = send.testId === t.id && send.status === 'err';

          return (
            <li
              key={t.id}
              className={`border rounded-2xl overflow-hidden transition-colors ${
                isOpen ? 'border-emerald-700/50 bg-slate-950/40' : 'border-slate-800 bg-slate-900/30'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (isOpen) {
                    setOpenId(null);
                  } else {
                    setOpenId(t.id);
                    // Re-seed the editable payload from the latest session config when opening
                    setEdits(prev => ({ ...prev, [t.id]: t.generate(ctx) }));
                  }
                }}
                className="w-full p-3 flex items-center gap-3 text-left hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-semibold flex items-center gap-2">
                    {t.label}
                    {t.target === 'self_dm' && (
                      <span className="text-[9px] font-black uppercase tracking-wider bg-emerald-900/50 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-800/50">
                        → DM you
                      </span>
                    )}
                    {t.target === 'group' && (
                      <span className="text-[9px] font-black uppercase tracking-wider bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                        → group
                      </span>
                    )}
                  </div>
                  <div className="text-slate-500 text-xs">{t.description}</div>
                </div>
                <svg
                  className={`w-4 h-4 text-slate-500 transition-transform flex-shrink-0 ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpen && payload && (
                <div className="border-t border-slate-800 p-3 space-y-3">
                  {payload.kind === 'poll' ? (
                    <PollEditor
                      payload={payload}
                      onChange={next => setEdits(prev => ({ ...prev, [t.id]: next }))}
                    />
                  ) : (
                    <MessageEditor
                      payload={payload}
                      onChange={next => setEdits(prev => ({ ...prev, [t.id]: next }))}
                    />
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSend(t.id, payload, t.target)}
                      disabled={
                        sending ||
                        (t.target === 'group' && !groupJid) ||
                        (t.target === 'self_dm' && !selfPhone)
                      }
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {sending
                        ? 'Sending…'
                        : sentOk
                        ? 'Sent ✓'
                        : t.target === 'self_dm'
                        ? 'Send to me'
                        : 'Send to group'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEdits(prev => ({ ...prev, [t.id]: t.generate(ctx) }))}
                      className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg text-[11px] font-semibold border border-slate-800"
                      title="Re-generate from session config"
                    >
                      Reset
                    </button>

                    {/* Fetch responses — only relevant after sending a poll */}
                    {payload.kind === 'poll' && lastPolls[t.id] && (
                      <button
                        type="button"
                        onClick={() => handleFetch(t.id)}
                        disabled={fetchingId === t.id}
                        className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-[11px] font-semibold border border-slate-700"
                      >
                        {fetchingId === t.id ? 'Fetching…' : 'Fetch responses'}
                      </button>
                    )}

                    {sentErr && send.msg && (
                      <span className="text-rose-300 text-xs">Error: {send.msg}</span>
                    )}
                  </div>

                  {/* Poll results for this test */}
                  {payload.kind === 'poll' && pollResults[t.id] && (
                    <PollResultsBlock
                      results={pollResults[t.id]}
                      fetchedFromSelf={lastPolls[t.id]?.chatJid?.endsWith('@s.whatsapp.net')}
                    />
                  )}
                  {fetchError && fetchError.id === t.id && (
                    <div className="bg-rose-950/40 border border-rose-800/40 rounded-lg p-2 text-rose-300 text-xs">
                      Couldn't fetch responses: {fetchError.msg}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default TestPanel;
