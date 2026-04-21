import React, { useEffect, useMemo, useState } from 'react';
import { useApprovalLineup } from '../hooks/useApprovalLineup';
import { usePlayers } from '../hooks/usePlayers';
import { LineupPlayer, LineupStatus, Player } from '../types/database';
import { formatPhone, scoreMatch } from '../lib/nameMatch';
import LoadingSpinner from './ui/LoadingSpinner';
import ErrorMessage from './ui/ErrorMessage';
import Auth from './Auth';
import { useAuth } from '../contexts/AuthContext';

interface ApprovalPageProps {
  token: string;
}

const TEAM_LABEL: Record<'black' | 'white', string> = { black: '⚫ Black', white: '⚪ White' };

function teamSum(players: LineupPlayer[], team: 'black' | 'white'): number {
  return players.filter(p => p.team === team).reduce((s, p) => s + (p.overall_score || 0), 0);
}
function teamAvg(players: LineupPlayer[], team: 'black' | 'white'): number {
  const t = players.filter(p => p.team === team);
  if (t.length === 0) return 0;
  return Math.round((t.reduce((s, p) => s + p.overall_score, 0) / t.length) * 10) / 10;
}
function positionBreakdown(players: LineupPlayer[], team: 'black' | 'white'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of players.filter(x => x.team === team)) {
    out[p.preferred_position] = (out[p.preferred_position] ?? 0) + 1;
  }
  return out;
}

const STATUS_LABEL: Record<LineupStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  posted: 'Posted to group',
  expired: 'Expired',
};

const STATUS_TONE: Record<LineupStatus, string> = {
  draft: 'bg-slate-700/40 text-slate-300 border-slate-700/50',
  pending_approval: 'bg-amber-500/20 text-amber-300 border-amber-700/50',
  confirmed: 'bg-emerald-500/20 text-emerald-300 border-emerald-700/50',
  rejected: 'bg-rose-500/20 text-rose-300 border-rose-700/50',
  posted: 'bg-emerald-500/20 text-emerald-300 border-emerald-700/50',
  expired: 'bg-slate-700/40 text-slate-400 border-slate-700/50',
};

const POSITION_BADGE: Record<string, string> = {
  attacking: 'bg-orange-500/20 text-orange-300',
  midfield: 'bg-sky-500/20 text-sky-300',
  defensive: 'bg-blue-500/20 text-blue-300',
  everywhere: 'bg-slate-500/20 text-slate-300',
};

interface PlayerCardProps {
  player: LineupPlayer;
  isSelected: boolean;
  isSwapTarget: boolean;
  isLocked: boolean;
  onTap: () => void;
  onMoveOtherTeam: () => void;
  onToggleLock: () => void;
}

