import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'emerald' | 'white' | 'slate';
  label?: string;
  fullScreen?: boolean;
}

const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-10 h-10 border-3',
};

const colorClasses = {
  emerald: 'border-emerald-500/20 border-t-emerald-500',
  white: 'border-white/20 border-t-white',
  slate: 'border-slate-500/20 border-t-slate-500',
};

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  color = 'emerald',
  label,
  fullScreen = false,
}) => {
  const spinner = (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`${sizeClasses[size]} ${colorClasses[color]} rounded-full animate-spin`}
      />
      {label && (
        <span className="text-xs font-black uppercase tracking-widest text-slate-400">
          {label}
        </span>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50">
        {spinner}
      </div>
    );
  }

  return spinner;
};

export default LoadingSpinner;

// Inline spinner for buttons
export const ButtonSpinner: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin ${className}`}
  />
);

// Skeleton loader for content
interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'text',
}) => {
  const variantClasses = {
    text: 'h-4 rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-xl',
  };

  return (
    <div
      className={`bg-slate-800 animate-pulse ${variantClasses[variant]} ${className}`}
    />
  );
};
