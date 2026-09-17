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
// Ahora hay una sola paleta de verdad, `paleta`, y lo que queda de las
// otras se DERIVA de ella: son vistas de la misma paleta con el vocabulario
// que cada módulo aprendió, sin valores propios. Cada una se BORRA cuando su
// módulo migra a los nombres nuevos, y cuando no quede ninguna, una regla de
// lint impedirá volver a importarlas.
//
// YA NO EXISTEN, todas borradas el 2026-09-16: `colors`, `radius`, `spacing` y
// `fonts` (la paleta legada del fondo café #201F1D y el verde oliva #71B533,
// con la tipografía del sistema), `clubColors`/`clubRadius`/`clubSizes`, y
// `dsColors`/`dsRadius`/`dsSizes` con `chatColors`, `partidos` con
// `partidosRadius`, `tactical`, y `clubsExplorer`/`clubsExplorerRadius`.
// NO QUEDA NINGUNA: este archivo exporta UNA paleta.
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
 * El mismo color de la paleta, con otra opacidad.
 *
 * POR QUÉ HACE FALTA. Un borde al 35% y un fondo al 12% del verde de acción
 * son el MISMO color, pero escritos a mano quedan como `rgba(85,223,105,0.35)`
 * y `rgba(85,223,105,0.12)`: dos literales que no saben que vienen de `green`.
 * Llegaron a ser ~180 repartidos por la app, con cuarenta opacidades distintas
 * y escritos de cuatro formas (`0.4`, `0.40`, `.16`). El día que el verde
 * cambie, ninguno lo sigue.
 *
 * Tokens fijos no sirven acá: no son cuatro alfas repetidos, son cuarenta
 * elegidos uno por uno para su sitio. Lo que tiene que ser único es el COLOR;
 * la opacidad es una decisión local y se queda donde está.
 *
 *     backgroundColor: alfa(C.green, 0.12)
 *
 * Acepta `#RGB` y `#RRGGBB`. Si le llega algo que no sabe leer devuelve el
 * valor tal cual en vez de lanzar: un color raro se ve raro, pero una pantalla
 * que revienta al montarse no se ve.
 */
export function alfa(color, opacidad) {
  if (typeof color !== 'string') return color;
  const hex = color.trim().replace('#', '');
  const corto = hex.length === 3;
  if (hex.length !== 6 && !corto) return color;
  const lee = (c) => parseInt(corto ? c + c : c, 16);
  const r = lee(corto ? hex[0] : hex.slice(0, 2));
  const g = lee(corto ? hex[1] : hex.slice(2, 4));
  const b = lee(corto ? hex[2] : hex.slice(4, 6));
  if ([r, g, b].some(Number.isNaN)) return color;
  return `rgba(${r}, ${g}, ${b}, ${opacidad})`;
}

/**
 * LA PALETA. Todo lo demás en este archivo sale de acá.
 *
 * Nació del handoff «Reservas» (`Reservas.dc.html`) y comparte diseñador y
 * valores con «Explorar clubes»; por eso conserva ese nombre. Es un mal nombre
 * para la paleta de toda la app y hay que renombrarla, pero eso toca los 43
 * archivos que ya la importan y no se mezcla con esta migración.
 *
 * Tipografía: Manrope, cargada en App.js. Ver `fuentes`.
 */
export const paleta = {
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
  // Tinta neutra para SUPERFICIES y BORDES translúcidos: `alfa(C.tinta, 0.06)`.
  // No es un color de texto —para eso está la rampa de arriba—; es el blanco
  // con el que se aclara una superficie oscura sin taparla, que es distinto de
  // pintarla de un gris sólido: sobre una foto o un degradado, lo de abajo
  // tiene que seguir viéndose.
  tinta: '#FFFFFF',

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
  // `chatColors.danger` #FF7A6B y `paleta.red` #ED6B76.
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
export const radios = {
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

export const medidas = {
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
export const fuentes = {
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
// borran cuando su módulo migre a los nombres de `paleta`.

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
