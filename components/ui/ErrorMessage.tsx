import React from 'react';
import { AppError } from '../../types';

interface ErrorMessageProps {
  error: AppError | string | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  variant?: 'inline' | 'banner' | 'toast';
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({
  error,
  onDismiss,
  onRetry,
  variant = 'inline',
}) => {
  if (!error) return null;

  const message = typeof error === 'string' ? error : error.message;
  const code = typeof error === 'object' ? error.code : undefined;
  const details = typeof error === 'object' ? error.details : undefined;

  if (variant === 'banner') {
    return (
      <div className="w-full bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 bg-red-500/20 rounded-full flex items-center justify-center">
            <svg
              className="w-4 h-4 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-400">{message}</p>
            {code && (
              <p className="mt-1 text-xs text-red-400/60 font-mono">
                Error code: {code}
              </p>
            )}
            {details && (
              <p className="mt-1 text-xs text-slate-400">{details}</p>
            )}
          </div>

          <div className="flex gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
              >
                Retry
              </button>
            )}
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="p-1.5 hover:bg-red-500/20 rounded-lg transition-all"
              >
                <svg
                  className="w-4 h-4 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'toast') {
    return (
      <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="bg-slate-900 border border-red-500/30 rounded-xl p-4 shadow-2xl max-w-sm">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 bg-red-500/20 rounded-full flex items-center justify-center">
              <svg
                className="w-3 h-3 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01"
                />
              </svg>
            </div>

            <div className="flex-1">
              <p className="text-sm font-bold text-white">{message}</p>
              {details && (
                <p className="mt-1 text-xs text-slate-400">{details}</p>
              )}
            </div>

            {onDismiss && (
              <button
                onClick={onDismiss}
                className="p-1 hover:bg-slate-800 rounded-lg transition-all"
              >
                <svg
                  className="w-4 h-4 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>

          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-3 w-full px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  // Default inline variant
  return (
    <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
      <svg
        className="w-4 h-4 text-red-500 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span className="text-sm text-red-400 font-medium">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-auto p-1 hover:bg-red-500/20 rounded transition-all"
        >
          <svg
            className="w-3 h-3 text-red-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
};

export default ErrorMessage;

// Success message variant
interface SuccessMessageProps {
  message: string;
  onDismiss?: () => void;
}

export const SuccessMessage: React.FC<SuccessMessageProps> = ({
  message,
  onDismiss,
}) => {
  return (
    <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
      <svg
        className="w-4 h-4 text-emerald-500 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 13l4 4L19 7"
        />
      </svg>
      <span className="text-sm text-emerald-400 font-medium">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-auto p-1 hover:bg-emerald-500/20 rounded transition-all"
        >
          <svg
            className="w-3 h-3 text-emerald-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
};
