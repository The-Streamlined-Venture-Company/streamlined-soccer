import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import LoadingSpinner, { ButtonSpinner } from './ui/LoadingSpinner';
import ErrorMessage from './ui/ErrorMessage';

type AuthMode = 'signin' | 'signup';

// Password Reset Component - shown when user clicks recovery link
export const PasswordReset: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    try {
      if (!supabase) {
        setError('Supabase not configured');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        setError(updateError.message);
      } else {
        setSuccess(true);
        setTimeout(() => {
          onComplete();
        }, 2000);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="bg-slate-900/80 backdrop-blur-xl border border-white/5 rounded-3xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-emerald-500/20 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-black text-white uppercase tracking-tight mb-2">Password Updated</h2>
          <p className="text-sm text-slate-400">Redirecting you now...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-slate-900/80 backdrop-blur-xl border border-white/5 rounded-3xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-black text-white uppercase tracking-tight">Set New Password</h2>
          <p className="text-sm text-slate-400 mt-2">Enter your new password below</p>
        </div>

        {error && (
          <div className="mb-6">
            <ErrorMessage error={error} onDismiss={() => setError(null)} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
              New Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min 6 characters..."
              required
              minLength={6}
              className="w-full bg-slate-950 border-2 border-slate-800 rounded-xl p-3 text-white text-sm font-medium focus:border-emerald-500/50 focus:outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password..."
              required
              minLength={6}
              className="w-full bg-slate-950 border-2 border-slate-800 rounded-xl p-3 text-white text-sm font-medium focus:border-emerald-500/50 focus:outline-none transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:cursor-not-allowed text-white rounded-xl font-black uppercase tracking-widest text-sm transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <ButtonSpinner />
                Updating...
              </>
            ) : (
              'Update Password'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

interface AuthProps {
  onSuccess?: () => void;
  initialMode?: AuthMode;
}

const Auth: React.FC<AuthProps> = ({ onSuccess, initialMode = 'signin' }) => {
  const { signIn, signUp, isOfflineMode } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      if (mode === 'signin') {
        const { error: signInError } = await signIn(email, password);
        if (signInError) {
          setError(signInError.message);
        } else {
          onSuccess?.();
        }
      } else {
        const { error: signUpError } = await signUp(email, password, fullName);
        if (signUpError) {
          setError(signUpError.message);
        } else {
          setSuccessMessage('Check your email for a confirmation link!');
          setMode('signin');
        }
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (isOfflineMode) {
    return (
      <div className="w-full max-w-md mx-auto p-6 bg-slate-900 rounded-3xl border border-slate-800">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 bg-amber-500/10 rounded-full flex items-center justify-center">
            <svg
              className="w-6 h-6 text-amber-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-black text-white uppercase tracking-tight mb-2">
            Offline Mode
          </h2>
          <p className="text-sm text-slate-400 mb-4">
            Supabase is not configured. The app is running in offline mode with local storage.
          </p>
          <p className="text-xs text-slate-500">
            To enable authentication, add your Supabase credentials to the environment variables.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-slate-900/80 backdrop-blur-xl border border-white/5 rounded-3xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-black text-white uppercase tracking-tight">
            {mode === 'signin' ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-sm text-slate-400 mt-2">
            {mode === 'signin'
              ? 'Sign in to manage your squad'
              : 'Sign up to get started'}
          </p>
        </div>

        {error && (
          <div className="mb-6">
            <ErrorMessage error={error} onDismiss={() => setError(null)} />
          </div>
        )}

        {successMessage && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <p className="text-sm text-emerald-400">{successMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Your name..."
                className="w-full bg-slate-950 border-2 border-slate-800 rounded-xl p-3 text-white text-sm font-medium focus:border-emerald-500/50 focus:outline-none transition-all"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full bg-slate-950 border-2 border-slate-800 rounded-xl p-3 text-white text-sm font-medium focus:border-emerald-500/50 focus:outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'Min 6 characters...' : 'Your password...'}
              required
              minLength={6}
              className="w-full bg-slate-950 border-2 border-slate-800 rounded-xl p-3 text-white text-sm font-medium focus:border-emerald-500/50 focus:outline-none transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:cursor-not-allowed text-white rounded-xl font-black uppercase tracking-widest text-sm transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <ButtonSpinner />
                {mode === 'signin' ? 'Signing In...' : 'Creating Account...'}
              </>
            ) : mode === 'signin' ? (
              'Sign In'
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
              setSuccessMessage(null);
            }}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            {mode === 'signin' ? (
              <>
                Don't have an account?{' '}
                <span className="text-emerald-400 font-bold">Sign Up</span>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <span className="text-emerald-400 font-bold">Sign In</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;

// Mini auth button for header
// Hidden by default - triple-click the app title to show login
export const AuthButton: React.FC = () => {
  const { isAuthenticated, profile, signOut, isLoading } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Listen for secret trigger (custom event from title clicks)
  React.useEffect(() => {
    const handleSecretLogin = () => setShowAuthModal(true);
    window.addEventListener('secretLogin', handleSecretLogin);
    return () => window.removeEventListener('secretLogin', handleSecretLogin);
  }, []);

  if (isLoading) {
    return <LoadingSpinner size="sm" />;
  }

  if (!isAuthenticated) {
    return (
      <>
        {/* Hidden - triggered by triple-clicking app title */}
        {showAuthModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="relative w-full max-w-md">
              <button
                onClick={() => setShowAuthModal(false)}
                className="absolute -top-12 right-0 text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <Auth onSuccess={() => setShowAuthModal(false)} />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all"
      >
        <div className="w-6 h-6 bg-emerald-500/20 rounded-full flex items-center justify-center">
          <span className="text-emerald-400 text-xs font-black uppercase">
            {profile?.full_name?.charAt(0) || profile?.email?.charAt(0) || 'U'}
          </span>
        </div>
        <span className="text-sm text-slate-300 font-medium max-w-[100px] truncate">
          {profile?.full_name || profile?.email?.split('@')[0] || 'User'}
        </span>
        <svg
          className={`w-4 h-4 text-slate-500 transition-transform ${showMenu ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="p-3 border-b border-slate-800">
              <p className="text-xs text-slate-500 uppercase tracking-widest">Signed in as</p>
              <p className="text-sm text-white font-medium truncate">{profile?.email}</p>
              {profile?.role && profile.role !== 'user' && (
                <span className="inline-block mt-1 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-bold uppercase rounded">
                  {profile.role}
                </span>
              )}
            </div>
            <button
              onClick={() => {
                signOut();
                setShowMenu(false);
              }}
              className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
};
