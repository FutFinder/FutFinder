// Paleta oficial de FutFinder
export const colors = {
  // Fondos
  background: '#201F1D',
  surface: '#2A2927',
  surfaceAlt: '#1A1918',

  // Verdes corporativos
  primary: '#71B533',
  primaryDark: '#3F762F',
  primarySoft: 'rgba(113, 181, 51, 0.12)',

  // Texto
  textPrimary: '#FFFFFF',
  textSecondary: '#A7A7A5',
  textMuted: '#6F6E6C',

  // Estados
  error: '#E5484D',
  errorSoft: 'rgba(229, 72, 77, 0.12)',
  success: '#71B533',

  // Bordes
  border: '#3A3936',
  borderSoft: '#2F2E2C',
};

/**
 * Tokens del rediseño (extraídos del diseño de referencia).
 *
 * Nació con el rediseño de Clubes y ahora también lo usa el perfil de
 * jugador, así que es el sistema visual "nuevo" de la app: fondo más oscuro
 * con matiz verde y un verde de acción más brillante que `colors.primary`.
 *
 * Sigue conviviendo con `colors` a propósito: las pantallas que aún no se
 * rediseñan (Inicio, Partidos, Chat, Avisos…) usan la paleta global, y
 * cambiarla de golpe restilizaría toda la app.
 */
export const dsColors = {
  // Fondos
  background: '#0B0D0C',
  surface: '#141715',
  surfaceAlt: '#0E1110',
  surfaceHover: '#181C19',

  // Verdes de acción
  green: '#5AE06A',
  greenDark: '#3FBF52',
  greenInk: '#06210C', // texto/icono sobre verde brillante
  greenSoft: 'rgba(90, 224, 106, 0.12)',
  greenSoftStrong: 'rgba(90, 224, 106, 0.20)',
  greenBorder: 'rgba(90, 224, 106, 0.35)',
  greenGlow: 'rgba(90, 224, 106, 0.22)',

  // Banner del héroe
  bannerFrom: '#173A1C',
  bannerMid: '#0F1F12',
  bannerTo: '#101312',

  // Texto
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.55)',
  textMuted: 'rgba(255, 255, 255, 0.45)',
  textFaint: 'rgba(255, 255, 255, 0.32)',

  // Resultados de partido
  win: '#5AE06A',
  winSoft: 'rgba(90, 224, 106, 0.14)',
  draw: '#E0C25A',
  drawSoft: 'rgba(224, 194, 90, 0.14)',
  loss: '#E8737B',
  lossSoft: 'rgba(232, 115, 123, 0.14)',

  // Premium
  gold: '#F0C85A',
  goldSoft: 'rgba(240, 200, 90, 0.14)',

  // Superficies neutras e insignias
  chip: 'rgba(255, 255, 255, 0.06)',
  chipStrong: 'rgba(255, 255, 255, 0.10)',
  border: 'rgba(255, 255, 255, 0.12)',
  borderSoft: 'rgba(255, 255, 255, 0.08)',
  divider: 'rgba(255, 255, 255, 0.07)',
};

/** Radios, alturas y espaciados del rediseño de club. */
export const dsRadius = {
  chip: 9,
  icon: 10,
  sm: 12,
  md: 14,
  lg: 18,
  xl: 20,
  hero: 24,
  sheet: 28,
};

export const dsSizes = {
  gutter: 16, // margen lateral de la pantalla
  iconBtn: 40, // botones cuadrados de la barra de club (con hitSlop → ≥44)
  tapBtn: 44, // botones que ya cumplen el mínimo táctil sin hitSlop
  actionBtn: 58, // botón "Crear desafío" y lupa
  logo: 72,
  rivalCard: 196,
};

// Alias retrocompatibles: los componentes de club ya importan estos nombres.
export const clubColors = dsColors;
export const clubRadius = dsRadius;
export const clubSizes = dsSizes;

export const fonts = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};
