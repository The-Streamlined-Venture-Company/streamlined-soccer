import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { WeeklySession, SessionSchedule, WeeklySessionState } from '../types/database';
import { useAuth } from '../contexts/AuthContext';

interface UseWeeklySessionByTokenReturn {
  weeklySession: WeeklySession | null;
  schedule: SessionSchedule | null;
  isLoading: boolean;
  error: string | null;
  setState: (next: WeeklySessionState) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Loads a weekly_session by its confirmation_token, plus the parent
 * session_schedule for display context. Used by the /confirm/:token page.
 */
export function useWeeklySessionByToken(token: string | null | undefined): UseWeeklySessionByTokenReturn {
  const [weeklySession, setWeeklySession] = useState<WeeklySession | null>(null);
  const [schedule, setSchedule] = useState<SessionSchedule | null>(null);
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
    const { data: ws, error: wsErr } = await supabase
      .from('weekly_sessions')
      .select('*')
      .eq('confirmation_token', token)
      .single();
    if (wsErr) {
      setError(wsErr.message);
      setWeeklySession(null);
      setSchedule(null);
      setIsLoading(false);
      return;
    }
    const wsRow = ws as WeeklySession;
    setWeeklySession(wsRow);

    const { data: sched, error: schedErr } = await supabase
      .from('session_schedules')
      .select('*')
      .eq('id', wsRow.session_schedule_id)
      .single();
    if (schedErr) {
      setError(schedErr.message);
      setSchedule(null);
    } else {
      setSchedule(sched as SessionSchedule);
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

  const setState = useCallback(
    async (next: WeeklySessionState): Promise<boolean> => {
      if (!weeklySession || !canUse || !supabase) return false;
      const { data, error: updateError } = await supabase
        .from('weekly_sessions')
        .update({ state: next } as never)
        .eq('id', weeklySession.id)
        .select()
        .single();
      if (updateError) {
        setError(updateError.message);
        return false;
      }
      setWeeklySession(data as WeeklySession);
      return true;
    },
    [weeklySession, canUse]
  );

  return { weeklySession, schedule, isLoading, error, setState, refresh: load };
}
