import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User, AuthError, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Profile, UserRole } from '../types/database';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isOfflineMode: boolean;
  isPasswordRecovery: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasRole: (role: UserRole) => boolean;
  canEditPlayers: boolean;
  clearPasswordRecovery: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

// Check for recovery mode IMMEDIATELY on module load (before React renders)
const checkRecoveryOnLoad = (): boolean => {
  const hash = window.location.hash;
  const isRecovery = hash.includes('type=recovery');
  console.log('Initial recovery check:', isRecovery, 'hash:', hash.substring(0, 100));
  return isRecovery;
};

const initialRecoveryMode = checkRecoveryOnLoad();

export function AuthProvider({ children }: AuthProviderProps): React.ReactElement {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    session: null,
    isLoading: !initialRecoveryMode, // Don't show loading if recovery mode
    isAuthenticated: false,
    isOfflineMode: !isSupabaseConfigured(),
    isPasswordRecovery: initialRecoveryMode,
  });

  // Fetch user profile from database with timeout
  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    if (!supabase) return null;

    console.log('fetchProfile: starting for', userId);

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise<null>((_, reject) => {
      setTimeout(() => reject(new Error('Profile fetch timeout')), 3000);
    });

    try {
      const result = await Promise.race([
        supabase
          .from('app_users')
          .select('*')
          .eq('id', userId)
          .single(),
        timeoutPromise,
      ]);

      if (!result || 'message' in result) {
        console.log('fetchProfile: timeout or error');
        return null;
      }

      const { data, error } = result;

      if (error) {
        console.error('fetchProfile: error:', error);
        return null;
      }

      console.log('fetchProfile: success:', data);
      return data;
    } catch (err) {
      console.error('fetchProfile: exception:', err);
      return null;
    }
  }, []);

  // Initialize auth state
  useEffect(() => {
    if (!supabase) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    // Check URL for recovery tokens (Supabase puts them in hash fragment)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const urlParams = new URLSearchParams(window.location.search);
    const fullUrl = window.location.href;

    // Multiple ways to detect recovery mode
    const isRecoveryFromHash = hashParams.get('type') === 'recovery';
    const isRecoveryFromQuery = urlParams.get('type') === 'recovery';
    const hasAccessToken = hashParams.has('access_token') || fullUrl.includes('access_token');
    const hasRecoveryInUrl = fullUrl.includes('type=recovery') || fullUrl.includes('recovery');

    console.log('=== Auth Debug ===');
    console.log('Full URL:', fullUrl);
    console.log('Hash:', window.location.hash);
    console.log('Search:', window.location.search);
    console.log('isRecoveryFromHash:', isRecoveryFromHash);
    console.log('isRecoveryFromQuery:', isRecoveryFromQuery);
    console.log('hasAccessToken:', hasAccessToken);
    console.log('hasRecoveryInUrl:', hasRecoveryInUrl);

    const shouldShowRecovery = isRecoveryFromHash || isRecoveryFromQuery || (hasAccessToken && hasRecoveryInUrl) || initialRecoveryMode;

    // If recovery mode, just set state and wait - don't process normal auth flow
    if (shouldShowRecovery) {
      console.log('Recovery mode active - showing password reset');
      // Clean up URL immediately
      window.history.replaceState({}, '', window.location.pathname);

      // Let Supabase establish the session in background, but keep showing recovery modal
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        console.log('Recovery session established:', session ? 'yes' : 'no');
        setState(prev => ({
          ...prev,
          isPasswordRecovery: true,
          isLoading: false,
          user: session?.user || null,
          session: session || null,
          isAuthenticated: !!session,
        }));
      });
      return;
    }

    // Normal auth flow (not recovery)
    console.log('Starting getSession...');
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        console.log('Got session:', session ? 'yes' : 'no', session?.user?.email);
        if (session?.user) {
          console.log('Fetching profile for:', session.user.id);
          const profile = await fetchProfile(session.user.id);
          console.log('Profile fetched:', profile);
          setState({
            user: session.user,
            profile,
            session,
            isLoading: false,
            isAuthenticated: true,
            isOfflineMode: false,
            isPasswordRecovery: false,
          });
          console.log('Auth state set to authenticated');
        } else {
          console.log('No session, setting not authenticated');
          setState(prev => ({ ...prev, isLoading: false, isPasswordRecovery: false }));
        }
      })
      .catch((error) => {
        console.error('getSession error:', error);
        setState(prev => ({ ...prev, isLoading: false }));
      });

    // Fallback timeout - if auth takes too long, show login screen
    const timeout = setTimeout(() => {
      setState(prev => {
        if (prev.isLoading) {
          console.log('Auth timeout - showing login');
          return { ...prev, isLoading: false };
        }
        return prev;
      });
    }, 5000);

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state change event:', event, 'session:', session ? 'yes' : 'no');

      // Check for password recovery flow
      if (event === 'PASSWORD_RECOVERY') {
        console.log('Password recovery event detected');
        setState(prev => ({
          ...prev,
          isPasswordRecovery: true,
          isLoading: false,
        }));
        return;
      }

      if (session?.user) {
        console.log('Auth change: user signed in:', session.user.email);
        try {
          const profile = await fetchProfile(session.user.id);
          console.log('Auth change: profile:', profile);
          setState({
            user: session.user,
            profile,
            session,
            isLoading: false,
            isAuthenticated: true,
            isOfflineMode: false,
            isPasswordRecovery: false,
          });
        } catch (err) {
          console.error('Auth change: profile fetch failed:', err);
          // Still authenticate even if profile fails
          setState({
            user: session.user,
            profile: null,
            session,
            isLoading: false,
            isAuthenticated: true,
            isOfflineMode: false,
            isPasswordRecovery: false,
          });
        }
      } else {
        console.log('Auth change: signed out');
        setState({
          user: null,
          profile: null,
          session: null,
          isLoading: false,
          isAuthenticated: false,
          isOfflineMode: false,
          isPasswordRecovery: false,
        });
      }
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [fetchProfile]);

  // Sign in with email and password
  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      return { error: { message: 'Supabase not configured' } as AuthError };
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return { error };
  }, []);

  // Sign up with email and password
  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    if (!supabase) {
      return { error: { message: 'Supabase not configured' } as AuthError };
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    return { error };
  }, []);

  // Sign out
  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  // Refresh profile data
  const refreshProfile = useCallback(async () => {
    if (state.user) {
      const profile = await fetchProfile(state.user.id);
      setState(prev => ({ ...prev, profile }));
    }
  }, [state.user, fetchProfile]);

  // Check if user has a specific role
  const hasRole = useCallback(
    (role: UserRole): boolean => {
      if (!state.profile) return false;

      if (role === 'user') return true;
      if (role === 'organiser') {
        return state.profile.role === 'admin' || state.profile.role === 'organiser';
      }
      if (role === 'admin') {
        return state.profile.role === 'admin';
      }

      return false;
    },
    [state.profile]
  );

  // Computed value for player edit permission
  // Simple for now: any authenticated user can edit (it's just you!)
  // Later: check profile.role when multi-tenant
  // Don't show admin UI during password recovery
  const canEditPlayers = state.isAuthenticated && !state.isPasswordRecovery;

  // Clear password recovery state
  const clearPasswordRecovery = useCallback(() => {
    setState(prev => ({ ...prev, isPasswordRecovery: false }));
  }, []);

  const value: AuthContextValue = {
    ...state,
    signIn,
    signUp,
    signOut,
    refreshProfile,
    hasRole,
    canEditPlayers,
    clearPasswordRecovery,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
