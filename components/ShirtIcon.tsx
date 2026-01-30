
import React from 'react';

interface ShirtIconProps {
  color: 'black' | 'white';
  className?: string;
}

const ShirtIcon: React.FC<ShirtIconProps> = ({ color, className = "w-16 h-16" }) => {
  const isBlack = color === 'black';
  const primaryFill = isBlack ? '#1a1a1a' : '#ffffff';
  const secondaryFill = isBlack ? '#333333' : '#f0f0f0';
  const accentStroke = isBlack ? '#444444' : '#e0e0e0';

  return (
    <svg 
      viewBox="0 0 100 100" 
      className={`${className} transition-all duration-300`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`grad-${color}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: primaryFill, stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: isBlack ? '#000000' : '#e6e6e6', stopOpacity: 1 }} />
        </linearGradient>
      </defs>

      {/* Main Body of Jersey */}
      <path 
        d="M25 25 L15 35 L15 50 L25 55 L25 85 L75 85 L75 55 L85 50 L85 35 L75 25 Z" 
        fill={`url(#grad-${color})`}
        stroke={accentStroke} 
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      
      {/* Sleeve Trim */}
      <path d="M15 45 L25 50 M85 45 L75 50" stroke={accentStroke} strokeWidth="2" opacity="0.3" />

      {/* Modern Collar Detail */}
      <path 
        d="M40 25 C40 25 45 35 50 35 C55 35 60 25 60 25" 
        fill="none" 
        stroke={isBlack ? "#555" : "#ccc"} 
        strokeWidth="2" 
        strokeLinecap="round"
      />
      
      {/* Side Stripe Detail */}
      <path d="M28 60 L28 80" stroke={isBlack ? "#333" : "#ddd"} strokeWidth="1" />
      <path d="M72 60 L72 80" stroke={isBlack ? "#333" : "#ddd"} strokeWidth="1" />
    </svg>
  );
};

export default ShirtIcon;
