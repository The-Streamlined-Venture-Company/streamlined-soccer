import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Lineup, LineupPlayer, LineupStatus } from '../types/database';
import { useAuth } from '../contexts/AuthContext';

interface UseApprovalLineupReturn {
  lineup: Lineup | null;
  players: LineupPlayer[];
  /** WhatsApp JIDs of voters that signed up but couldn't be mapped to a player record. */
  unmappedVoterJids: string[];
  isLoading: boolean;
  error: string | null;
  saveTeams: (next: LineupPlayer[]) => Promise<boolean>;
  setStatus: (
    next: LineupStatus,
    extras?: { rejection_reason?: string | null }
  ) => Promise<boolean>;
  /** Mark an unmapped voter as resolved (after the organiser maps them to a player). */
  clearUnmappedVoter: (jid: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useApprovalLineup(token: string | null | undefined): UseApprovalLineupReturn {
  const [lineup, setLineup] = useState<Lineup | null>(null);
  const [players, setPlayers] = useState<LineupPlayer[]>([]);
  const [unmappedVoterJids, setUnmappedVoterJids] = useState<string[]>([]);
  const [weeklySessionId, setWeeklySessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { isAuthenticated, isPasswordRecovery } = useAuth();
  const canUse = isSupabaseConfigured() && supabase !== null && isAuthenticated && !isPasswordRecovery;

  const load = useCallback(async () => {
    if (!token || !canUse || !supabase) {
      setIsLoading(false);
      return;
    }
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('lineups')
      .select('*')
      .eq('approval_token', token)
      .single();
    if (fetchError) {
      setError(fetchError.message);
      setLineup(null);
      setPlayers([]);
      setUnmappedVoterJids([]);
      setWeeklySessionId(null);
    } else {
      const row = data as Lineup;
      setLineup(row);
      const arr = Array.isArray(row.player_positions)
        ? (row.player_positions as unknown as LineupPlayer[])
        : [];
      setPlayers(arr);

      // Pull the matching weekly_session for unmapped voter info
      if (row.session_schedule_id && row.match_date) {
        const { data: ws } = await supabase
          .from('weekly_sessions')
          .select('id, unmapped_voter_jids')
          .eq('session_schedule_id', row.session_schedule_id)
          .eq('match_date', row.match_date)
          .maybeSingle();
        if (ws) {
          const wsRow = ws as { id: string; unmapped_voter_jids: string[] | null };
          setWeeklySessionId(wsRow.id);
          setUnmappedVoterJids(Array.isArray(wsRow.unmapped_voter_jids) ? wsRow.unmapped_voter_jids : []);
        } else {
          setWeeklySessionId(null);
          setUnmappedVoterJids([]);
        }
      } else {
        setWeeklySessionId(null);
        setUnmappedVoterJids([]);
      }
    }
    setIsLoading(false);
  }, [token, canUse]);

  useEffect(() => {
    if (isPasswordRecovery || !isAuthenticated) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    load();
  }, [isAuthenticated, isPasswordRecovery, load]);

  const saveTeams = useCallback(
    async (next: LineupPlayer[]) => {
      if (!lineup || !canUse || !supabase) return false;
      const update = { player_positions: next } as unknown as never;
      const { error: updateError } = await supabase
        .from('lineups')
        .update(update)
        .eq('id', lineup.id);
      if (updateError) {
        setError(updateError.message);
        return false;
      }
      setPlayers(next);
      return true;
    },
    [lineup, canUse]
  );

  const setStatus = useCallback(
    async (next: LineupStatus, extras?: { rejection_reason?: string | null }) => {
      if (!lineup || !canUse || !supabase) return false;
      const patch: Record<string, unknown> = { status: next };
      if (next === 'confirmed') {
        patch.approved_at = new Date().toISOString();
      }
      if (extras?.rejection_reason !== undefined) {
        patch.rejection_reason = extras.rejection_reason;
      }
      const { data, error: updateError } = await supabase
        .from('lineups')
        .update(patch as unknown as never)
        .eq('id', lineup.id)
        .select()
        .single();
      if (updateError) {
        setError(updateError.message);
        return false;
      }
      setLineup(data as Lineup);
      return true;
    },
    [lineup, canUse]
  );

  const clearUnmappedVoter = useCallback(
    async (jid: string): Promise<boolean> => {
      if (!weeklySessionId || !canUse || !supabase) return false;
      const next = unmappedVoterJids.filter(j => j !== jid);
      const { error: updErr } = await supabase
        .from('weekly_sessions')
        .update({ unmapped_voter_jids: next } as never)
        .eq('id', weeklySessionId);
      if (updErr) {
        setError(updErr.message);
        return false;
      }
      setUnmappedVoterJids(next);
      return true;
    },
    [weeklySessionId, unmappedVoterJids, canUse]
  );

  return { lineup, players, unmappedVoterJids, isLoading, error, saveTeams, setStatus, clearUnmappedVoter, refresh: load };
}
