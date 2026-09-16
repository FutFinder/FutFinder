// =============================================================
// La estética de FutFinder. UNA sola.
// =============================================================
//
// Hasta el 2026-09-16 este archivo exportaba SIETE familias de tokens con
// cuatro verdes, tres fondos y dos tipografías, y la app usaba todas: un solo
// recorrido —Inicio → Partidos → Clubes → Chat— cruzaba las cuatro. Cada una
// nació de un handoff distinto y ninguna estaba mal por su cuenta; el problema
// era verlas juntas.
//
// Ahora hay una sola paleta de verdad, `reservas`, y lo que queda de las
// otras se DERIVA de ella: son vistas de la misma paleta con el vocabulario
// que cada módulo aprendió, sin valores propios. Cada una se BORRA cuando su
// módulo migra a los nombres nuevos, y cuando no quede ninguna, una regla de
// lint impedirá volver a importarlas.
//
// YA NO EXISTEN, todas borradas el 2026-09-16: `colors`, `radius`, `spacing` y
// `fonts` (la paleta legada del fondo café #201F1D y el verde oliva #71B533,
// con la tipografía del sistema), y `clubColors`/`clubRadius`/`clubSizes`.
// Quedan `chatColors`, `tactical` y `partidos`.
//
// Ver `docs/superpowers/specs/2026-09-16-estetica-unica-design.md`.
//
// LO QUE SE UNIFICA Y LO QUE NO. Se unifican los neutros (fondos, superficies,
// bordes, escalones de texto) y el verde de acción. NO se unifican los colores
// que llevan SIGNIFICADO: victoria/empate/derrota, el dorado Premium, el ámbar
// de advertencia y el rojo neón del desafío recién aceptado siguen siendo lo
// que eran. Un club rojo no puede hacer que una victoria parezca una derrota.
//
// Lo que sí se arregló del lado semántico es que el rojo existía CINCO veces
// con cinco valores (`error`, `loss`, `coral`, `danger`, `red`). Ahora es uno.
//
// La prueba `src/theme/__tests__/unaSolaEstetica.test.js` es la que sostiene
// todo esto: comprueba contra el código real que ninguna clave quedó sin valor
// —en React Native un token inexistente pinta transparente y no avisa— y que
// las familias comparten verde, fondo y rojo.

/**
 * LA PALETA. Todo lo demás en este archivo sale de acá.
 *
 * Nació del handoff «Reservas» (`Reservas.dc.html`) y comparte diseñador y
 * valores con «Explorar clubes»; por eso conserva ese nombre. Es un mal nombre
 * para la paleta de toda la app y hay que renombrarla, pero eso toca los 43
 * archivos que ya la importan y no se mezcla con esta migración.
 *
 * Tipografía: Manrope, cargada en App.js. Ver `reservasFonts`.
 */
