import React from 'react';
import Svg, { Path, Rect, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

interface TedBuyLogoProps {
  size?: number;
}

/** The real TedBuy mark (matches public/favicon.svg on web exactly — a
 * shopping bag with a bold "T" and a cyan accent dot) — mobile's header
 * badge was rendering a plain letter "T" instead of this. */
export function TedBuyLogo({ size = 24 }: TedBuyLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient id="bagGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#1e293b" />
          <Stop offset="50%" stopColor="#151e2e" />
          <Stop offset="100%" stopColor="#0b111e" />
        </LinearGradient>
        <LinearGradient id="handleGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#475569" />
          <Stop offset="50%" stopColor="#334155" />
          <Stop offset="100%" stopColor="#1e293b" />
        </LinearGradient>
      </Defs>

      {/* Bag Handle (Arched Top) */}
      <Path
        d="M 172,180 C 172,110 210,72 256,72 C 302,72 340,110 340,180"
        stroke="url(#handleGradient)"
        strokeWidth={36}
        fill="none"
        strokeLinecap="round"
      />

      {/* Bag Body */}
      <Path
        d="M 124,172 L 388,172 C 408,172 422,188 419,208 L 389,442 C 386,460 371,474 353,474 L 159,474 C 141,474 126,460 123,442 L 93,208 C 90,188 104,172 124,172 Z"
        fill="url(#bagGradient)"
      />

      {/* Bold 'T' */}
      <Rect x={166} y={232} width={180} height={44} rx={16} fill="#ffffff" />
      <Rect x={234} y={232} width={44} height={144} rx={16} fill="#ffffff" />

      {/* Signature cyan dot */}
      <Circle cx={256} cy={418} r={14} fill="#38bdf8" />
    </Svg>
  );
}
