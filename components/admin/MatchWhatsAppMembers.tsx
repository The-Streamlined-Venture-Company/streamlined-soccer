/**
 * "Match WhatsApp Members → Players" onboarding screen.
 *
 * Pulls the live participant list from a WhatsApp group via the relay, then
 * lets the organiser tap-match each member to a player record (or create a
 * new player, or skip). Smart pre-matching by name + aliases.
 *
 * After this is done, the runtime can map poll voters → player IDs, which
 * unlocks accurate auto-team-gen from "who voted In" each week.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Player, PlayerInsert, SessionSchedule } from '../../types/database';
import { GroupParticipant } from '../../lib/relayClient';
import { bestMatch, formatPhone, normaliseName, scoreMatch } from '../../lib/nameMatch';
import { useGroupParticipants } from '../../hooks/useGroupParticipants';
import { usePlayers } from '../../hooks/usePlayers';
import { useSessionSchedules } from '../../hooks/useSessionSchedules';
import { useOrganiserConfig } from '../../hooks/useOrganiserConfig';
import LoadingSpinner from '../ui/LoadingSpinner';
import ErrorMessage from '../ui/ErrorMessage';

interface MatchWhatsAppMembersProps {
  /** Optional: scope to a single schedule's group. If omitted, picks the first enabled schedule with a group set. */
  scheduleId?: string;
}

type MemberAction =
  | { kind: 'skip' }
  | { kind: 'existing'; player_id: string }
  | { kind: 'create'; new_name: string };

interface RowState {
  participant: GroupParticipant;
  /** What the user has selected (or pre-suggested) for this row */
  action: MemberAction;
  /** Current player record this WA account is mapped to (if already saved) */
  currentMappedPlayerId: string | null;
  /** True if the auto-suggester is what's selected (used for "auto" badge) */
  isAutoSuggested: boolean;
}