export const reservas = {
  // ── Fondos y superficies ──────────────────────────────────
  bg: '#0A0C0A',
  bgDeep: '#070907',
  surface: '#131613',
  surfaceAlt: '#191D1A',
  surfaceHover: '#1E231F',

  // Superficies de chip y de tarjeta con estado. Las de chat existían como
  // cinco grises de cinco puntos de diferencia; se conservan las que de
  // verdad se distinguen y se colapsan las que no.
  chip: '#191D1A',
  chipStrong: '#232823',
  chipAlt: '#101310',
  cardUnread: '#171B17',
  composerBar: '#0E110E',
  sendIdle: '#1B1F1B',

  // ── Verde de acción ───────────────────────────────────────
  green: '#55DF69',
  greenHover: '#6FE881',
  greenActive: '#46C959',
  greenDark: '#46C959',
  // Tinta sobre verde. `greenInk` es el del handoff de Explorar clubes y
  // `textOnGreen` el de Reservas, que lo pide más oscuro. Se conservan los dos
  // porque los dos están en uso y la diferencia se nota sobre el verde claro.
  greenInk: '#0A0C0A',
  textOnGreen: '#06130A',
  greenSoft: 'rgba(85, 223, 105, 0.12)',
  greenSoftStrong: 'rgba(85, 223, 105, 0.18)',
  greenBorder: 'rgba(85, 223, 105, 0.40)',
  greenBorderStrong: 'rgba(85, 223, 105, 0.55)',
  greenGlow: 'rgba(85, 223, 105, 0.24)',
  // Verde profundo de insignias y escudos, con su borde propio.
  shieldBg: '#17351E',
  greenDeepBorder: '#2C5C39',

  // ── Escalones de texto, de más a menos contraste ──────────
  // Son ocho porque el módulo Partidos usaba ocho. El resto de la app usa
  // tres o cuatro; tenerlos todos acá evita que el próximo módulo invente el
  // suyo.
  textPrimary: '#F4F6F4',
  textStrong: '#DDE1DD',
  textSoft: '#C2C9C2',
  textDim: '#A9AFAA',
  textSecondary: '#969B97',
  textFaint: '#7E847F',
  textGhost: '#6E746F',
  textMuted: '#626762',
  textPlaceholder: '#565E57',
  // Párrafos con barra verde a la izquierda (citas, avisos obligatorios).
  textQuote: '#B4BAB5',

  // ── Líneas, divisores y superficies de control ────────────
  border: '#292E2A',
  borderSoft: '#202421',
  borderStrong: '#343A35',
  hairline: 'rgba(255, 255, 255, 0.06)',
  divider: '#1E221F',
  dividerInner: '#1E221F',
  dashedBorder: '#2E3430',
  dashedBorderStrong: '#3A4139',
  dashed: '#2E3430',
  track: '#232823',
  grip: '#31382F',
  scrim: 'rgba(5, 7, 5, 0.75)',
  // Tarjeta elegida: fondo verdoso oscuro + borde verde.
  selectedBg: '#111A13',

  // ── Semánticos: significado, no estética ──────────────────
  // Rojo, uno solo. Antes eran cinco: `colors.error` #E5484D,
  // `clubColors.loss` #E8737B, `partidos.coral` #E8737B,
  // `chatColors.danger` #FF7A6B y `reservas.red` #ED6B76.
  red: '#ED6B76',
  redSoft: 'rgba(237, 107, 118, 0.14)',
  redBorder: 'rgba(237, 107, 118, 0.40)',
  textOnRed: '#150607',

  // Ámbar de advertencia.
  amber: '#E8B34B',
  amberSoft: 'rgba(232, 179, 75, 0.14)',
  amberBorder: '#4A3A14',
  textAmber: '#F0DBA8',

  // Dorado Premium. Distinto del ámbar a propósito: uno dice «cuidado» y el
  // otro dice «este club paga». Unificarlos es una decisión de diseño aparte.
  gold: '#F0C85A',
  goldSoft: 'rgba(240, 200, 90, 0.10)',
  goldBorder: 'rgba(240, 200, 90, 0.30)',

  // Resultado de un partido. El empate toma el ámbar y la derrota el rojo;
  // la victoria es el verde de acción. Sus pruebas exigen distancia de color
  // entre los tres y 4,5:1 de contraste.
  win: '#55DF69',
  winSoft: 'rgba(85, 223, 105, 0.14)',
  draw: '#E8B34B',
  drawSoft: 'rgba(232, 179, 75, 0.14)',
  loss: '#ED6B76',
  lossSoft: 'rgba(237, 107, 118, 0.14)',

  // Desafío entre clubes recién aceptado (migración 42). El rojo neón NO es
  // el rojo de error: eso es «algo salió mal» y esto es «hay un partido nuevo
  // que coordinar». Se apaga por administrador en cuanto lo abre.
  neon: '#FF2D55',
  neonSoft: 'rgba(255, 45, 85, 0.12)',
  neonBorder: 'rgba(255, 45, 85, 0.55)',
  cardChallenge: '#171214',
  challengeBorder: 'rgba(255, 45, 85, 0.22)',

  // ── Degradados ────────────────────────────────────────────
  headerGlowFrom: '#17351E',
  headerGlowTo: '#0A0C0A',
  headerGradient: ['#17351E', '#102616', '#0A0C0A'],
  hero: ['#14301B', '#0E1A12', '#0A0C0A'],
  heroNeutral: ['#191C19', '#111411', '#0A0C0A'],
  avatar: ['#1F3D27', '#131613'],
  metal: ['#1B201C', '#0E110E', '#171C18'],
  bannerFrom: '#17351E',
  bannerMid: '#0F1F12',
  bannerTo: '#0E110E',
  clubShield: ['#55DF69', '#2C9C3B'],
  challengeShield: ['#FF2D55', '#7A1028'],
};

