
import React from 'react';

// Jersey icon based on design by Riand from Noun Project

interface ShirtIconProps {
  color: 'black' | 'white';
  className?: string;
}

const ShirtIcon: React.FC<ShirtIconProps> = ({ color, className = "w-16 h-16" }) => {
  const isBlack = color === 'black';
  const fillColor = isBlack ? '#1a1a1a' : '#ffffff';
  const strokeColor = isBlack ? 'none' : '#999';
  const strokeWidth = isBlack ? 0 : 0.5;

  return (
    <svg
      viewBox="0 0 32 32"
      className={`${className} transition-all duration-300`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Collar triangle */}
      <polygon
        points="16 7.56 14.33 4.5 17.67 4.5 16 7.56"
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
      {/* Main jersey body */}
      <path
        d="M29.16,10.29l-2.83,4a.51.51,0,0,1-.41.21.52.52,0,0,1-.29-.09L23.58,13V27a.5.5,0,0,1-.5.5H8.92a.5.5,0,0,1-.5-.5V13l-2,1.45a.52.52,0,0,1-.29.09.51.51,0,0,1-.41-.21l-2.83-4a.51.51,0,0,1,.08-.67l5.67-5,.06,0,.09,0a.35.35,0,0,1,.11,0h4.34l2.37,4.34a.49.49,0,0,0,.88,0L18.81,4.5h4.34a.35.35,0,0,1,.11,0l.09,0,.06,0,5.67,5A.51.51,0,0,1,29.16,10.29Z"
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};

export default ShirtIcon;
