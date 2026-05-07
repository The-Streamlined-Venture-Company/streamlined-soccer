import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Club, ClubUpdate } from '../types/database';
import { useAuth } from './AuthContext';

interface ClubContextValue {
  clubs: Club[];
  currentClub: Club | null;
  currentClubId: string | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  setCurrentClubId: (id: string) => void;
  saveCurrentClub: (patch: ClubUpdate) => Promise<boolean>;
  createClub: (name: string, timezone: string, botPersona?: string) => Promise<Club | null>;
  refresh: () => Promise<void>;
}

const ClubContext = createContext<ClubContextValue | null>(null);

const STORAGE_KEY = 'pitchmaster_current_club_id';

export function useClub(): ClubContextValue {
  const ctx = useContext(ClubContext);
  if (!ctx) throw new Error('useClub must be used within a ClubProvider');
  return ctx;
}

export function ClubProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { isAuthenticated, isPasswordRecovery, user } = useAuth();
  const canUse =
    isSupabaseConfigured() && supabase !== null && isAuthenticated && !isPasswordRecovery;

  const [clubs, setClubs] = useState<Club[]>([]);
  const [currentClubId, setCurrentClubIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCurrentClubId = useCallback((id: string) => {
    setCurrentClubIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    if (!canUse || !supabase) {
      setIsLoading(false);
      return;
    }
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('clubs')
      .select('*')
      .order('created_at', { ascending: true });
    if (fetchError) {
      console.error('ClubContext: load error', fetchError);
      setError(fetchError.message);
      setClubs([]);
    } else {
      setClubs((data ?? []) as Club[]);
    }
    setIsLoading(false);
  }, [canUse]);

  useEffect(() => {
    if (!isAuthenticated || isPasswordRecovery) {
      setClubs([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    load();
  }, [isAuthenticated, isPasswordRecovery, user?.id, load]);

  // Reconcile currentClubId with the loaded list: pick the first club if the
  // stored id is gone (e.g. user lost membership) or there's no stored id yet.
  useEffect(() => {
    if (clubs.length === 0) {
      if (currentClubId !== null) {
        setCurrentClubIdState(null);
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      }
      return;
    }
    const stillValid = currentClubId && clubs.some(c => c.id === currentClubId);
    if (!stillValid) {
      setCurrentClubId(clubs[0].id);
    }
  }, [clubs, currentClubId, setCurrentClubId]);

  const currentClub = useMemo(
    () => clubs.find(c => c.id === currentClubId) ?? null,
    [clubs, currentClubId]
  );

  const saveCurrentClub = useCallback(
    async (patch: ClubUpdate): Promise<boolean> => {
      if (!canUse || !supabase) {
        setError('Not connected to Supabase');
        return false;
      }
      if (!currentClub) {
        setError('No club selected');
        return false;
      }
      setIsSaving(true);
      setError(null);
      const { data, error: updateError } = await supabase
        .from('clubs')
        .update(patch as never)
        .eq('id', currentClub.id)
        .select()
        .single();
      setIsSaving(false);
      if (updateError) {
        console.error('ClubContext: save error', updateError);
        setError(updateError.message);
        return false;
      }
      setClubs(prev => prev.map(c => (c.id === (data as Club).id ? (data as Club) : c)));
      return true;
    },
    [canUse, currentClub]
  );

  const createClub = useCallback(
    async (name: string, timezone: string, botPersona?: string): Promise<Club | null> => {
      if (!canUse || !supabase) {
        setError('Not connected to Supabase');
        return null;
      }
      setIsSaving(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('create_club_with_owner', {
        p_name: name,
        p_timezone: timezone,
        p_bot_persona: botPersona ?? 'Pitch Bot',
      } as never);
      setIsSaving(false);
      if (rpcError) {
        console.error('ClubContext: createClub error', rpcError);
        setError(rpcError.message);
        return null;
      }
      const newClub = data as Club;
      setClubs(prev => [...prev, newClub]);
      setCurrentClubId(newClub.id);
      return newClub;
    },
    [canUse, setCurrentClubId]
  );

  const value: ClubContextValue = {
    clubs,
    currentClub,
    currentClubId: currentClub?.id ?? null,
    isLoading,
    isSaving,
    error,
    setCurrentClubId,
    saveCurrentClub,
    createClub,
    refresh: load,
  };

  return <ClubContext.Provider value={value}>{children}</ClubContext.Provider>;
}
