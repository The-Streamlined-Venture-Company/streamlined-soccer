import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Player, PlayerInsert, PlayerUpdate, calculateOverallScore } from '../types/database';
import { DatabasePlayer } from '../types';
import { findBestMatch } from '../utils/fuzzyMatch';
import { useAuth } from '../contexts/AuthContext';

interface UsePlayersReturn {
  players: Player[];
  isLoading: boolean;
  error: string | null;
  addPlayer: (player: PlayerInsert) => Promise<Player | null>;
  updatePlayer: (id: string, updates: PlayerUpdate) => Promise<boolean>;
  deletePlayer: (id: string) => Promise<boolean>;
  importPlayers: (players: PlayerInsert[]) => Promise<{ success: number; failed: number }>;
  refresh: () => Promise<void>;
  findPlayerByName: (name: string) => Player | null;
  getRatingForName: (name: string) => number | undefined;
  // Legacy support for DatabasePlayer format
  legacyDatabase: DatabasePlayer[];
}

// Local storage key for offline mode
const STORAGE_KEY = 'pitchmaster_enhanced_db';

/**
 * Convert enhanced player to legacy DatabasePlayer format
 */
function tolegacyPlayer(player: Player): DatabasePlayer {
  return {
    name: player.name,
    rating: player.overall_score,
    position: player.preferred_position,
  };
}

/**
 * Convert legacy DatabasePlayer to enhanced format
 */
function fromLegacyPlayer(player: DatabasePlayer): PlayerInsert {
  // Map old 0-100 rating to 0-10 skills
  const skillValue = Math.round((player.rating || 70) / 10);

  return {
    name: player.name,
    shooting: skillValue,
    passing: skillValue,
    ball_control: skillValue,
    playmaking: skillValue,
    defending: skillValue,
    fitness: skillValue,
    overall_score: player.rating || 70,
    preferred_position: (player.position as 'attacking' | 'midfield' | 'defensive' | 'everywhere') || 'everywhere',
    status: 'regular',
    is_linchpin: false,
    aliases: [],
  };
}

