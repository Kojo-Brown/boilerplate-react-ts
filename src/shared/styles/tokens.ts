/**
 * TypeScript token map — typed references to every CSS variable in globals.css.
 *
 * Usage: import { color, spacing, radius, shadow } from '@/shared/styles/tokens'
 *        then use token values in inline styles or motion/animation configs.
 *
 * In Tailwind classes, use the CSS variables directly:
 *   className="bg-[var(--color-bg)] shadow-[var(--shadow-md)]"
 */

// ── Color — neutral primitives ────────────────────────────────────────────────

export const colorNeutral = {
  50: "var(--color-neutral-50)",
  100: "var(--color-neutral-100)",
  200: "var(--color-neutral-200)",
  300: "var(--color-neutral-300)",
  400: "var(--color-neutral-400)",
  500: "var(--color-neutral-500)",
  600: "var(--color-neutral-600)",
  700: "var(--color-neutral-700)",
  800: "var(--color-neutral-800)",
  900: "var(--color-neutral-900)",
  950: "var(--color-neutral-950)",
} as const;

export const colorPrimary = {
  50: "var(--color-primary-50)",
  100: "var(--color-primary-100)",
  200: "var(--color-primary-200)",
  300: "var(--color-primary-300)",
  400: "var(--color-primary-400)",
  500: "var(--color-primary-500)",
  600: "var(--color-primary-600)",
  700: "var(--color-primary-700)",
  800: "var(--color-primary-800)",
  900: "var(--color-primary-900)",
  950: "var(--color-primary-950)",
} as const;

export const colorDanger = {
  50: "var(--color-danger-50)",
  100: "var(--color-danger-100)",
  200: "var(--color-danger-200)",
  300: "var(--color-danger-300)",
  400: "var(--color-danger-400)",
  500: "var(--color-danger-500)",
  600: "var(--color-danger-600)",
  700: "var(--color-danger-700)",
  800: "var(--color-danger-800)",
  900: "var(--color-danger-900)",
  950: "var(--color-danger-950)",
} as const;

export const colorSuccess = {
  50: "var(--color-success-50)",
  100: "var(--color-success-100)",
  200: "var(--color-success-200)",
  300: "var(--color-success-300)",
  400: "var(--color-success-400)",
  500: "var(--color-success-500)",
  600: "var(--color-success-600)",
  700: "var(--color-success-700)",
  800: "var(--color-success-800)",
  900: "var(--color-success-900)",
  950: "var(--color-success-950)",
} as const;

export const colorWarning = {
  50: "var(--color-warning-50)",
  100: "var(--color-warning-100)",
  200: "var(--color-warning-200)",
  300: "var(--color-warning-300)",
  400: "var(--color-warning-400)",
  500: "var(--color-warning-500)",
  600: "var(--color-warning-600)",
  700: "var(--color-warning-700)",
  800: "var(--color-warning-800)",
  900: "var(--color-warning-900)",
  950: "var(--color-warning-950)",
} as const;

// ── Color — semantic tokens ───────────────────────────────────────────────────

export const color = {
  bg: "var(--color-bg)",
  bgSubtle: "var(--color-bg-subtle)",
  fg: "var(--color-fg)",
  fgSubtle: "var(--color-fg-subtle)",
  muted: "var(--color-muted)",
  mutedFg: "var(--color-muted-fg)",
  border: "var(--color-border)",
  borderStrong: "var(--color-border-strong)",
  surface: "var(--color-surface)",
  surfaceRaised: "var(--color-surface-raised)",

  primary: "var(--color-primary)",
  primaryHover: "var(--color-primary-hover)",
  primarySubtle: "var(--color-primary-subtle)",
  primaryFg: "var(--color-primary-fg)",

  danger: "var(--color-danger)",
  dangerHover: "var(--color-danger-hover)",
  dangerSubtle: "var(--color-danger-subtle)",
  dangerFg: "var(--color-danger-fg)",

  success: "var(--color-success)",
  successHover: "var(--color-success-hover)",
  successSubtle: "var(--color-success-subtle)",
  successFg: "var(--color-success-fg)",

  warning: "var(--color-warning)",
  warningHover: "var(--color-warning-hover)",
  warningSubtle: "var(--color-warning-subtle)",
  warningFg: "var(--color-warning-fg)",
} as const;

export type ColorToken = keyof typeof color;

// ── Spacing ───────────────────────────────────────────────────────────────────

