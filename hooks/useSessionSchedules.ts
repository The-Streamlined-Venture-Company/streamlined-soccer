import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  SessionSchedule,
  SessionScheduleInsert,
  SessionScheduleUpdate,
} from '../types/database';
import { useAuth } from '../contexts/AuthContext';
import { useClub } from '../contexts/ClubContext';

interface UseSessionSchedulesReturn {
  schedules: SessionSchedule[];
  isLoading: boolean;
  error: string | null;
  add: (insert: SessionScheduleInsert) => Promise<SessionSchedule | null>;
  update: (id: string, patch: SessionScheduleUpdate) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const DEFAULT_INSERT: Omit<SessionScheduleInsert, 'name'> = {
  enabled: true,
  kickoff_dow: 4,
  kickoff_time: '20:00',
  weekly_post_dow: 1,
  weekly_post_time: '18:00',
  confirmation_enabled: true,
  confirmation_days_before: 1,
  confirmation_time: '16:00',
  nudge_enabled: true,
  nudge_days_before: 0,
  nudge_time: '09:00',
  callout_enabled: true,
  team_post_enabled: true,
  auto_cancel_enabled: false,  // opt-in: never auto-post a "called off" message by default
  mom_results_enabled: true,
  approval_dm_enabled: true,
  team_gen_offset_hours: 2,
  mom_enabled: true,
  match_duration_minutes: 60,
  mom_delay_minutes: 0,
  mom_method: 'web_link',
  mom_results_post_minutes: 60,
  target_players: 14,
  min_players: 10,
  nudge_below_players: 12,
  cancel_below_players: 8,
  allow_plus_ones: true,
  plus_ones_count_toward_target: false,
};

export function defaultScheduleInsert(name: string): SessionScheduleInsert {
  return { ...DEFAULT_INSERT, name };
}

export function useSessionSchedules(): UseSessionSchedulesReturn {
  const [schedules, setSchedules] = useState<SessionSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { isAuthenticated, isPasswordRecovery } = useAuth();
  const { currentClubId } = useClub();
  const canUse = isSupabaseConfigured() && supabase !== null && isAuthenticated && !isPasswordRecovery;

  const load = useCallback(async () => {
    if (!canUse || !supabase) {
      setIsLoading(false);
      return;
    }
    // RLS scopes the rows to the caller's clubs, but we still want a clean
    // loading state on club switch (the previous club's schedules shouldn't
    // be visible during refetch).
    setIsLoading(true);
    setError(null);
    setSchedules([]);
    const { data, error: fetchError } = await supabase
      .from('session_schedules')
      .select('*')
      .order('kickoff_dow', { ascending: true })
      .order('kickoff_time', { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setSchedules((data ?? []) as SessionSchedule[]);
    }
    setIsLoading(false);
  }, [canUse]);

  useEffect(() => {
    if (isPasswordRecovery || !isAuthenticated) {
      setIsLoading(false);
      return;
    }
    // Re-load whenever the club changes — previous data must not leak into
    // the new club's view.
    load();
  }, [isAuthenticated, isPasswordRecovery, currentClubId, load]);

  const add = useCallback(
    async (insert: SessionScheduleInsert) => {
      if (!canUse || !supabase) return null;
      if (!currentClubId) {
        setError('No club selected — create or join a club first');
        return null;
      }
      const { data, error: insertError } = await supabase
        .from('session_schedules')
        .insert({ ...insert, club_id: currentClubId } as never)
        .select()
        .single();
      if (insertError) {
        setError(insertError.message);
        return null;
      }
      const created = data as SessionSchedule;
      setSchedules(prev => [...prev, created]);
      return created;
    },
    [canUse, currentClubId]
  );

  const update = useCallback(
    async (id: string, patch: SessionScheduleUpdate) => {
      if (!canUse || !supabase) return false;
      const { data, error: updateError } = await supabase
        .from('session_schedules')
        .update(patch as never)
        .eq('id', id)
        .select()
        .single();
      if (updateError) {
        setError(updateError.message);
        return false;
      }
      setSchedules(prev => prev.map(s => (s.id === id ? (data as SessionSchedule) : s)));
      return true;
    },
    [canUse]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!canUse || !supabase) return false;
      const { error: deleteError } = await supabase
        .from('session_schedules')
        .delete()
        .eq('id', id);
      if (deleteError) {
        setError(deleteError.message);
        return false;
      }
      setSchedules(prev => prev.filter(s => s.id !== id));
      return true;
    },
    [canUse]
  );

  return { schedules, isLoading, error, add, update, remove, refresh: load };
}
