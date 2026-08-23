export const colors = {
  background: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF0F4',
  border: '#DFE3EA',
  primary: '#1B5E9C',
  primaryDark: '#134672',
  primarySoft: '#E4EFF9',
  accent: '#0F9D58',
  text: '#161B22',
  textMuted: '#606B7A',
  textFaint: '#98A2B3',
  success: '#0F9D58',
  successSoft: '#E3F5EC',
  warning: '#C77700',
  warningSoft: '#FFF3E0',
  danger: '#C62828',
  dangerSoft: '#FDECEC',
  overlay: 'rgba(0,0,0,0.6)',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 30,
} as const;

export const statusColors = {
  IN_STOCK: {fg: colors.success, bg: colors.successSoft, label: 'IN STOCK'},
  LOW_STOCK: {fg: colors.warning, bg: colors.warningSoft, label: 'LOW STOCK'},
  SOLD_OUT: {fg: colors.danger, bg: colors.dangerSoft, label: 'SOLD OUT'},
} as const;
