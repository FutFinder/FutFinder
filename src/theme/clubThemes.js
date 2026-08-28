/**
 * Tema de color del club.
 *
 * UN SOLO LUGAR DECIDE EL COLOR. Los componentes reciben una escala ya
 * resuelta (`temaDeClub(club)`) y pintan con sus tonos; ninguno pregunta
 * `tema === 'red'` ni arma su propio `rgba(...)`. Agregar un quinto tema
 * es agregar una entrada acá y nada más.
 *
 * QUÉ SE GUARDA EN LA BASE DE DATOS: una clave estable —'green', 'blue',
 * 'red' o 'yellow'— en `clubs.tema` (migración 53). Nunca un HEX: un color
 * libre no se puede validar en el servidor, no garantiza contraste y deja
 * la app sin forma de retocar la paleta después.
 *
 * QUÉ NO PINTA ESTE TEMA. Solo los acentos que SON la identidad del club:
 * banner, escudo, «Crear desafío», iconos y tarjetas de acción, estados
 * seleccionados, enlaces «Ver todos», «Añadir foto» y los botones atados al
 * club. El fondo oscuro, los textos, la navegación, el botón flotante
 * global, el dorado de Premium y los colores de victoria / empate / derrota
 * / error siguen siendo los de `dsColors` para todos los clubes: un club
 * rojo no puede hacer que una victoria parezca una derrota.
 *
 * CADA TEMA ES UNA ESCALA, no un color: principal, presionado, fondo suave
 * (normal y presionado), borde, resplandor y la tinta de contraste que va
 * ENCIMA del principal. Las tintas están elegidas para cumplir 4,5:1 de la
 * WCAG sobre su color principal, y cada principal cumple 4,5:1 sobre el
 * fondo `dsColors.background`. Lo comprueba `__tests__/clubThemes.test.js`,
 * que además exige distancia de color contra derrota, empate y Premium.
 */

import { dsColors } from './colors.js';

/** Clave que se guarda para un club que nunca eligió tema. */
export const TEMA_CLUB_POR_DEFECTO = 'green';

/**
 * Definición cruda de cada tema. Solo cuatro valores por tema; el resto de
 * la escala se calcula en `construirEscala()` para que las opacidades sean
 * las mismas en los cuatro y no haya un `rgba` suelto por ahí.
 *
 * `bannerRgb` es la base OSCURA de las bandas diagonales del banner, no una
 * versión del principal: el banner es fondo, y un fondo con el brillo del
 * acento se comería el contenido que va encima.
 */
const DEFINICIONES = [
  {
    value: 'green',
    label: 'Verde',
    // El verde corporativo de la app, tal cual: un club sin tema no cambia
    // de aspecto por esta funcionalidad.
    main: dsColors.green,
    pressed: dsColors.greenDark,
    ink: dsColors.greenInk,
    bannerRgb: '23, 58, 28',
  },
  {
    value: 'blue',
    label: 'Azul',
    main: '#4DA3FF',
    pressed: '#2E86E6',
    ink: '#05192E',
    bannerRgb: '18, 42, 74',
  },
  {
    value: 'red',
    label: 'Rojo',
    // Bermellón, no el coral de la derrota (#E8737B) ni el rojo de error:
    // se eligió por distancia de color, no por gusto. Ver la prueba
    // «ningún tema se confunde con derrota, empate ni con el dorado».
    main: '#FF4B2E',
    pressed: '#E03A20',
    ink: '#2A0800',
    bannerRgb: '66, 24, 14',
  },
  {
    value: 'yellow',
    label: 'Amarillo',
    // Ámbar saturado. El empate (#E0C25A) y el dorado de Premium (#F0C85A)
    // son amarillos apagados; este es deliberadamente más vivo para que no
    // se confundan a simple vista.
    main: '#FFBE1A',
    pressed: '#E0A400',
    ink: '#2A1B00',
    bannerRgb: '66, 50, 10',
  },
];

/** Opacidades compartidas por los cuatro temas. */
const ALFA = {
  soft: 0.14,
  softStrong: 0.2,
  border: 0.42,
  glow: 0.3,
  bannerGlow: 0.07,
};

function rgbDe(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function conAlfa(hex, alfa) {
  const [r, g, b] = rgbDe(hex);
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

function construirEscala(def) {
  return Object.freeze({
    clave: def.value,
    nombre: def.label,

    /** Color principal: botón sólido, texto de enlace, icono de acento. */
    main: def.main,
    /** Principal oscurecido: superficie sólida presionada. */
    pressed: def.pressed,
    /** Fondo suave: tarjetas y botones secundarios del club. */
    soft: conAlfa(def.main, ALFA.soft),
    /** Fondo suave presionado. */
    softStrong: conAlfa(def.main, ALFA.softStrong),
    /** Borde de superficies con fondo suave. */
    border: conAlfa(def.main, ALFA.border),
    /** Resplandor discreto (sombra del botón principal). */
    glow: conAlfa(def.main, ALFA.glow),
    /** Tinta sobre el principal: texto e iconos con 4,5:1 garantizado. */
    ink: def.ink,

    /** Base oscura de las bandas del banner, en rgb crudo. */
    bannerRgb: def.bannerRgb,
    /** Halo de la esquina del banner. */
    bannerGlow: conAlfa(def.main, ALFA.bannerGlow),
  });
}

const ESCALAS = Object.freeze(
  Object.fromEntries(DEFINICIONES.map((def) => [def.value, construirEscala(def)]))
);

/** Opciones del selector: clave, nombre y color para pintar el círculo. */
export const TEMAS_CLUB = Object.freeze(
  DEFINICIONES.map((def) =>
    Object.freeze({ value: def.value, label: def.label, main: def.main })
  )
);

/** `true` solo para las cuatro claves conocidas. Un HEX nunca lo es. */
export function esTemaClubValido(valor) {
  return typeof valor === 'string' && Object.hasOwn(ESCALAS, valor);
}

/** Clave válida, o el verde por defecto si llega cualquier otra cosa. */
export function normalizarTemaClub(valor) {
  return esTemaClubValido(valor) ? valor : TEMA_CLUB_POR_DEFECTO;
}

/**
 * Escala de tonos de una clave de tema.
 * Una clave desconocida —o ninguna— devuelve la escala verde: un club sin
 * tema tiene que verse igual que siempre, no quedarse sin color.
 */
export function temaClub(clave) {
  return ESCALAS[normalizarTemaClub(clave)];
}

/** Escala de tonos de una fila de `clubs`. */
export function temaDeClub(club) {
  return temaClub(club?.tema);
}