/**
 * Radios del handoff, nombrados por su uso (hero, card, fila, CTA, chip…).
 *
 * Los radios NO se unificaron junto con el color: cambiarlos mueve la
 * geometría de cada esquina de la app y eso se revisa módulo por módulo, no de
 * un golpe. Las escalas viejas siguen más abajo.
 */
export const reservasRadius = {
  hero: 24,
  card: 22,
  cardSm: 20,
  row: 18,
  ctaPrimary: 17,
  ctaSecondary: 16,
  iconBtn: 14,
  chip: 13,
  pill: 999,
};

export const reservasSizes = {
  screenPadding: 20,
  cardGap: 11,
  rowGap: 9,
  ctaPrimary: 54, // 52–56
  ctaSecondary: 49, // 48–50
  iconBtn: 40,
  // Mínimo táctil. Los botones de icono miden 40 y llegan a 44 con `hitSlop`;
  // este es para los que no lo llevan.
  tapBtn: 44,
  logo: 72, // escudo de club y avatar grande de perfil
  chip: 33, // 32–34
  badge: 22, // 20–24
};

/**
 * Familia tipográfica: Manrope (Google Fonts), cargada en App.js con
 * `expo-font` bajo estos mismos nombres.
 *
 * En React Native el peso se fija con `fontFamily`, no con `fontWeight`: por
 * eso hay un nombre por peso y no una escala numérica. Los módulos que todavía
 * usan `fontWeight` están a medio migrar, no son una excepción de diseño.
 */
export const reservasFonts = {
  medium: 'Manrope_500Medium',
  semiBold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extraBold: 'Manrope_800ExtraBold',
};

// =============================================================
// Familias derivadas. Ninguna tiene valores propios.
// =============================================================
//
// Cada una es la misma paleta con el vocabulario que su módulo aprendió. Se
// borran cuando su módulo migre a los nombres de `reservas`.

/** Explorar clubes. Siempre fue la misma paleta; ahora lo dice el código. */
export const clubsExplorer = {
  bg: reservas.bg,
  headerGlowFrom: reservas.headerGlowFrom,
  headerGlowTo: reservas.headerGlowTo,
  surface: reservas.surface,
  surfaceAlt: reservas.surfaceAlt,
  border: reservas.border,
  green: reservas.green,
  greenHover: reservas.greenHover,
  greenActive: reservas.greenActive,
  greenInk: reservas.greenInk,
  shieldBg: reservas.shieldBg,
  textPrimary: reservas.textPrimary,
  textSecondary: reservas.textSecondary,
  textMuted: reservas.textMuted,
};

/**
 * Ya no la importa ninguna pantalla: Perfil migró el 2026-09-16 y Clubes
 * también. Sobrevive sin `export` como base de `chatColors`, que la extiende;
 * desaparece del todo cuando Chat migre.
 */
