/**
 * Espera una promesa, pero no para siempre.
 *
 * POR QUÉ EXISTE. El splash no navega hasta que terminan dos cosas: saber si
 * hay sesión y la animación del logo. La animación se mueve con
 * `requestAnimationFrame`, y el navegador SUSPENDE los frames cuando la página
 * no se está dibujando — una pestaña en segundo plano, por ejemplo. Sin frames
 * la animación no termina nunca, y mientras tanto lo único que se ve es el
 * logo quieto. En la práctica se arregla solo (al mirar la pestaña vuelven los
 * frames), pero deja a una animación decorativa como el único motivo por el
 * que alguien no puede entrar. Con techo, deja de serlo.
 *
 * DEVUELVE SI ALCANZÓ A TERMINAR, no el valor de la promesa: quien llama solo
 * necesita saber si siguió adelante por su cuenta. Y un rechazo cuenta como
 * terminar — el que espera una animación no quiere manejar su error, quiere
 * seguir.
 *
 * NO SE USA PARA LA SESIÓN. Ahí soltar antes de tiempo mandaría a la portada a
 * alguien que sí tiene cuenta, que es peor que esperar.
 */

/** Techo por omisión. La animación del splash dura ~1,24 s; esto le sobra. */
export const TECHO_MS = 3000;

/**
 * @param {Promise} promesa  lo que se espera
 * @param {number} [ms]      cuánto como máximo; por omisión `TECHO_MS`
 * @returns {Promise<boolean>} `true` si terminó a tiempo, `false` si se agotó
 */
export function conTecho(promesa, ms) {
  // Un `ms` inválido (0, negativo, undefined por un parámetro mal pasado) cae
  // en el techo por omisión en vez de convertirse en «no esperes nada», que
  // rompería la espera justo donde se la quiso reforzar.
  const techo = Number.isFinite(ms) && ms > 0 ? ms : TECHO_MS;

  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), techo);
    const listo = () => { clearTimeout(t); resolve(true); };
    Promise.resolve(promesa).then(listo, listo);
  });
}
