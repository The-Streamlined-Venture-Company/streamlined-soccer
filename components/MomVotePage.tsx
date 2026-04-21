/**
 * MoM vote page — public, anonymous, accessed via /mom/:token.
 *
 * Flow:
 *   1. Fetch the lineup via `soccer.get_mom_vote_page(token)` (no auth)
 *   2. User taps a player name → Submit
 *   3. Vote cast via `soccer.cast_mom_vote(token, player_id, fingerprint)`
 *   4. Dedup is per-device (fingerprint stored in localStorage + UA hash)
 *
 * No sign-in required. Each device can vote once; voting can be changed up
 * until the voting window closes (bot marks results_message_id).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

interface VotePageProps {
  token: string;
}

interface LineupPlayerOption {
  id: string;
  name: string;
}

interface VotePage {
  weekly_session_id: string;
  match_date: string | null;
  voting_closed: boolean;
  /** When voting closes and the winner is posted. null if unknown. */
  results_at: string | null;
  players: LineupPlayerOption[];
}

function formatResultsAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// Get or create a stable per-device fingerprint. Persists across tabs / visits
// on the same browser. Used as the dedup key — not for identification.
function ensureFingerprint(): string {
  const KEY = 'streamlined-soccer-vote-fp';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = 'fp-' + crypto.randomUUID().replace(/-/g, '').substring(0, 20);
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // localStorage disabled — generate a session fingerprint (only dedups this tab)
    return 'fp-session-' + Math.random().toString(36).substring(2, 14);
  }
}

const MomVotePage: React.FC<VotePageProps> = ({ token }) => {
  const [page, setPage] = useState<VotePage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fingerprint = useMemo(() => ensureFingerprint(), []);

  // Restore last submission from localStorage (per-token)
  useEffect(() => {
    try {
      const v = localStorage.getItem(`mom-vote-${token}`);
      if (v) setSubmittedId(v);
    } catch {
      // ignore
    }
  }, [token]);

  const load = useCallback(async () => {
    if (!supabase) {
      setError('Not configured');
      setIsLoading(false);
      return;
    }
    setError(null);
    const { data, error: rpcErr } = await (supabase.rpc as unknown as (name: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>)(
      'get_mom_vote_page',
      { p_token: token }
    );
    if (rpcErr) {
      setError(rpcErr.message);
      setPage(null);
    } else if (!data || !(data as VotePage).weekly_session_id) {
      setError('This voting link is invalid or has expired.');
      setPage(null);
    } else {
      setPage(data as VotePage);
    }
    setIsLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!supabase || !selectedId) return;
    setIsSubmitting(true);
    setError(null);
    const { data, error: rpcErr } = await (supabase.rpc as unknown as (name: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>)(
      'cast_mom_vote',
      { p_token: token, p_player_id: selectedId, p_fingerprint: fingerprint }
    );
    setIsSubmitting(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    const res = data as { ok: boolean; error?: string } | null;
    if (!res?.ok) {
      const errMap: Record<string, string> = {
        invalid_token: 'This voting link is invalid.',
        voting_closed: 'Voting has closed for this match.',
        session_cancelled: 'This match was cancelled.',
        player_not_in_lineup: 'That player isn\'t on the team sheet.',
        bad_fingerprint: 'Couldn\'t identify your device. Try a different browser.',
      };
      setError(errMap[res?.error ?? ''] ?? res?.error ?? 'Vote failed');
      return;
    }
    setSubmittedId(selectedId);
    try {
      localStorage.setItem(`mom-vote-${token}`, selectedId);
    } catch { /* ignore */ }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-4">🤷</div>
          <div className="text-white text-lg font-bold mb-2">Something's off</div>
          <div className="text-slate-400 text-sm">{error ?? 'Unknown error'}</div>
        </div>
      </div>
    );
  }

  if (page.voting_closed) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-4">⏱</div>
          <div className="text-white text-xl font-bold mb-2">Voting is closed</div>
          <div className="text-slate-400 text-sm">Results have already been posted to the group.</div>
        </div>
      </div>
    );
  }

  const matchDate = page.match_date
    ? new Date(page.match_date).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      })
    : '';

  return (
    <div className="min-h-screen bg-[#020617] text-white pb-28">
      <header className="px-4 md:px-8 py-6 border-b border-slate-900">
        <div className="max-w-2xl mx-auto">
          <div className="text-emerald-400 text-[10px] font-black uppercase tracking-[0.3em] mb-1">
            Streamlined Soccer
          </div>
          <h1 className="text-3xl md:text-4xl font-black uppercase italic tracking-tight leading-none">
            🏆 Man of the Match
          </h1>
          {matchDate && (
            <p className="text-slate-400 text-sm mt-2">{matchDate}</p>
          )}
          <p className="text-slate-500 text-xs mt-4 leading-relaxed">
            Pick the player you think deserved it.{' '}
            <span className="text-slate-400">Your vote is anonymous.</span>
          </p>
        </div>
      </header>

      <main className="px-4 md:px-8 py-6">
        <div className="max-w-2xl mx-auto">
          {submittedId && (
            <div className="mb-4 p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-100 rounded-xl text-sm">
              <div className="flex items-center gap-2 font-semibold">
                <span className="text-emerald-400">✓</span>
                <span>Vote recorded</span>
              </div>
              <div className="mt-1 text-emerald-200/80">
                You picked{' '}
                <span className="font-bold">
                  {page.players.find(p => p.id === submittedId)?.name ?? 'someone'}
                </span>
                .{' '}
                {page.results_at
                  ? <>Winner will be announced in the group around <span className="font-semibold">{formatResultsAt(page.results_at)}</span>.</>
                  : <>Winner will be announced in the group when voting closes.</>}
              </div>
              <div className="mt-2 text-emerald-300/70 text-xs">
                Your vote is anonymous. Tap a different name below to change it.
              </div>
            </div>
          )}

          <ul className="space-y-2">
            {page.players.map(p => {
              const isSelected = selectedId === p.id;
              const isSubmittedChoice = submittedId === p.id;
              const ring = isSelected
                ? 'ring-2 ring-emerald-400 bg-emerald-950/40'
                : isSubmittedChoice
                ? 'ring-1 ring-emerald-500/40 bg-slate-900/60'
                : 'bg-slate-900/60 hover:bg-slate-800/60';
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full p-4 rounded-xl border border-slate-800 text-left transition-all ${ring}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-white font-semibold text-lg">{p.name}</span>
                      {isSubmittedChoice && !isSelected && (
                        <span className="text-emerald-400 text-xs">Your current vote</span>
                      )}
                      {isSelected && (
                        <span className="text-emerald-300 text-xs font-bold">✓ Selected</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </main>

      {/* Fixed action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur border-t border-slate-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-slate-400 text-xs truncate">
            {submittedId && selectedId === submittedId
              ? 'This is already your vote'
              : selectedId
              ? 'Ready to cast'
              : 'Pick one'}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={
              !selectedId ||
              selectedId === submittedId ||
              isSubmitting
            }
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-black uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Voting…' : submittedId ? 'Change vote' : 'Cast vote'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MomVotePage;
