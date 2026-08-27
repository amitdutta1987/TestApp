/**
 * Sutaghar's palette, sampled from the logo artwork rather than invented: the
 * saree red and the marigold are the two colours the mark is actually built
 * from, so the app and the shopfront read as one thing.
 *
 * One deliberate departure. The brand colour is red, and red is also the
 * obvious choice for "sold out" and for destructive buttons — using it for all
 * three would make a header, a warning and a delete button look alike. So the
 * brand red owns the chrome, and stock status speaks in green/marigold/stone,
 * where "sold out" reads as *absent* rather than *dangerous*. Only genuinely
 * destructive actions get `danger`, in a brighter red that is distinct from the
 * brand's deeper one.
 */
export const colors = {
  // Warm off-white rather than blue-grey: the logo sits on cream, not paper.
  background: '#FAF6F1',
  surface: '#FFFFFF',
  surfaceAlt: '#F3EDE5',
  border: '#E6DCD0',

  // Saree red — the dominant colour of the mark.
  primary: '#A01918',
  // The mark's deepest shadow tone; used for the status bar and pressed states.
  primaryDark: '#5C130C',
  primarySoft: '#FBEBE9',

  // Marigold, the flower in her hair.
  accent: '#C88228',
  accentSoft: '#FDF1DF',

  text: '#241A16',
  textMuted: '#6B5A52',
  textFaint: '#A2938A',

  success: '#1B7A4B',
  successSoft: '#E4F2EA',
  warning: '#C88228',
  warningSoft: '#FDF1DF',
  // Brighter and cooler than the brand red so a delete button never reads as
  // ordinary brand chrome.
  danger: '#C0392B',
  dangerSoft: '#FBEAE8',
  // "Sold out" is an absence, not an emergency.
  stone: '#6B5A52',
  stoneSoft: '#EFE9E2',

  overlay: 'rgba(36,26,22,0.6)',
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
  // Stone, not red: on a red-branded screen a red badge disappears into the
  // chrome, and an empty rack is not an emergency.
  SOLD_OUT: {fg: colors.stone, bg: colors.stoneSoft, label: 'SOLD OUT'},
} as const;