const dsColors = {
  background: reservas.bg,
  surface: reservas.surface,
  surfaceAlt: reservas.surfaceAlt,
  surfaceHover: reservas.surfaceHover,

  green: reservas.green,
  greenDark: reservas.greenDark,
  greenInk: reservas.greenInk,
  greenSoft: reservas.greenSoft,
  greenSoftStrong: reservas.greenSoftStrong,
  greenBorder: reservas.greenBorder,
  greenGlow: reservas.greenGlow,

  bannerFrom: reservas.bannerFrom,
  bannerMid: reservas.bannerMid,
  bannerTo: reservas.bannerTo,

  textPrimary: reservas.textPrimary,
  textSecondary: reservas.textSecondary,
  textMuted: reservas.textMuted,
  textFaint: reservas.textFaint,

  win: reservas.win,
  winSoft: reservas.winSoft,
  draw: reservas.draw,
  drawSoft: reservas.drawSoft,
  loss: reservas.loss,
  lossSoft: reservas.lossSoft,

  gold: reservas.gold,
  goldSoft: reservas.goldSoft,

  chip: reservas.chip,
  chipStrong: reservas.chipStrong,
  border: reservas.border,
  borderSoft: reservas.borderSoft,
  divider: reservas.divider,
};

/**
 * Chats y amigos, más las barras del hilo de desafío.
 *
 * Tenía cinco superficies de tarjeta separadas por cinco puntos de gris. Las
 * que de verdad se distinguen —normal, no leída, desafío— se conservan; las
 * que no, se colapsaron en la superficie base.
 */
export const chatColors = {
  ...dsColors,

  card: reservas.surface,
  cardUnread: reservas.cardUnread,
  cardClub: reservas.surface,
  composerBar: reservas.composerBar,
  inputBg: reservas.surface,
  sendIdle: reservas.sendIdle,

  cardBorder: reservas.hairline,
  cardBorderUnread: reservas.greenSoft,
  cardBorderClub: reservas.greenBorder,

  warn: reservas.amber,
  warnSoft: reservas.amberSoft,
  warnBorder: reservas.amberBorder,

  danger: reservas.red,
  dangerSoft: reservas.redSoft,
  dangerBorder: reservas.redBorder,

  neon: reservas.neon,
  neonSoft: reservas.neonSoft,
  neonBorder: reservas.neonBorder,
  cardChallenge: reservas.cardChallenge,
  challengeBorder: reservas.challengeBorder,
  challengeShield: reservas.challengeShield,

  clubShield: reservas.clubShield,
  avatarGreenBg: reservas.shieldBg,
  avatarGreenBorder: reservas.greenDeepBorder,
  avatarNeutralBg: reservas.surfaceAlt,
  avatarNeutralBorder: reservas.border,

  bubbleTheirs: reservas.surface,
  bubbleTheirsBorder: reservas.hairline,
  inkOnGreen: reservas.greenInk,
};

/**
 * Inicio, Splash, Avisos y el wordmark.
 *
 * Era la excepción declarada: negro puro con verde flúor #00FF66, «más cancha
 * nocturna que el resto de la app». Entra igual en la unificación por decisión
 * de Vicente el 2026-09-16, logo incluido — una excepción que hay que explicar
 * cada vez no es una decisión de diseño, es una deuda con buena prensa.
 *
 * Sus tres degradados sí necesitaron valores nuevos: `reservas` no tenía
 * ninguno, y el metal y el degradado de cabecera no se pueden deducir de un
 * color plano.
 */
export const tactical = {
  bg: reservas.bg,
  surface: reservas.surface,
  surfaceAlt: reservas.surfaceAlt,
  metal: reservas.metal,
  headerGradient: reservas.headerGradient,

  neon: reservas.green,
  neonInk: reservas.greenInk,
  neonSoft: reservas.greenSoft,
  neonBorder: reservas.greenBorder,

  danger: reservas.red,

  border: reservas.border,
  borderStrong: reservas.borderStrong,

  text: reservas.textPrimary,
  textDim: reservas.textSecondary,
  textFaint: reservas.textFaint,
};

