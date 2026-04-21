import { useCallback, useEffect, useRef, useState } from 'react';
import { relayClient, GroupParticipant } from '../lib/relayClient';

interface UseGroupParticipantsOptions {
  relayUrl: string | null | undefined;
  chatJid: string | null | undefined;
  /** Set to false to suppress fetching (e.g. while WhatsApp isn't connected). */
  enabled?: boolean;
}

interface UseGroupParticipantsReturn {
  participants: GroupParticipant[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches the participants of a WhatsApp group from the relay.
 *
 * Each participant carries: stable JID (`id`), phone digits, push name, admin flag.
 * Used by the "Match WhatsApp members" onboarding UI.
 */
export function useGroupParticipants({
  relayUrl,
  chatJid,
  enabled = true,
}: UseGroupParticipantsOptions): UseGroupParticipantsReturn {
  const [participants, setParticipants] = useState<GroupParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!relayUrl || !chatJid || !enabled) return;
    const client = relayClient(relayUrl);
    setIsLoading(true);
    setError(null);
    try {
      const data = await client.groupParticipants(chatJid);
      if (!mountedRef.current) return;
      // Stable sort: admins first, then by push name (case-insensitive), then phone
      const sorted = [...data].sort((a, b) => {
        if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
        const an = a.pushName || a.phoneNumber;
        const bn = b.pushName || b.phoneNumber;
        return an.localeCompare(bn, undefined, { sensitivity: 'base' });
      });
      setParticipants(sorted);
    } catch (e) {
      if (!mountedRef.current) return;
      setError((e as Error).message || 'Failed to load participants');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [relayUrl, chatJid, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  return { participants, isLoading, error, refresh };
}
