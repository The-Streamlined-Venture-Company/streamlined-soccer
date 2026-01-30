import { supabase } from '../lib/supabase';

export interface AIPlayerResult {
  name: string;
  team: 'black' | 'white';
}

interface ParsePlayersResponse {
  playerNames?: string[];
  players?: AIPlayerResult[]; // Legacy support
  error?: string;
}

/**
 * Parse player names from text or image using AI (via secure Edge Function)
 * Returns just the names - team assignment happens client-side with balancing
 */
export async function parsePlayerNamesWithAI(
  input?: string,
  imageBase64?: string,
  imageMimeType?: string
): Promise<string[]> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  // Get the current session for auth
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('You must be signed in to use AI features');
  }

  // Call the Edge Function
  console.log('AI Service: calling ai-parse-players function...');
  console.log('AI Service: has text:', !!input, 'has image:', !!imageBase64);

  let data: ParsePlayersResponse | null = null;
  let error: Error | null = null;

  try {
    const response = await supabase.functions.invoke<ParsePlayersResponse>('ai-parse-players', {
      body: {
        text: input,
        imageBase64,
        imageMimeType,
      },
    });
    data = response.data;
    error = response.error;
    console.log('AI Service: response received', { data, error });
  } catch (e) {
    console.error('AI Service: invoke threw exception:', e);
    throw e;
  }

  if (error) {
    console.error('AI service error:', error);
    throw new Error(error.message || 'Failed to parse players');
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  // New format returns playerNames, legacy returns players
  if (data?.playerNames) {
    return data.playerNames;
  }

  // Legacy fallback - extract names from players array
  if (data?.players) {
    return data.players.map(p => p.name);
  }

  return [];
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use parsePlayerNamesWithAI + balanceTeams instead
 */
export async function parsePlayersWithAI(
  input?: string,
  imageBase64?: string,
  imageMimeType?: string
): Promise<AIPlayerResult[]> {
  const names = await parsePlayerNamesWithAI(input, imageBase64, imageMimeType);
  // Simple alternating assignment (not balanced)
  return names.map((name, i) => ({
    name,
    team: i < 6 ? 'black' as const : 'white' as const,
  }));
}
