
import React from 'react';

// Jersey icon based on design by Berkah Icon from Noun Project

interface ShirtIconProps {
  color: 'black' | 'white';
  className?: string;
}

const ShirtIcon: React.FC<ShirtIconProps> = ({ color, className = "w-16 h-16" }) => {
  const isBlack = color === 'black';
  const fillColor = isBlack ? '#1a1a1a' : '#ffffff';
  const strokeColor = isBlack ? 'none' : '#888';
  const strokeWidth = isBlack ? 0 : 1.5;

  return (
    <svg
      viewBox="0 0 100 110"
      className={`${className} transition-all duration-300`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth}>
        {/* Left sleeve */}
        <path d="m0 35.938 18.75 14.062v-16.68l-10.012-13.766z" />
        {/* Right sleeve */}
        <path d="m91.262 19.555-10.012 13.766v16.547l18.75-13.93z" />
        {/* Main body */}
        <path d="m88.805 14.949c-0.83203-1.5586-2.2852-2.6953-4-3.1211l-22.309-5.5781c0 6.9023-5.5977 12.5-12.5 12.5s-12.5-5.5977-12.5-12.5l-22.309 5.5781c-1.7148 0.42969-3.168 1.5625-4 3.1211l-0.82031 1.5391 11.203 15.406c0.19531 0.26562 0.29688 0.58984 0.29688 0.92188v60.938h56.25l0.007812-60.941c0-0.33203 0.10547-0.65234 0.29688-0.92188l11.203-15.406-0.82031-1.5391zm-51.305 72.551h-9.375v-6.25h9.375zm26.562-48.438c-2.5898 0-4.6875-2.0977-4.6875-4.6875s2.0977-4.6875 4.6875-4.6875 4.6875 2.0977 4.6875 4.6875-2.0977 4.6875-4.6875 4.6875z" />
      </g>
    </svg>
  );
};

export default ShirtIcon;