/** El módulo Partidos. Es el que traía la escala de texto más completa. */
export const partidos = {
  bg: reservas.bg,
  bgDeep: reservas.bgDeep,
  surface: reservas.surface,
  surfaceAlt: reservas.surfaceAlt,
  chip: reservas.chip,
  chipAlt: reservas.chipAlt,

  green: reservas.green,
  greenDark: reservas.greenDark,
  greenInk: reservas.greenInk,
  greenSoft: reservas.greenSoft,
  greenSoftStrong: reservas.greenSoftStrong,
  greenBorder: reservas.greenBorder,
  greenBorderStrong: reservas.greenBorderStrong,
  greenGlow: reservas.greenGlow,

  gold: reservas.gold,
  goldSoft: reservas.goldSoft,
  goldBorder: reservas.goldBorder,

  coral: reservas.red,
  coralSoft: reservas.redSoft,
  coralBorder: reservas.redBorder,

  text: reservas.textPrimary,
  textStrong: reservas.textStrong,
  textSoft: reservas.textSoft,
  textDim: reservas.textDim,
  textMuted: reservas.textSecondary,
  textFaint: reservas.textFaint,
  textGhost: reservas.textGhost,
  textPlaceholder: reservas.textPlaceholder,

  hairline: reservas.hairline,
  border: reservas.border,
  borderStrong: reservas.borderStrong,
  divider: reservas.divider,
  track: reservas.track,
  grip: reservas.grip,
  dashed: reservas.dashed,
  scrim: reservas.scrim,

  hero: reservas.hero,
  heroNeutral: reservas.heroNeutral,
  avatar: reservas.avatar,
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

export const partidosRadius = {
  pill: 999,
  chipSm: 7,
  chip: 9,
  control: 11,
  input: 14,
  card: 20,
  list: 24,
  sheet: 26,
};

export const clubsExplorerRadius = {
  input: 16,
  card: 22,
  icon: 16,
  panel: 18,
  empty: 24,
  pill: 14,
  fab: 18,
};

/**
 * Tonos semánticos del módulo Clubes que NO se tematizan.
 *
 * El tema del club pinta su identidad —escudo, banner, botones—, pero no
 * puede pintar el significado: un club rojo no puede hacer que una victoria
 * parezca una derrota ni que un aviso parezca una sanción. Estos tres roles
 * conservan su color en los cuatro temas.
 *
 * El tono `accent` no vive acá: sale de `temaDeClub()`, porque sí depende del
 * club.
 *
 * NO ENTRAN EN LA UNIFICACIÓN DE LA FASE 1, y `clubSuperficies` tampoco. Sus
 * valores están medidos: `clubThemes.test.js` exige distancia de color entre
 * el peligro y el tema rojo del club, y la portada de Clubes eligió sus dos
 * elevaciones a ojo contra ese fondo. Cambiarlos es volver a medir, no
 * reemplazar un token — va con el módulo de Clubes en la fase 2.
 */
export const clubTonos = Object.freeze({
  warn: Object.freeze({ soft: 'rgba(255, 197, 49, 0.14)', fg: '#FFC531' }),
  danger: Object.freeze({ soft: 'rgba(255, 75, 43, 0.15)', fg: '#FF6E4F' }),
  info: Object.freeze({ soft: 'rgba(255, 255, 255, 0.07)', fg: '#D6D6DA' }),
});

/**
 * Superficies de la portada de Clubes: niveles de elevación y estructura.
 *
 * Como `clubTonos`, no se tematizan. El tema del club no puede pintar las
 * superficies de fondo porque su paleta oscila solo sobre el color principal
 * (un rojo oscuro es distinto de un azul oscuro, aunque ambos sean "fondo").
 *
 * `card` y `cardAlta` son dos elevaciones: card es la superficie base de una
 * tarjeta, cardAlta es más clara para resaltar contenido crítico. `barra` es
 * semitransparente para flotar sobre el fondo, `header` es el fondo más oscuro,
 * `separador` divide secciones y `borde` marca límites.
 */
export const clubSuperficies = Object.freeze({
  card: '#101012',
  cardAlta: '#0D0E0D',
  barra: 'rgba(9, 9, 10, 0.94)',
  header: 'rgba(0, 0, 0, 0.9)',
  separador: 'rgba(255, 255, 255, 0.05)',
  borde: 'rgba(255, 255, 255, 0.08)',
});
