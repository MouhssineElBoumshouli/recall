export const colors = {
  background: '#F5F1EA',
  surface: '#FFFDF8',
  ink: '#1D1D1B',
  mutedInk: '#6B6861',
  faintInk: '#918D84',
  line: '#DDD7CD',
  accent: '#B85C46',
  accentSoft: '#F0DDD5',
  success: '#477A65',
  warning: '#9B6C31',
  danger: '#A33D35',
  white: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const typography = {
  eyebrow: 11,
  caption: 13,
  body: 16,
  bodyLarge: 18,
  title: 42,
  display: 56,
  timer: 28,
} as const;

export const radii = {
  sm: 8,
  md: 14,
  lg: 24,
  pill: 999,
} as const;

export const layout = {
  maxContentWidth: 720,
  touchTarget: 48,
} as const;

export const displayFont = 'serif';
