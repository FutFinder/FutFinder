/**
 * La dirección pública de FutFinder: la web, los enlaces que se comparten
 * (`/p/<id>`) y las páginas legales (`/privacidad`, `/terminos`).
 *
 * Es `www.futfinder.cl` y no la raíz: en Vercel `futfinder.cl` redirige a
 * `www`, y un enlace que pasa por una redirección no abre la app (ver
 * `scripts/enlacesUniversales.js`, que usa el mismo dominio). Entre el
 * 2026-11-13 y la conexión del dominio fue `futfinder.vercel.app`, que se
 * sigue reconociendo como propia para los enlaces que ya se compartieron.
 */
export const URL_PUBLICA = 'https://www.futfinder.cl';

/** Todas las direcciones web que la app reconoce como propias. */
export const DIRECCIONES_PROPIAS = [
  URL_PUBLICA,
  'https://futfinder.cl',
  'https://futfinder.vercel.app',
];
