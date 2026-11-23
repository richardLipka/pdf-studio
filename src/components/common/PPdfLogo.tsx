import React from 'react';
import { AppTheme } from '../../context/ThemeContext';

interface PPdfLogoProps {
  theme?: AppTheme;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Vector P-PDF monogram logo for PilsenPDF, adapting to Studio (dark), Minimal (light), and LCARS themes.
 */
export const PPdfLogo: React.FC<PPdfLogoProps> = ({ theme = 'default', size = 'md', className = '' }) => {
  const isMinimal = theme === 'minimal';
  const isLcars = theme === 'lcars';

  const dim = size === 'lg' ? 'w-14 h-14' : size === 'sm' ? 'w-8 h-8' : 'w-9 h-9';
  const bgFill = isMinimal ? '#000000' : isLcars ? '#ff9900' : 'url(#ppdf-grad)';
  const fgFill = isLcars ? '#000000' : '#ffffff';
  const pillFill = isMinimal ? '#ffffff' : isLcars ? '#000000' : '#0f172a';
  const pillStroke = isMinimal ? '#000000' : isLcars ? '#ff9900' : '#38bdf8';
  const pillText = isMinimal ? '#000000' : isLcars ? '#ff9900' : '#38bdf8';

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-label="P-PDF Logo"
      className={`${dim} shrink-0 select-none ${className}`}
    >
      {!isMinimal && !isLcars && (
        <defs>
          <linearGradient id="ppdf-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
        </defs>
      )}
      <rect width="64" height="64" rx={isLcars ? '32' : isMinimal ? '10' : '15'} fill={bgFill} />
      <path
        d="M14 11C14 8.79086 15.7909 7 18 7H37L50 20V53C50 55.2091 48.2091 57 46 57H18C15.7909 57 14 55.2091 14 53V11Z"
        fill={fgFill}
        fillOpacity={isLcars ? 0.12 : 0.16}
        stroke={fgFill}
        strokeOpacity={isLcars ? 0.55 : 0.45}
        strokeWidth="2"
      />
      <path
        d="M37 7V20H50"
        stroke={fgFill}
        strokeOpacity="0.7"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M23 39V17H32.5C36.6421 17 39.5 19.6863 39.5 23.75C39.5 27.8137 36.6421 30.5 32.5 30.5H27.8V39H23ZM27.8 26.5H32.1C33.9 26.5 35 25.4 35 23.75C35 22.1 33.9 21 32.1 21H27.8V26.5Z"
        fill={fgFill}
      />
      <rect x="9" y="42" width="46" height="14" rx="4.5" fill={pillFill} stroke={pillStroke} strokeWidth="1.6" />
      <text
        x="32"
        y="52.3"
        textAnchor="middle"
        fill={pillText}
        fontFamily="Inter, system-ui, -apple-system, Segoe UI, Arial, sans-serif"
        fontWeight="800"
        fontSize="10.2"
        letterSpacing="0.8"
      >
        P-PDF
      </text>
    </svg>
  );
};
