import React from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  textColor?: string;
  theme?: 'dark' | 'light';
  tagline?: boolean;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showText = true,
  textColor,
  theme,
  tagline = true,
  className = '',
}) => {
  const isDark = theme === 'dark' || (textColor ? textColor.includes('white') || textColor.includes('slate-100') || textColor.includes('slate-200') : false);

  const iconDimensions = {
    sm: { box: 'w-8 h-8', svg: 32 },
    md: { box: 'w-10 h-10 sm:w-11 sm:h-11', svg: 44 },
    lg: { box: 'w-14 h-14', svg: 56 },
    xl: { box: 'w-20 h-20', svg: 80 },
  }[size];

  const titleSize = {
    sm: 'text-base',
    md: 'text-lg sm:text-xl',
    lg: 'text-2xl sm:text-3xl',
    xl: 'text-4xl',
  }[size];

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* S-Pathway Logo Icon */}
      <div
        className={`${iconDimensions.box} relative rounded-2xl bg-gradient-to-br from-[#1C4C96] via-[#062863] to-[#000035] p-1.5 shadow-md shadow-[#000035]/30 border border-[#9AB4FF]/50 flex items-center justify-center shrink-0 overflow-hidden group`}
      >
        {/* Subtle background glow */}
        <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-[#9AB4FF]/30 blur-sm pointer-events-none" />
        <div className="absolute -bottom-3 -left-3 w-8 h-8 rounded-full bg-[#607EC9]/35 blur-sm pointer-events-none" />

        <svg
          viewBox="0 0 100 100"
          className="w-full h-full drop-shadow-xs"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* S Pathway Gradient: Light Blue -> Medium Blue -> Primary Blue -> Golden Warm */}
            <linearGradient id="pathwayGradient" x1="15" y1="85" x2="85" y2="15" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#9AB4FF" />
              <stop offset="45%" stopColor="#607EC9" />
              <stop offset="75%" stopColor="#9AB4FF" />
              <stop offset="100%" stopColor="#F4CA54" />
            </linearGradient>

            {/* Globe Latitude Arch */}
            <linearGradient id="globeArc" x1="0" y1="50" x2="100" y2="50" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1C4C96" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#9AB4FF" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#1C4C96" stopOpacity="0.3" />
            </linearGradient>

            {/* Sun Glow */}
            <radialGradient id="sunGlow" cx="80" cy="20" r="18" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFF4D0" />
              <stop offset="50%" stopColor="#F4CA54" />
              <stop offset="100%" stopColor="#F4CA54" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Background Globe Meridians / Orbit Ring */}
          <ellipse
            cx="50"
            cy="50"
            rx="40"
            ry="24"
            transform="rotate(-25 50 50)"
            stroke="url(#globeArc)"
            strokeWidth="2.5"
            strokeDasharray="4 3"
          />
          <ellipse
            cx="50"
            cy="50"
            rx="24"
            ry="40"
            transform="rotate(-25 50 50)"
            stroke="url(#globeArc)"
            strokeWidth="1.8"
            strokeDasharray="3 3"
          />

          {/* Fluency Beacon / Rising Sun */}
          <circle cx="80" cy="20" r="9" fill="url(#sunGlow)" />
          <circle cx="80" cy="20" r="4.5" fill="#FFFBEB" />
          <path
            d="M80 10 L80 14 M80 26 L80 30 M70 20 L74 20 M86 20 L90 20"
            stroke="#F4CA54"
            strokeWidth="1.5"
            strokeLinecap="round"
          />

          {/* The "S" Journey Pathway */}
          <path
            d="M 24 78 C 36 86, 68 84, 68 66 C 68 52, 32 48, 32 34 C 32 18, 62 14, 76 22"
            stroke="url(#pathwayGradient)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Inner Road Dashes along S-curve */}
          <path
            d="M 26 78 C 36 85, 66 83, 66 66 C 66 53, 34 47, 34 34 C 34 20, 60 16, 74 22"
            stroke="#000035"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="4 4"
          />

          {/* Sparkles */}
          <circle cx="50" cy="50" r="1.5" fill="#FFFFFF" />
          <circle cx="34" cy="34" r="1.5" fill="#9AB4FF" />
        </svg>
      </div>

      {/* Brand Text */}
      {showText && (
        <div className="flex flex-col">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span
              className={`font-black tracking-tight leading-none ${titleSize} ${
                textColor || (isDark ? 'text-white' : 'text-[#000035]')
              }`}
            >
              It's{' '}
              <span className="inline-block relative font-black tracking-normal">
                <span className={isDark ? 'text-[#F4CA54]' : 'text-[#1C4C96]'}>S</span>
                <span className={isDark ? 'text-white' : 'text-[#000035]'}>imple</span>
                {/* Accent Fluency Dot */}
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#F4CA54] ml-0.5 align-top" />
              </span>
            </span>

            {/* Language Pill Badge */}
            <span
              className={`text-[10px] sm:text-xs px-2 py-0.5 rounded-full font-black tracking-wider uppercase border shadow-2xs ${
                isDark
                  ? 'bg-[#1C4C96]/70 text-[#9AB4FF] border-[#607EC9]'
                  : 'bg-[#9AB4FF]/25 text-[#062863] border-[#607EC9]/40'
              }`}
            >
              English
            </span>
          </div>

          {tagline && (
            <p
              className={`text-[11px] font-medium hidden sm:block mt-0.5 tracking-tight ${
                isDark ? 'text-[#9AB4FF]' : 'text-[#1C4C96]'
              }`}
            >
              Learn English by living your life!
            </p>
          )}
        </div>
      )}
    </div>
  );
};
