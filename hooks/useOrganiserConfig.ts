import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Club, ClubUpdate } from '../types/database';
import { useAuth } from '../contexts/AuthContext';

interface UseOrganiserConfigReturn {
  /** Currently-selected club. Today there's always one per user, multi-club UX is future. */
  config: Club | null;
  /** All clubs the signed-in user is a member of (use this when we add a club switcher). */
  clubs: Club[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (patch: ClubUpdate) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Loads the user's clubs and exposes the first one as `config` (legacy field name —
 * preserved so existing component code reading `config.relay_url`, `config.bot_persona`
 * etc. keeps working without churn). Save mutations target that same club.
 *
 * Multi-club UX is future work — when a user belongs to >1 club we'll add a switcher
 * and persist the selection. Until then we show the first one.
 */
export function useOrganiserConfig(): UseOrganiserConfigReturn {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isAuthenticated, isPasswordRecovery } = useAuth();
  const canUse = isSupabaseConfigured() && supabase !== null && isAuthenticated && !isPasswordRecovery;

  const config: Club | null = clubs[0] ?? null;

  const load = useCallback(async () => {
    if (!canUse || !supabase) {
      setIsLoading(false);
      return;
    }
    setError(null);
    // RLS already restricts to clubs the user belongs to via club_members,
    // so a plain SELECT * does the right thing.
    const { data, error: fetchError } = await supabase
      .from('clubs')
      .select('*')
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('useOrganiserConfig: load error:', fetchError);
      setError(fetchError.message);
      setClubs([]);
    } else {
      setClubs((data ?? []) as Club[]);
    }
    setIsLoading(false);
  }, [canUse]);

  useEffect(() => {
    if (isPasswordRecovery || !isAuthenticated) {
      setIsLoading(false);
      return;
    }
    load();
  }, [isAuthenticated, isPasswordRecovery, load]);

  const save = useCallback(
    async (patch: ClubUpdate): Promise<boolean> => {
      if (!canUse || !supabase) {
        setError('Not connected to Supabase');
        return false;
      }
      if (!config) {
        setError('No club to save — create one first');
        return false;
      }
      setIsSaving(true);
      setError(null);
      const { data, error: updateError } = await supabase
        .from('clubs')
        .update(patch as never)
        .eq('id', config.id)
        .select()
        .single();
      setIsSaving(false);

      if (updateError) {
        console.error('useOrganiserConfig: save error:', updateError);
        setError(updateError.message);
        return false;
      }
      // Replace the row in the array
      setClubs(prev => prev.map(c => (c.id === (data as Club).id ? (data as Club) : c)));
      return true;
    },
    [canUse, config]
  );

  return {
    config,
    clubs,
    isLoading,
    isSaving,
    error,
    save,
    refresh: load,
  };
}