export const spacing = {
  px: "var(--spacing-px)",
  0: "var(--spacing-0)",
  "0.5": "var(--spacing-0-5)",
  1: "var(--spacing-1)",
  "1.5": "var(--spacing-1-5)",
  2: "var(--spacing-2)",
  "2.5": "var(--spacing-2-5)",
  3: "var(--spacing-3)",
  "3.5": "var(--spacing-3-5)",
  4: "var(--spacing-4)",
  5: "var(--spacing-5)",
  6: "var(--spacing-6)",
  7: "var(--spacing-7)",
  8: "var(--spacing-8)",
  9: "var(--spacing-9)",
  10: "var(--spacing-10)",
  11: "var(--spacing-11)",
  12: "var(--spacing-12)",
  14: "var(--spacing-14)",
  16: "var(--spacing-16)",
  20: "var(--spacing-20)",
  24: "var(--spacing-24)",
  28: "var(--spacing-28)",
  32: "var(--spacing-32)",
  36: "var(--spacing-36)",
  40: "var(--spacing-40)",
  48: "var(--spacing-48)",
  56: "var(--spacing-56)",
  64: "var(--spacing-64)",
  72: "var(--spacing-72)",
  80: "var(--spacing-80)",
  96: "var(--spacing-96)",
} as const;

export type SpacingToken = keyof typeof spacing;

// ── Border radius ─────────────────────────────────────────────────────────────

export const radius = {
  none: "var(--radius-none)",
  xs: "var(--radius-xs)",
  sm: "var(--radius-sm)",
  md: "var(--radius-md)",
  lg: "var(--radius-lg)",
  xl: "var(--radius-xl)",
  "2xl": "var(--radius-2xl)",
  "3xl": "var(--radius-3xl)",
  full: "var(--radius-full)",
} as const;

export type RadiusToken = keyof typeof radius;

// ── Shadows ───────────────────────────────────────────────────────────────────

export const shadow = {
  none: "var(--shadow-none)",
  xs: "var(--shadow-xs)",
  sm: "var(--shadow-sm)",
  md: "var(--shadow-md)",
  lg: "var(--shadow-lg)",
  xl: "var(--shadow-xl)",
  "2xl": "var(--shadow-2xl)",
  inner: "var(--shadow-inner)",
} as const;

export type ShadowToken = keyof typeof shadow;

// ── Typography ────────────────────────────────────────────────────────────────

export const fontSize = {
  xs: "var(--font-size-xs)",
  sm: "var(--font-size-sm)",
  base: "var(--font-size-base)",
  lg: "var(--font-size-lg)",
  xl: "var(--font-size-xl)",
  "2xl": "var(--font-size-2xl)",
  "3xl": "var(--font-size-3xl)",
  "4xl": "var(--font-size-4xl)",
  "5xl": "var(--font-size-5xl)",
  "6xl": "var(--font-size-6xl)",
} as const;

export const fontWeight = {
  thin: "var(--font-weight-thin)",
  light: "var(--font-weight-light)",
  normal: "var(--font-weight-normal)",
  medium: "var(--font-weight-medium)",
  semibold: "var(--font-weight-semibold)",
  bold: "var(--font-weight-bold)",
  extrabold: "var(--font-weight-extrabold)",
  black: "var(--font-weight-black)",
} as const;

export const leading = {
  none: "var(--leading-none)",
  tight: "var(--leading-tight)",
  snug: "var(--leading-snug)",
  normal: "var(--leading-normal)",
  relaxed: "var(--leading-relaxed)",
  loose: "var(--leading-loose)",
} as const;

export const tracking = {
  tighter: "var(--tracking-tighter)",
  tight: "var(--tracking-tight)",
  normal: "var(--tracking-normal)",
  wide: "var(--tracking-wide)",
  wider: "var(--tracking-wider)",
  widest: "var(--tracking-widest)",
} as const;

export type FontSizeToken = keyof typeof fontSize;
export type FontWeightToken = keyof typeof fontWeight;
export type LeadingToken = keyof typeof leading;
export type TrackingToken = keyof typeof tracking;

// ── Z-index ───────────────────────────────────────────────────────────────────

export const zIndex = {
  base: "var(--z-base)",
  raised: "var(--z-raised)",
  dropdown: "var(--z-dropdown)",
  sticky: "var(--z-sticky)",
  overlay: "var(--z-overlay)",
  modal: "var(--z-modal)",
  popover: "var(--z-popover)",
  toast: "var(--z-toast)",
} as const;

export type ZIndexToken = keyof typeof zIndex;

// ── Transitions ───────────────────────────────────────────────────────────────

export const duration = {
  fast: "var(--duration-fast)",
  base: "var(--duration-base)",
  slow: "var(--duration-slow)",
  slower: "var(--duration-slower)",
} as const;

export const ease = {
  in: "var(--ease-in)",
  out: "var(--ease-out)",
  inout: "var(--ease-inout)",
  spring: "var(--ease-spring)",
} as const;

export type DurationToken = keyof typeof duration;
export type EaseToken = keyof typeof ease;

// ── Token groups (convenient re-export) ──────────────────────────────────────

export const tokens = {
  color,
  colorNeutral,
  colorPrimary,
  colorDanger,
  colorSuccess,
  colorWarning,
  spacing,
  radius,
  shadow,
  fontSize,
  fontWeight,
  leading,
  tracking,
  zIndex,
  duration,
  ease,
} as const;
