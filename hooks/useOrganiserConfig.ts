import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { OrganiserConfig, OrganiserConfigUpdate } from '../types/database';
import { useAuth } from '../contexts/AuthContext';

interface UseOrganiserConfigReturn {
  config: OrganiserConfig | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (patch: OrganiserConfigUpdate) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Loads and persists the singleton organiser_config row (id=1).
 * Only available when authenticated + Supabase configured; otherwise config is null.
 */
export function useOrganiserConfig(): UseOrganiserConfigReturn {
  const [config, setConfig] = useState<OrganiserConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isAuthenticated, isPasswordRecovery } = useAuth();
  const canUse = isSupabaseConfigured() && supabase !== null && isAuthenticated && !isPasswordRecovery;

  const load = useCallback(async () => {
    if (!canUse || !supabase) {
      setIsLoading(false);
      return;
    }
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('organiser_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (fetchError) {
      console.error('useOrganiserConfig: load error:', fetchError);
      setError(fetchError.message);
      setConfig(null);
    } else {
      setConfig(data as OrganiserConfig);
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
    async (patch: OrganiserConfigUpdate): Promise<boolean> => {
      if (!canUse || !supabase) {
        setError('Not connected to Supabase');
        return false;
      }
      setIsSaving(true);
      setError(null);
      const { data, error: updateError } = await supabase
        .from('organiser_config')
        .update(patch as never)
        .eq('id', 1)
        .select()
        .single();
      setIsSaving(false);

      if (updateError) {
        console.error('useOrganiserConfig: save error:', updateError);
        setError(updateError.message);
        return false;
      }
      setConfig(data as OrganiserConfig);
      return true;
    },
    [canUse]
  );

  return {
    config,
    isLoading,
    isSaving,
    error,
    save,
    refresh: load,
  };
}
