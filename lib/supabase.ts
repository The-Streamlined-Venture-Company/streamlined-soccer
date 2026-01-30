import { createClient } from '@supabase/supabase-js';
import { Database, Profile } from '../types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase environment variables not set. Running in offline mode with localStorage fallback.'
  );
}

// Create a typed Supabase client configured for the soccer schema
export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient<Database, 'soccer'>(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
        db: {
          schema: 'soccer',
        },
      })
    : null;

// Helper to check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}

// Helper function to get the current user's profile
export async function getCurrentProfile(): Promise<Profile | null> {
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }

  return profile;
}

// Helper function to check if user has a specific role
export async function hasRole(role: 'admin' | 'organiser' | 'user'): Promise<boolean> {
  const profile = await getCurrentProfile();
  if (!profile) return false;

  if (role === 'user') return true; // Everyone has at least user role
  if (role === 'organiser') return profile.role === 'admin' || profile.role === 'organiser';
  if (role === 'admin') return profile.role === 'admin';

  return false;
}

// Helper for checking if user can edit players
export async function canEditPlayers(): Promise<boolean> {
  return hasRole('organiser');
}
