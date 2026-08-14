/**
 * Sondeo de respaldo: volver a pedir algo cada cierto tiempo.
 *
 * POR QUÉ EXISTE. No todo lo que cambia en la base llega por Realtime. La
 * publicación `supabase_realtime` sólo lleva `messages`, `attendees` y
 * `notifications`; `club_challenge_events` y `club_match_changes` no emiten
 * nada, así que ninguna suscripción puede enterarse de que el club contrario
 * respondió. El hilo de negociación las cargaba una vez al montar y las
 * volvía a pedir sólo tras una acción PROPIA: quien esperaba respuesta se
 * quedaba mirando una solicitud pendiente que ya no lo estaba, hasta
 * recargar. Se comprobó a mano el 2026-08-13.
 *
 * Es el mismo remedio que la nómina de U3, con una diferencia: allá el
 * sondeo cubre los DELETE que Postgres Changes no sabe filtrar, y acá es la
 * ÚNICA vía. Publicar esas dos tablas en Realtime sería lo ideal, pero es
 * una migración y una superficie de lectura nueva; el sondeo resuelve el
 * fallo sin tocar la base.
 *
 * Puro a propósito, con los temporizadores inyectables: así se puede mover
 * el reloj en una prueba en vez de esperar quince segundos de verdad.
 */

/** El mismo intervalo que usa la nómina de U3. */
export const SONDEO_MS = 15000;

/**
 * Programa `onTick` cada `intervaloMs` mientras `activo` sea cierto.
 *
 * Devuelve SIEMPRE una función de limpieza, aunque no haya programado nada:
 * quien la use en un `useEffect` no debería tener que preguntarse si le
 * tocó un null.
 *
 * DOS GUARDAS QUE IMPORTAN:
 *
 *   · No se solapan dos consultas. Si `onTick` devuelve una promesa que
 *     todavía no se resolvió, el siguiente tick se salta. Con la red lenta,
 *     sin esto se apilan peticiones y la pantalla termina pintando la
 *     respuesta vieja encima de la nueva — peor que no refrescar.
 *   · Un fallo no traba el sondeo. Se libera igual en el `catch`, porque un
 *     error de red no puede dejar la pantalla congelada hasta que alguien
 *     la recargue, que es justo lo que veníamos a arreglar.
 */
export function crearSondeo({
  activo = true,
  intervaloMs = SONDEO_MS,
  onTick,
  timers = { setInterval, clearInterval },
} = {}) {
  if (!activo || typeof onTick !== 'function') return () => {};

  let corriendo = false;

  const id = timers.setInterval(() => {
    if (corriendo) return;
    corriendo = true;
    try {
      const resultado = onTick();
      if (resultado && typeof resultado.then === 'function') {
        resultado.then(
          () => { corriendo = false; },
          () => { corriendo = false; }
        );
      } else {
        corriendo = false;
      }
    } catch {
      corriendo = false;
    }
  }, intervaloMs);

  let detenido = false;
  return () => {
    if (detenido) return;
    detenido = true;
    timers.clearInterval(id);
  };
}
