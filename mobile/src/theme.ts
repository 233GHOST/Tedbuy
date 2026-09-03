/**
 * Shared design tokens, mirroring the web app's Tailwind palette
 * (src/index.css + the slate/orange/emerald usage across src/components).
 * Web's primary action color is near-black slate-900; orange is a minor
 * accent (wordmark, "View all" links) — not a CTA color. Keep that hierarchy
 * here so mobile and web read as the same product.
 */

export const colors = {
  // Primary — near-black slate, used for CTAs, headers, nav chrome.
  primary: '#0f172a', // slate-900
  primaryHover: '#1e293b', // slate-800
  primaryDark: '#020617', // slate-950

  // Accent — orange, used sparingly (wordmark, links, small badges only).
  accent: '#ea580c', // orange-600
  accentLight: '#f97316', // orange-500

  // Semantic
  success: '#059669', // emerald-600 (matches web's WhatsApp CTA)
  successDark: '#047857', // emerald-700
  danger: '#e11d48', // rose-600
  dangerLight: '#f43f5e', // rose-500
  warning: '#f59e0b', // amber-500
  info: '#4f46e5', // indigo-600

  // Backgrounds
  bg: '#f8fafc', // slate-50
  surface: '#ffffff',
  surfaceAlt: '#f1f5f9', // slate-100

  // Borders
  border: '#e2e8f0', // slate-200
  borderStrong: '#cbd5e1', // slate-300

  // Text
  text: '#0f172a', // slate-900
  textStrong: '#020617', // slate-950
  textMuted: '#64748b', // slate-500
  textFaint: '#94a3b8', // slate-400
  textOnDark: '#f8fafc',
  textOnDarkMuted: '#94a3b8',
} as const;

export const radius = {
  sm: 8,
  md: 12, // matches web's rounded-xl default
  lg: 16, // matches web's rounded-2xl (cards)
  xl: 24, // matches web's rounded-3xl (hero/section panels)
  full: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// Plus Jakarta Sans — same family web loads in src/index.css.
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;
