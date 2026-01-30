
import React from 'react';

interface ShirtIconProps {
  color: 'black' | 'white';
  className?: string;
}

const ShirtIcon: React.FC<ShirtIconProps> = ({ color, className = "w-16 h-16" }) => {
  const isBlack = color === 'black';

  return (
    <svg
      viewBox="0 0 100 100"
      className={`${className} transition-all duration-300`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Main gradient for depth */}
        <linearGradient id={`body-${color}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={isBlack ? '#2a2a2a' : '#ffffff'} />
          <stop offset="100%" stopColor={isBlack ? '#0a0a0a' : '#e8e8e8'} />
        </linearGradient>

        {/* Sleeve shadow */}
        <linearGradient id={`sleeve-${color}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={isBlack ? '#1a1a1a' : '#f5f5f5'} />
          <stop offset="100%" stopColor={isBlack ? '#0a0a0a' : '#ddd'} />
        </linearGradient>

        {/* Inner shadow for depth */}
        <filter id={`shadow-${color}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity={isBlack ? "0.4" : "0.15"}/>
        </filter>
      </defs>

      {/* Left Sleeve */}
      <path
        d="M30 22 L8 38 L8 52 L22 48 L22 32 Z"
        fill={`url(#sleeve-${color})`}
        filter={`url(#shadow-${color})`}
      />

      {/* Right Sleeve */}
      <path
        d="M70 22 L92 38 L92 52 L78 48 L78 32 Z"
        fill={`url(#sleeve-${color})`}
        filter={`url(#shadow-${color})`}
      />

      {/* Main Body */}
      <path
        d="M30 22 L30 88 L70 88 L70 22 C70 22 60 28 50 28 C40 28 30 22 30 22 Z"
        fill={`url(#body-${color})`}
        filter={`url(#shadow-${color})`}
      />

      {/* Collar */}
      <path
        d="M35 22 C35 22 42 30 50 30 C58 30 65 22 65 22"
        fill="none"
        stroke={isBlack ? '#444' : '#ccc'}
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Collar inner */}
      <path
        d="M38 24 C38 24 44 29 50 29 C56 29 62 24 62 24"
        fill="none"
        stroke={isBlack ? '#222' : '#e0e0e0'}
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Subtle center seam */}
      <line
        x1="50" y1="32" x2="50" y2="85"
        stroke={isBlack ? '#1a1a1a' : '#ddd'}
        strokeWidth="0.5"
        opacity="0.5"
      />

      {/* Bottom hem */}
      <line
        x1="32" y1="86" x2="68" y2="86"
        stroke={isBlack ? '#333' : '#ccc'}
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Sleeve cuffs */}
      <path
        d="M8 50 L22 46"
        stroke={isBlack ? '#333' : '#ccc'}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M92 50 L78 46"
        stroke={isBlack ? '#333' : '#ccc'}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default ShirtIcon;
