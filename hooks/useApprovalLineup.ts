import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Lineup, LineupPlayer, LineupStatus } from '../types/database';
import { useAuth } from '../contexts/AuthContext';

interface UseApprovalLineupReturn {
  lineup: Lineup | null;
  players: LineupPlayer[];
  isLoading: boolean;
  error: string | null;
  saveTeams: (next: LineupPlayer[]) => Promise<boolean>;
  setStatus: (
    next: LineupStatus,
    extras?: { rejection_reason?: string | null }
  ) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useApprovalLineup(token: string | null | undefined): UseApprovalLineupReturn {
  const [lineup, setLineup] = useState<Lineup | null>(null);
  const [players, setPlayers] = useState<LineupPlayer[]>([]);
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
    } else {
      const row = data as Lineup;
      setLineup(row);
      const arr = Array.isArray(row.player_positions)
        ? (row.player_positions as unknown as LineupPlayer[])
        : [];
      setPlayers(arr);
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

  return { lineup, players, isLoading, error, saveTeams, setStatus, refresh: load };
}