const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  isSelected,
  isSwapTarget,
  isLocked,
  onTap,
  onMoveOtherTeam,
  onToggleLock,
}) => {
  const ring = isSelected
    ? 'ring-2 ring-emerald-400 bg-emerald-950/40'
    : isSwapTarget
    ? 'ring-2 ring-emerald-400/40 bg-slate-900/60'
    : 'bg-slate-900/60 hover:bg-slate-800/60';

  return (
    <li
      className={`group relative rounded-xl border border-slate-800 transition-all ${ring}`}
    >
      <button
        type="button"
        onClick={onTap}
        className="w-full p-3 flex items-center gap-3 text-left"
      >
        <span className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-emerald-300 font-bold text-sm flex-shrink-0">
          {player.overall_score}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-semibold truncate flex items-center gap-1.5">
            {player.name}
            {player.is_linchpin && <span className="text-amber-400" title="Linchpin">★</span>}
            {isLocked && (
              <span className="text-slate-500" title="Locked — won't be moved on rebalance">
                🔒
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                POSITION_BADGE[player.preferred_position] ?? POSITION_BADGE.everywhere
              }`}
            >
              {player.preferred_position}
            </span>
          </div>
        </div>
      </button>

      {/* Hover/touch quick actions */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onToggleLock}
          className="p-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white"
          title={isLocked ? 'Unlock' : 'Lock'}
        >
          {isLocked ? '🔒' : '🔓'}
        </button>
        <button
          type="button"
          onClick={onMoveOtherTeam}
          className="p-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white"
          title={`Move to ${player.team === 'black' ? 'white' : 'black'}`}
        >
          {player.team === 'black' ? '→ ⚪' : '→ ⚫'}
        </button>
      </div>
    </li>
  );
};

const ApprovalPage: React.FC<ApprovalPageProps> = ({ token }) => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const {
    lineup,
    players: serverPlayers,
    unmappedVoterJids,
    isLoading,
    error,
    saveTeams,
    setStatus,
    clearUnmappedVoter,
    refresh,
  } = useApprovalLineup(isAuthenticated ? token : null);
  const { players: rosterPlayers, addPlayer, updatePlayer } = usePlayers();

  const [draft, setDraft] = useState<LineupPlayer[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionFlash, setActionFlash] = useState<string | null>(null);

  // Sync server → draft
  useEffect(() => {
    setDraft(serverPlayers);
  }, [serverPlayers]);

  const isDirty = useMemo(() => {
    if (draft.length !== serverPlayers.length) return true;
    const byId = new Map(serverPlayers.map(p => [p.player_id, p]));
    return draft.some(p => {
      const s = byId.get(p.player_id);
      return !s || s.team !== p.team || s.locked !== p.locked;
    });
  }, [draft, serverPlayers]);

  const blackPlayers = useMemo(
    () => draft.filter(p => p.team === 'black').sort((a, b) => b.overall_score - a.overall_score),
    [draft]
  );
  const whitePlayers = useMemo(
    () => draft.filter(p => p.team === 'white').sort((a, b) => b.overall_score - a.overall_score),
    [draft]
  );

  const blackSum = teamSum(draft, 'black');
  const whiteSum = teamSum(draft, 'white');
  const blackAvg = teamAvg(draft, 'black');
  const whiteAvg = teamAvg(draft, 'white');
  const diff = Math.abs(blackSum - whiteSum);
  const balanceTone =
    diff <= 3
      ? 'text-emerald-400'
      : diff <= 8
      ? 'text-amber-400'
      : 'text-rose-400';
  const balanceLabel =
    diff <= 3 ? 'Well balanced' : diff <= 8 ? 'Slightly uneven' : 'Uneven';

  const onTapPlayer = (playerId: string) => {
    if (selectedPlayerId === null) {
      setSelectedPlayerId(playerId);
      return;
    }
    if (selectedPlayerId === playerId) {
      setSelectedPlayerId(null);
      return;
    }
    // Swap teams between the two selected
    const a = draft.find(p => p.player_id === selectedPlayerId);
    const b = draft.find(p => p.player_id === playerId);
    if (!a || !b) return;
    setDraft(prev =>
      prev.map(p => {
        if (p.player_id === a.player_id) return { ...p, team: b.team };
        if (p.player_id === b.player_id) return { ...p, team: a.team };
        return p;
      })
    );
    setSelectedPlayerId(null);
  };

  const moveOtherTeam = (playerId: string) => {
    setDraft(prev =>
      prev.map(p =>
        p.player_id === playerId
          ? { ...p, team: p.team === 'black' ? 'white' : 'black' }
          : p
      )
    );
  };

  const toggleLock = (playerId: string) => {
    setDraft(prev =>
      prev.map(p => (p.player_id === playerId ? { ...p, locked: !p.locked } : p))
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    const ok = await saveTeams(draft);
    setIsSaving(false);
    if (ok) {
      setActionFlash('Edits saved');
      setTimeout(() => setActionFlash(null), 2500);
    }
  };

  const handleConfirm = async () => {
    setIsSaving(true);
    if (isDirty) {
      const ok = await saveTeams(draft);
      if (!ok) {
        setIsSaving(false);
        return;
      }
    }
    const ok = await setStatus('confirmed');
    setIsSaving(false);
    if (ok) setActionFlash('Confirmed — runtime will post this to the group');
  };

  const handleReject = async () => {
    setIsSaving(true);
    const ok = await setStatus('rejected', { rejection_reason: rejectReason || null });
    setIsSaving(false);
    if (ok) {
      setActionFlash('Rejected — bot will skip posting this week');
      setConfirmReject(false);
      setRejectReason('');
    }
  };

  if (authLoading) return <LoadingSpinner />;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <p className="text-slate-400 text-sm text-center mb-4">
            Sign in to review the proposed teams.
          </p>
          <Auth />
        </div>
      </div>
    );
  }

  if (isLoading) return <LoadingSpinner />;

  if (error || !lineup) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <ErrorMessage
            message={
              error ?? `No lineup found for token "${token}". It may have expired or been confirmed already.`
            }
          />
        </div>
      </div>
    );
  }

  const status: LineupStatus = lineup.status;
  const isFinal = status === 'confirmed' || status === 'posted' || status === 'rejected';

  return (
    <div className="min-h-screen bg-[#020617] text-white pb-32">
      {/* Header */}
      <header className="px-4 md:px-8 py-6 border-b border-slate-900">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${STATUS_TONE[status]}`}
            >
              {STATUS_LABEL[status]}
            </span>
            {lineup.match_date && (
              <span className="text-slate-400 text-xs">
                Match: {new Date(lineup.match_date).toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            )}
          </div>
          <h1 className="text-2xl md:text-3xl font-black uppercase italic tracking-tight">
            {lineup.name}
          </h1>
          <p className="text-slate-500 text-xs mt-2">
            Tap two players to swap. Use 🔒 to keep a player on their team.
          </p>
        </div>
      </header>

      {/* Balance summary */}
      <section className="px-4 md:px-8 py-5 bg-slate-950/40 border-b border-slate-900">
        <div className="max-w-4xl mx-auto grid grid-cols-3 gap-3 items-center">
          <div className="text-center">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
              Black
            </div>
            <div className="text-2xl font-black">{blackSum}</div>
            <div className="text-slate-500 text-[10px]">avg {blackAvg} · {blackPlayers.length} players</div>
          </div>
          <div className="text-center">
            <div className={`text-xs font-black uppercase tracking-widest ${balanceTone}`}>
              {balanceLabel}
            </div>
            <div className={`text-lg font-bold ${balanceTone}`}>± {diff}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
              White
            </div>
            <div className="text-2xl font-black">{whiteSum}</div>
            <div className="text-slate-500 text-[10px]">avg {whiteAvg} · {whitePlayers.length} players</div>
          </div>
        </div>
      </section>

      {/* Position breakdown */}
      <section className="px-4 md:px-8 py-3 bg-slate-950/20 border-b border-slate-900">
        <div className="max-w-4xl mx-auto grid grid-cols-2 gap-4 text-xs">
          {(['black', 'white'] as const).map(team => {
            const breakdown = positionBreakdown(draft, team);
            return (
              <div key={team} className="flex items-center gap-2 flex-wrap">
                <span className="text-slate-500 text-[10px] font-black uppercase tracking-wider">
                  {team === 'black' ? '⚫' : '⚪'}
                </span>
                {Object.entries(breakdown).map(([pos, n]) => (
                  <span
                    key={pos}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      POSITION_BADGE[pos] ?? POSITION_BADGE.everywhere
                    }`}
                  >
                    {pos}: {n}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      {/* Unmapped voters — quick-match section */}
      {!isFinal && unmappedVoterJids.length > 0 && (
        <UnmappedVotersSection
          jids={unmappedVoterJids}
          rosterPlayers={rosterPlayers}
          lineupPlayerIds={new Set(draft.map(p => p.player_id))}
          onMatch={async (jid, playerId) => {
            const ok = await updatePlayer(playerId, { whatsapp_jid: jid, whatsapp_phone: jid.split('@')[0] });
            if (ok) await clearUnmappedVoter(jid);
            return ok;
          }}
          onCreate={async (jid, name) => {
            const created = await addPlayer({
              name: name.trim() || `Player ${jid.split('@')[0]}`,
              status: 'newbie',
              whatsapp_jid: jid,
              whatsapp_phone: jid.split('@')[0],
              discovered_via: 'whatsapp_auto',
            });
            if (!created) return false;
            return await clearUnmappedVoter(jid);
          }}
          onSkip={async jid => clearUnmappedVoter(jid)}
          onRefresh={refresh}
        />
      )}

      {/* Two team lists */}
      <main className="px-4 md:px-8 py-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['black', 'white'] as const).map(team => {
            const list = team === 'black' ? blackPlayers : whitePlayers;
            return (
              <section key={team}>
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-300 mb-2">
                  {TEAM_LABEL[team]} ({list.length})
                </h2>
                <ul className="space-y-2">
                  {list.map(p => (
                    <PlayerCard
                      key={p.player_id}
                      player={p}
                      isSelected={selectedPlayerId === p.player_id}
                      isSwapTarget={selectedPlayerId !== null && selectedPlayerId !== p.player_id}
                      isLocked={p.locked}
                      onTap={() => onTapPlayer(p.player_id)}
                      onMoveOtherTeam={() => moveOtherTeam(p.player_id)}
                      onToggleLock={() => toggleLock(p.player_id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Reject form */}
        {confirmReject && (
          <div className="max-w-4xl mx-auto mt-6 p-4 bg-rose-950/40 border border-rose-800/40 rounded-xl">
            <div className="text-rose-200 text-sm font-semibold mb-2">Reject these teams</div>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason (optional) — e.g. 'rained off', 'too few players'"
              rows={2}
              className="w-full px-3 py-2 bg-slate-950 border border-rose-900/40 rounded-lg text-rose-50 text-sm focus:outline-none focus:border-rose-500"
            />
            <div className="mt-3 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmReject(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={isSaving}
                className="px-3 py-1.5 bg-rose-500 hover:bg-rose-400 text-white rounded-lg text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                {isSaving ? 'Rejecting…' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur border-t border-slate-800 shadow-2xl">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-slate-400 text-xs truncate">
            {actionFlash ? actionFlash : isFinal ? 'No further changes' : isDirty ? 'Unsaved edits' : 'Ready'}
          </div>
          {!isFinal && (
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmReject(true)}
                disabled={isSaving}
                className="px-3 py-2 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 rounded-lg text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || isSaving}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-black uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving…' : 'Save edits'}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSaving}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                {isSaving ? 'Working…' : isDirty ? 'Save & confirm' : 'Confirm & post'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Unmapped voters quick-match section ────────────────────────────────────
// Shows voters that polled "in" but couldn't be mapped to a player record.
// One tap maps to an existing player or creates a new one.

interface UnmappedVotersSectionProps {
  jids: string[];
  rosterPlayers: Player[];
  lineupPlayerIds: Set<string>;
  onMatch: (jid: string, playerId: string) => Promise<boolean>;
  onCreate: (jid: string, name: string) => Promise<boolean>;
  onSkip: (jid: string) => Promise<boolean>;
  onRefresh: () => Promise<void>;
}

const UnmappedVotersSection: React.FC<UnmappedVotersSectionProps> = ({
  jids,
  rosterPlayers,
  lineupPlayerIds,
  onMatch,
  onCreate,
  onSkip,
  onRefresh,
}) => {
  const [busyJid, setBusyJid] = useState<string | null>(null);
  const [creatingNames, setCreatingNames] = useState<Record<string, string>>({});

  const wrap = async (jid: string, fn: () => Promise<boolean>) => {
    setBusyJid(jid);
    try {
      const ok = await fn();
      if (ok) await onRefresh();
    } finally {
      setBusyJid(null);
    }
  };

  return (
    <section className="px-4 md:px-8 py-4 bg-amber-950/20 border-y border-amber-800/30">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-amber-200 text-sm font-black uppercase tracking-wider">
              ⚠ {jids.length} voter{jids.length === 1 ? '' : 's'} not mapped to a player
            </h3>
            <p className="text-amber-300/80 text-xs mt-1">
              These people voted "in" but I don't know who they are. Match them now and they'll be ready for next week's auto-pick.
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          {jids.map(jid => {
            const phone = jid.split('@')[0];
            const isBusy = busyJid === jid;
            // Sort roster: best name-match first (using phone as the "name"); only un-rostered players are useful
            const candidates = rosterPlayers
              .filter(p => !lineupPlayerIds.has(p.id) && !p.whatsapp_jid)
              .map(p => ({ p, score: scoreMatch(phone, p) }))
              .sort((a, b) => {
                if (a.score !== b.score) return b.score - a.score;
                return a.p.name.localeCompare(b.p.name);
              });

            return (
              <li
                key={jid}
                className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center p-3 bg-slate-900/60 border border-amber-800/30 rounded-xl"
              >
                <div className="min-w-0">
                  <div className="text-white text-sm font-semibold">
                    {formatPhone(phone)} {jid.endsWith('@lid') && <span className="text-slate-500 text-xs ml-1">(LID)</span>}
                  </div>
                  <div className="text-slate-500 text-[10px] truncate">{jid}</div>
                </div>

                <div className="flex flex-wrap gap-2 justify-end">
                  <select
                    disabled={isBusy}
                    onChange={e => {
                      const v = e.target.value;
                      e.target.value = '';
                      if (v === '__create__') {
                        const seed = formatPhone(phone);
                        setCreatingNames(s => ({ ...s, [jid]: seed }));
                      } else if (v === '__skip__') {
                        wrap(jid, () => onSkip(jid));
                      } else if (v) {
                        wrap(jid, () => onMatch(jid, v));
                      }
                    }}
                    defaultValue=""
                    className="bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-2 py-1.5 text-xs disabled:opacity-50"
                  >
                    <option value="" disabled>Match to player…</option>
                    <option value="__create__">+ Create new player</option>
                    <option value="__skip__">— Skip (don't match)</option>
                    <optgroup label="Existing un-mapped players">
                      {candidates.length === 0 && <option disabled>No candidates available</option>}
                      {candidates.map(({ p, score }) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{score >= 70 ? ' ★' : ''}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {creatingNames[jid] !== undefined && (
                  <div className="col-span-2 flex gap-2 items-center pt-2 border-t border-slate-800/40">
                    <input
                      type="text"
                      value={creatingNames[jid]}
                      disabled={isBusy}
                      onChange={e => setCreatingNames(s => ({ ...s, [jid]: e.target.value }))}
                      placeholder="New player name"
                      autoFocus
                      className="flex-1 bg-slate-950 border border-amber-700/40 text-amber-100 rounded-lg px-3 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        const name = creatingNames[jid];
                        wrap(jid, async () => {
                          const ok = await onCreate(jid, name);
                          if (ok) setCreatingNames(s => { const { [jid]: _, ...rest } = s; return rest; });
                          return ok;
                        });
                      }}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold disabled:opacity-50"
                    >
                      {isBusy ? 'Creating…' : 'Create'}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setCreatingNames(s => { const { [jid]: _, ...rest } = s; return rest; })}
                      className="px-2 py-1.5 text-slate-500 hover:text-slate-300 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};

export default ApprovalPage;