export function usePlayers(): UsePlayersReturn {
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get auth state
  const { isAuthenticated, isPasswordRecovery } = useAuth();

  // Check if we're using Supabase or localStorage
  // Only use Supabase if configured AND authenticated AND not in password recovery
  const useSupabase = isSupabaseConfigured() && supabase !== null && isAuthenticated && !isPasswordRecovery;

  // Load players from localStorage (for offline mode)
  const loadFromLocalStorage = useCallback(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setPlayers(parsed);
      } catch (e) {
        console.error('Failed to parse local storage:', e);
        // Try legacy format
        const legacySaved = localStorage.getItem('pitchmaster_db');
        if (legacySaved) {
          try {
            const legacy: DatabasePlayer[] = JSON.parse(legacySaved);
            const enhanced = legacy.map((p, i) => ({
              id: `local-${i}`,
              ...fromLegacyPlayer(p),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })) as Player[];
            setPlayers(enhanced);
            // Migrate to new format
            localStorage.setItem(STORAGE_KEY, JSON.stringify(enhanced));
          } catch (e2) {
            console.error('Failed to parse legacy database:', e2);
          }
        }
      }
    }
    setIsLoading(false);
  }, []);

  // Save players to localStorage (for offline mode)
  const saveToLocalStorage = useCallback((data: Player[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // Also save legacy format for backwards compatibility
    const legacy = data.map(tolegacyPlayer);
    localStorage.setItem('pitchmaster_db', JSON.stringify(legacy));
  }, []);

  // Load players from Supabase
  const loadFromSupabase = useCallback(async () => {
    if (!supabase) {
      console.log('usePlayers: supabase client is null');
      return;
    }

    console.log('usePlayers: loading from Supabase...');
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('players')
      .select('*')
      .order('overall_score', { ascending: false });

    if (fetchError) {
      console.error('usePlayers: Error fetching players:', fetchError);
      setError(fetchError.message);
      // Fall back to localStorage
      loadFromLocalStorage();
    } else {
      console.log('usePlayers: loaded', data?.length || 0, 'players from Supabase');
      setPlayers(data || []);
    }
    setIsLoading(false);
  }, [loadFromLocalStorage]);

  // Initial load - only load when authenticated
  useEffect(() => {
    console.log('usePlayers useEffect:', { isAuthenticated, isPasswordRecovery, useSupabase });

    // Don't load anything during password recovery or when not authenticated
    if (isPasswordRecovery || !isAuthenticated) {
      console.log('usePlayers: skipping load (not authenticated or in recovery)');
      setIsLoading(false);
      return;
    }

    if (useSupabase) {
      console.log('usePlayers: using Supabase');
      loadFromSupabase();
    } else {
      console.log('usePlayers: using localStorage');
      loadFromLocalStorage();
    }
  }, [useSupabase, loadFromSupabase, loadFromLocalStorage, isAuthenticated, isPasswordRecovery]);

  // Refresh data
  const refresh = useCallback(async () => {
    setIsLoading(true);
    if (useSupabase) {
      await loadFromSupabase();
    } else {
      loadFromLocalStorage();
    }
  }, [useSupabase, loadFromSupabase, loadFromLocalStorage]);

  // Add a new player
  const addPlayer = useCallback(
    async (player: PlayerInsert): Promise<Player | null> => {
      // Don't include overall_score - it's a generated column in the database
      const { overall_score: _unused, ...playerData } = player;

      if (useSupabase && supabase) {
        const { data, error: insertError } = await supabase
          .from('players')
          .insert(playerData as never)
          .select()
          .single();

        if (insertError) {
          console.error('Error adding player:', insertError);
          setError(insertError.message);
          return null;
        }

        const newPlayer = data as Player;
        setPlayers(prev => [...prev, newPlayer]);
        return newPlayer;
      } else {
        // Local storage mode - need to calculate overall_score manually
        const shooting = player.shooting || 5;
        const passing = player.passing || 5;
        const ball_control = player.ball_control || 5;
        const playmaking = player.playmaking || 5;
        const defending = player.defending || 5;
        const fitness = player.fitness || 5;

        const newPlayer: Player = {
          id: `local-${Date.now()}`,
          name: player.name,
          status: player.status || 'regular',
          preferred_position: player.preferred_position || 'everywhere',
          shooting,
          passing,
          ball_control,
          playmaking,
          defending,
          fitness,
          overall_score: calculateOverallScore({ shooting, passing, ball_control, playmaking, defending, fitness }),
          is_linchpin: player.is_linchpin || false,
          aliases: player.aliases || [],
          notes: player.notes || null,
          created_by: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const updated = [...players, newPlayer];
        setPlayers(updated);
        saveToLocalStorage(updated);
        return newPlayer;
      }
    },
    [useSupabase, players, saveToLocalStorage]
  );

  // Update a player
  const updatePlayer = useCallback(
    async (id: string, updates: PlayerUpdate): Promise<boolean> => {
      // Remove overall_score from updates - it's a generated column in the database
      const { overall_score: _unused, ...finalUpdates } = updates;

      if (useSupabase && supabase) {
        const { error: updateError } = await supabase
          .from('players')
          .update(finalUpdates as never)
          .eq('id', id);

        if (updateError) {
          console.error('Error updating player:', updateError);
          setError(updateError.message);
          return false;
        }

        await refresh();
        return true;
      } else {
        // Local storage mode - need to calculate overall_score manually
        const updated = players.map(p => {
          if (p.id !== id) return p;
          const merged = { ...p, ...finalUpdates, updated_at: new Date().toISOString() };
          merged.overall_score = calculateOverallScore({
            shooting: merged.shooting,
            passing: merged.passing,
            ball_control: merged.ball_control,
            playmaking: merged.playmaking,
            defending: merged.defending,
            fitness: merged.fitness,
          });
          return merged;
        });
        setPlayers(updated);
        saveToLocalStorage(updated);
        return true;
      }
    },
    [useSupabase, players, refresh, saveToLocalStorage]
  );

  // Delete a player
  const deletePlayer = useCallback(
    async (id: string): Promise<boolean> => {
      if (useSupabase && supabase) {
        const { error: deleteError } = await supabase.from('players').delete().eq('id', id);

        if (deleteError) {
          console.error('Error deleting player:', deleteError);
          setError(deleteError.message);
          return false;
        }

        setPlayers(prev => prev.filter(p => p.id !== id));
        return true;
      } else {
        // Local storage mode
        const updated = players.filter(p => p.id !== id);
        setPlayers(updated);
        saveToLocalStorage(updated);
        return true;
      }
    },
    [useSupabase, players, saveToLocalStorage]
  );

  // Import multiple players (merge with existing)
  const importPlayers = useCallback(
    async (newPlayers: PlayerInsert[]): Promise<{ success: number; failed: number }> => {
      let success = 0;
      let failed = 0;

      for (const player of newPlayers) {
        // Check if player exists (by name)
        const existing = players.find(
          p => p.name.toLowerCase() === player.name.toLowerCase()
        );

        if (existing) {
          // Update existing player
          const result = await updatePlayer(existing.id, player);
          if (result) success++;
          else failed++;
        } else {
          // Add new player
          const result = await addPlayer(player);
          if (result) success++;
          else failed++;
        }
      }

      return { success, failed };
    },
    [players, updatePlayer, addPlayer]
  );

  // Find a player by name (fuzzy match)
  const findPlayerByName = useCallback(
    (name: string): Player | null => {
      const playersWithAliases = players.map(p => ({
        ...p,
        aliases: p.aliases || [],
      }));
      return findBestMatch(name, playersWithAliases);
    },
    [players]
  );

  // Get rating for a name (for pitch assignment)
  const getRatingForName = useCallback(
    (name: string): number | undefined => {
      const player = findPlayerByName(name);
      return player?.overall_score;
    },
    [findPlayerByName]
  );

  // Legacy database format
  const legacyDatabase = players.map(tolegacyPlayer);

  return {
    players,
    isLoading,
    error,
    addPlayer,
    updatePlayer,
    deletePlayer,
    importPlayers,
    refresh,
    findPlayerByName,
    getRatingForName,
    legacyDatabase,
  };
}
