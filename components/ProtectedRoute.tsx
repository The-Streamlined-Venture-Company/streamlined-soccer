import React, { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types/database';
import LoadingSpinner from './ui/LoadingSpinner';
import Auth from './Auth';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: UserRole;
  fallback?: ReactNode;
  showAuth?: boolean;
}

/**
 * Protects content based on authentication and role requirements.
 *
 * @param children - Content to show when authorized
 * @param requiredRole - Minimum role required (user < organiser < admin)
 * @param fallback - Content to show when not authorized (defaults to Auth component)
 * @param showAuth - Whether to show Auth form when not authenticated (default: true)
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredRole = 'user',
  fallback,
  showAuth = true,
}) => {
  const { isAuthenticated, isLoading, hasRole, isOfflineMode } = useAuth();

  // Show loading while checking auth state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <LoadingSpinner label="Checking authentication..." />
      </div>
    );
  }

  // In offline mode, allow access to everything
  if (isOfflineMode) {
    return <>{children}</>;
  }

  // Not authenticated
  if (!isAuthenticated) {
    if (fallback) {
      return <>{fallback}</>;
    }

    if (showAuth) {
      return (
        <div className="py-8">
          <Auth />
        </div>
      );
    }

    return (
      <div className="p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-slate-800 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-slate-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Sign In Required</h3>
        <p className="text-slate-400 text-sm">Please sign in to access this feature.</p>
      </div>
    );
  }

  // Check role if required
  if (requiredRole !== 'user' && !hasRole(requiredRole)) {
    return (
      <div className="p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-red-500/10 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Access Denied</h3>
        <p className="text-slate-400 text-sm">
          You need <span className="text-emerald-400 font-bold uppercase">{requiredRole}</span>{' '}
          permissions to access this feature.
        </p>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;

/**
 * Hook to check if current user has access
 */
export function useProtected(requiredRole: UserRole = 'user'): {
  hasAccess: boolean;
  isLoading: boolean;
} {
  const { isAuthenticated, hasRole, isLoading, isOfflineMode } = useAuth();

  if (isOfflineMode) {
    return { hasAccess: true, isLoading: false };
  }

  if (isLoading) {
    return { hasAccess: false, isLoading: true };
  }

  if (!isAuthenticated) {
    return { hasAccess: false, isLoading: false };
  }

  return { hasAccess: hasRole(requiredRole), isLoading: false };
}
