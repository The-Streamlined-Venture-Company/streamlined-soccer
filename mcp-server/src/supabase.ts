/**
 * Supabase client for MCP Server (Node.js)
 *
 * Connects to the same database as the web app and edge functions.
 */

import { createClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseInstance: ReturnType<typeof createClient<any, 'soccer'>> | null = null;

export function getSupabaseClient() {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n' +
      'Set them in your Claude Desktop config or export them before running.'
    );
  }

  // Create client with soccer schema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseInstance = createClient<any, 'soccer'>(supabaseUrl, supabaseServiceKey, {
    db: { schema: 'soccer' }
  });

  return supabaseInstance;
}