const MatchWhatsAppMembers: React.FC<MatchWhatsAppMembersProps> = ({ scheduleId }) => {
  const { config } = useOrganiserConfig();
  const { schedules, isLoading: schedulesLoading } = useSessionSchedules();
  const { players, addPlayer, updatePlayer, refresh: refreshPlayers } = usePlayers();

  // Pick the schedule whose group we'll fetch members for
  const activeSchedule: SessionSchedule | null = useMemo(() => {
    if (scheduleId) return schedules.find(s => s.id === scheduleId) ?? null;
    return schedules.find(s => s.enabled && s.whatsapp_group_jid) ?? null;
  }, [schedules, scheduleId]);

  const groupJid = activeSchedule?.whatsapp_group_jid ?? null;
  const groupName = activeSchedule?.whatsapp_group_name ?? null;

  const { participants, isLoading: participantsLoading, error: participantsError, refresh: refreshParticipants } =
    useGroupParticipants({
      relayUrl: config?.relay_url,
      chatJid: groupJid,
      enabled: !!config?.relay_url && !!groupJid,
    });

  // Build editable rows from participants + current player mapping
  const [rows, setRows] = useState<RowState[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  // (Re)build rows whenever participants or players change
  useEffect(() => {
    if (participants.length === 0) { setRows([]); return; }

    const playerByJid = new Map<string, Player>();
    for (const p of players) if (p.whatsapp_jid) playerByJid.set(p.whatsapp_jid, p);

    // Players already mapped to other JIDs are "taken" — don't auto-suggest them again
    const takenPlayerIds = new Set<string>();
    for (const p of players) if (p.whatsapp_jid) takenPlayerIds.add(p.id);

    const candidates = players.map(p => ({
      id: p.id,
      name: p.name,
      aliases: p.aliases,
    }));

    const next: RowState[] = participants.map(part => {
      const already = playerByJid.get(part.id);
      if (already) {
        return {
          participant: part,
          action: { kind: 'existing', player_id: already.id },
          currentMappedPlayerId: already.id,
          isAutoSuggested: false,
        };
      }
      // Try to auto-suggest from non-taken players
      const free = candidates.filter(c => !takenPlayerIds.has(c.id));
      const wname = part.pushName || formatPhone(part.phoneNumber);
      const m = bestMatch(wname, part.phoneNumber, free, 60);
      if (m) {
        // Reserve so we don't double-suggest one player to two members
        takenPlayerIds.add(m.id);
        return {
          participant: part,
          action: { kind: 'existing', player_id: m.id },
          currentMappedPlayerId: null,
          isAutoSuggested: true,
        };
      }
      return {
        participant: part,
        action: { kind: 'skip' },
        currentMappedPlayerId: null,
        isAutoSuggested: false,
      };
    });
    setRows(next);
  }, [participants, players]);

  // Stats
  const stats = useMemo(() => {
    let mapped = 0, willCreate = 0, willMap = 0, willSkip = 0;
    for (const r of rows) {
      if (r.currentMappedPlayerId) mapped++;
      if (r.action.kind === 'create') willCreate++;
      else if (r.action.kind === 'existing' && r.action.player_id !== r.currentMappedPlayerId) willMap++;
      else if (r.action.kind === 'skip') willSkip++;
    }
    return { total: rows.length, mapped, willCreate, willMap, willSkip };
  }, [rows]);

  // Currently-selected player IDs across rows (to disable in dropdowns elsewhere)
  const selectedIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.action.kind === 'existing') set.add(r.action.player_id);
    return set;
  }, [rows]);

  const updateRow = (jid: string, patch: Partial<RowState>) => {
    setRows(prev => prev.map(r => (r.participant.id === jid ? { ...r, ...patch, isAutoSuggested: false } : r)));
  };

  const handleSelect = (jid: string, value: string) => {
    if (value === '__skip__') updateRow(jid, { action: { kind: 'skip' } });
    else if (value === '__create__') {
      const r = rows.find(x => x.participant.id === jid);
      const seed = r?.participant.pushName || formatPhone(r?.participant.phoneNumber ?? '');
      updateRow(jid, { action: { kind: 'create', new_name: seed } });
    } else {
      updateRow(jid, { action: { kind: 'existing', player_id: value } });
    }
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    setSaveError(null);
    let successes = 0;
    try {
      for (const row of rows) {
        const part = row.participant;
        const action = row.action;
        if (action.kind === 'skip') {
          // Nothing to do; if currently mapped, leave it (organiser must explicitly unmap)
          continue;
        }
        if (action.kind === 'create') {
          const insert: PlayerInsert = {
            name: action.new_name.trim() || part.pushName || `Player ${part.phoneNumber || part.id}`,
            status: 'newbie',
            whatsapp_jid: part.id,
            whatsapp_phone: part.phoneNumber || null,
            whatsapp_push_name: part.pushName || null,
            discovered_via: 'whatsapp_auto',
          };
          const created = await addPlayer(insert);
          if (created) successes++;
          continue;
        }
        // existing
        if (action.kind === 'existing') {
          const ok = await updatePlayer(action.player_id, {
            whatsapp_jid: part.id,
            whatsapp_phone: part.phoneNumber || null,
            whatsapp_push_name: part.pushName || null,
          });
          if (ok) successes++;
        }
      }
      await refreshPlayers();
      setSavedFlash(`Saved ${successes} mapping(s)`);
      setTimeout(() => setSavedFlash(null), 3500);
    } catch (e) {
      setSaveError((e as Error).message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (schedulesLoading) return <LoadingSpinner />;

  if (!activeSchedule || !groupJid) {
    return (
      <div className="p-6 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
        <div className="text-slate-300 text-sm font-semibold mb-1">No WhatsApp group connected</div>
        <p className="text-slate-500 text-xs">
          Pick a WhatsApp group on a session schedule first, then come back here to match members to players.
        </p>
      </div>
    );
  }

  if (!config?.relay_url) {
    return (
      <div className="p-6 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
        <div className="text-slate-300 text-sm font-semibold mb-1">Relay not configured</div>
        <p className="text-slate-500 text-xs">
          Set the relay URL in Auto-Organiser settings first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header / context */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-black text-white uppercase tracking-tight">Match WhatsApp Members</h2>
          <p className="text-slate-500 text-xs mt-1">
            Group: <span className="text-slate-300 font-semibold">{groupName ?? groupJid}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={refreshParticipants}
          disabled={participantsLoading}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold disabled:opacity-50"
        >
          {participantsLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {participantsError && <ErrorMessage error={participantsError} />}
      {participantsLoading && <LoadingSpinner />}

      {!participantsLoading && participants.length === 0 && !participantsError && (
        <div className="p-4 bg-amber-950/40 border border-amber-800/40 rounded-xl text-amber-200 text-sm">
          No members returned by the relay. Make sure WhatsApp is connected and you're an admin (or in) this group.
        </div>
      )}

      {/* Stats bar */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
          <Stat label="Total" value={stats.total} tone="slate" />
          <Stat label="Already mapped" value={stats.mapped} tone="emerald" />
          <Stat label="Will be mapped" value={stats.willMap} tone="sky" />
          <Stat label="Will create new" value={stats.willCreate} tone="amber" />
        </div>
      )}

      {/* Rows */}
      <ul className="space-y-2">
        {rows.map(row => (
          <MemberRow
            key={row.participant.id}
            row={row}
            allPlayers={players}
            selectedIds={selectedIds}
            onSelect={value => handleSelect(row.participant.id, value)}
            onChangeNewName={name => updateRow(row.participant.id, { action: { kind: 'create', new_name: name } })}
          />
        ))}
      </ul>

      {/* Sticky save bar */}
      {rows.length > 0 && (
        <div className="sticky bottom-0 bg-slate-950/95 backdrop-blur border-t border-slate-800 p-3 -mx-4 sm:-mx-0 sm:rounded-xl flex items-center justify-between gap-3">
          <div className="text-slate-400 text-xs truncate">
            {savedFlash ? <span className="text-emerald-300 font-semibold">{savedFlash}</span> :
              saveError ? <span className="text-rose-300">{saveError}</span> :
              `${stats.willMap + stats.willCreate} change(s) ready · ${stats.willSkip} skipped`}
          </div>
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={isSaving || (stats.willMap + stats.willCreate === 0)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-black uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving…' : 'Save all mappings'}
          </button>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; tone: 'slate' | 'emerald' | 'sky' | 'amber' }> = ({ label, value, tone }) => {
  const tones: Record<string, string> = {
    slate: 'bg-slate-900/60 border-slate-800 text-slate-300',
    emerald: 'bg-emerald-950/40 border-emerald-800/40 text-emerald-200',
    sky: 'bg-sky-950/40 border-sky-800/40 text-sky-200',
    amber: 'bg-amber-950/40 border-amber-800/40 text-amber-200',
  };
  return (
    <div className={`px-3 py-2 rounded-lg border ${tones[tone]}`}>
      <div className="text-lg font-black">{value}</div>
      <div className="text-[9px] font-black uppercase tracking-wider opacity-70">{label}</div>
    </div>
  );
};

interface MemberRowProps {
  row: RowState;
  allPlayers: Player[];
  selectedIds: Set<string>;
  onSelect: (value: string) => void;
  onChangeNewName: (name: string) => void;
}

const MemberRow: React.FC<MemberRowProps> = ({ row, allPlayers, selectedIds, onSelect, onChangeNewName }) => {
  const part = row.participant;
  const action = row.action;

  // Sort player options: most-likely matches first, then alphabetical
  const sortedPlayers = useMemo(() => {
    const wname = part.pushName || formatPhone(part.phoneNumber);
    const scored = allPlayers.map(p => ({ p, score: scoreMatch(wname, p) }));
    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.p.name.localeCompare(b.p.name);
    });
    return scored;
  }, [allPlayers, part.pushName, part.phoneNumber]);

  const selectedValue =
    action.kind === 'skip' ? '__skip__' :
    action.kind === 'create' ? '__create__' :
    action.player_id;

  const displayName = part.pushName || normaliseName(part.phoneNumber || part.id) || part.id;
  const subline = part.phoneNumber ? formatPhone(part.phoneNumber) : '(LID-only)';

  const rowTone = row.currentMappedPlayerId
    ? 'border-emerald-800/40 bg-emerald-950/10'
    : row.isAutoSuggested
    ? 'border-sky-800/40 bg-sky-950/10'
    : 'border-slate-800 bg-slate-900/40';

  return (
    <li className={`grid grid-cols-1 sm:grid-cols-[1fr_auto_2fr] gap-2 items-start sm:items-center p-3 rounded-xl border ${rowTone}`}>
      <div className="min-w-0">
        <div className="text-white text-sm font-semibold truncate flex items-center gap-2">
          {displayName}
          {part.isAdmin && <span className="text-amber-400 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-amber-950/40 rounded">Admin</span>}
          {row.currentMappedPlayerId && <span className="text-emerald-400" title="Already saved">✓</span>}
          {row.isAutoSuggested && !row.currentMappedPlayerId && (
            <span className="text-sky-400 text-[9px] font-black uppercase tracking-wider" title="Auto-suggested">auto</span>
          )}
        </div>
        <div className="text-slate-500 text-xs truncate">{subline}</div>
      </div>

      <div className="hidden sm:block text-slate-600 text-xs px-2">→</div>

      <div className="space-y-2">
        <select
          value={selectedValue}
          onChange={e => onSelect(e.target.value)}
          className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
        >
          <option value="__skip__">— Skip (don't map)</option>
          <option value="__create__">+ Create new player</option>
          <optgroup label="Existing players">
            {sortedPlayers.map(({ p, score }) => {
              const taken = selectedIds.has(p.id) && (action.kind !== 'existing' || action.player_id !== p.id);
              const star = score >= 70 ? ' ★' : '';
              return (
                <option key={p.id} value={p.id} disabled={taken}>
                  {p.name}{star}{taken ? ' (taken)' : ''}
                </option>
              );
            })}
          </optgroup>
        </select>

        {action.kind === 'create' && (
          <input
            type="text"
            value={action.new_name}
            onChange={e => onChangeNewName(e.target.value)}
            placeholder="New player name"
            className="w-full bg-slate-950 border border-amber-700/40 text-amber-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
        )}
      </div>
    </li>
  );
};

export default MatchWhatsAppMembers;
