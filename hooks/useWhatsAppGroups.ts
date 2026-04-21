import { useCallback, useEffect, useRef, useState } from 'react';
import { relayClient, Group } from '../lib/relayClient';

interface UseWhatsAppGroupsOptions {
  relayUrl: string | null | undefined;
  /** Set to false to suppress the initial fetch (useful while WhatsApp isn't connected yet). */
  enabled?: boolean;
}

interface UseWhatsAppGroupsReturn {
  groups: Group[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useWhatsAppGroups({
  relayUrl,
  enabled = true,
}: UseWhatsAppGroupsOptions): UseWhatsAppGroupsReturn {
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!relayUrl || !enabled) return;
    const client = relayClient(relayUrl);
    setIsLoading(true);
    setError(null);
    try {
      const data = await client.groups();
      if (!mountedRef.current) return;
      // Sort: case-insensitive by name
      const sorted = [...data].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
      setGroups(sorted);
    } catch (e) {
      if (!mountedRef.current) return;
      setError((e as Error).message || 'Failed to load groups');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [relayUrl, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  return { groups, isLoading, error, refresh };
}
