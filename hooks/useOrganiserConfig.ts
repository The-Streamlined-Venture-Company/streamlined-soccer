import { Club, ClubUpdate } from '../types/database';
import { useClub } from '../contexts/ClubContext';

interface UseOrganiserConfigReturn {
  /** Currently-selected club. */
  config: Club | null;
  /** All clubs the signed-in user is a member of. */
  clubs: Club[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (patch: ClubUpdate) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Back-compat wrapper around `useClub`. Existing components read `config.relay_url`,
 * `config.bot_persona` etc. — keeping the shape stable so we don't have to churn
 * call sites during the multi-tenant refactor.
 */
export function useOrganiserConfig(): UseOrganiserConfigReturn {
  const { currentClub, clubs, isLoading, isSaving, error, saveCurrentClub, refresh } = useClub();
  return {
    config: currentClub,
    clubs,
    isLoading,
    isSaving,
    error,
    save: saveCurrentClub,
    refresh,
  };
}
