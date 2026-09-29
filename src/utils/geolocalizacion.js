/**
 * El reloj propio de la ubicación.
 *
 * EL FALLO QUE VINO A CERRAR (G01, 2026-09-29). `getWebLocation()` sólo se
 * resolvía dentro de los dos callbacks de `navigator.geolocation
 * .getCurrentPosition`, y confiaba en la opción `timeout` de esa API para el
 * caso malo. En el Chrome de la Mac de pruebas, con el permiso en `denied`,
 * **no se llamó a ninguno de los dos callbacks y ese `timeout` tampoco se
 * disparó**: medido, 12 s sin una sola respuesta. La promesa quedaba viva
 * para siempre, y como `getCurrentLocation()` viajaba dentro del
 * `Promise.all` de las pantallas, `setLoading(false)` no llegaba nunca. El
 * detalle del partido se quedaba en su esqueleto y Partidos en «Buscando…».
 *
 * La lección, que vale más allá de la geolocalización: **el plazo de una API
 * ajena no es nuestro plazo**. Si algo de fuera puede no contestar, el reloj
 * lo pone la app.
 *
 * Vive en `utils/` y sin importar React, Expo ni el navegador, para poder
 * probarlo con `node --test` inyectando el reloj.
 */

/** Cuánto se espera una ubicación antes de seguir sin ella. */
export const PLAZO_UBICACION_MS = 8000;

/** Lo que se devuelve cuando el plazo vence: un «no sé», nunca un punto. */
export const UBICACION_VENCIDA = Object.freeze({
  ok: false,
  reason: 'No pudimos obtener tu ubicación a tiempo.',
});

/**
 * La misma promesa, pero con la garantía de que termina.
 *
 * Resuelve con lo que traiga `promesa`; si tarda más que `plazoMs`, resuelve
 * con `alVencer`. Nunca rechaza: un fallo de la promesa se traduce a un
 * `{ ok: false }`, porque quien llama sólo quiere saber si hay ubicación o no.
 *
 * `programar` y `cancelar` se inyectan para probar sin esperar de verdad.
 *
 * Ojo con lo que NO hace: no cancela el trabajo de abajo —no hay forma de
 * cancelar un `getCurrentPosition`—, sólo deja de esperarlo. Si contesta
 * tarde, su respuesta se descarta en vez de pisar la que ya se entregó.
 */
export function conPlazo(
  promesa,
  {
    plazoMs = PLAZO_UBICACION_MS,
    alVencer = UBICACION_VENCIDA,
    programar = setTimeout,
    cancelar = clearTimeout,
  } = {}
) {
  return new Promise((resolve) => {
    let entregado = false;
    const entregar = (valor) => {
      if (entregado) return;
      entregado = true;
      cancelar(reloj);
      resolve(valor);
    };
    const reloj = programar(() => entregar(alVencer), plazoMs);
    Promise.resolve(promesa).then(entregar, (e) =>
      entregar({ ok: false, reason: e?.message || 'Error obteniendo ubicación' })
    );
  });
}

/**
 * `getCurrentPosition` como promesa, sin reloj: el de arriba lo pone
 * `conPlazo`. Se le pasa el `geolocation` en vez de leer `navigator` para
 * poder darle uno de mentira en las pruebas.
 */
export function posicionDelNavegador(geolocation, opciones = {}) {
  return new Promise((resolve) => {
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
      resolve({ ok: false, reason: 'Geolocalización no disponible en este navegador' });
      return;
    }
    let entregado = false;
    const entregar = (valor) => {
      if (entregado) return;
      entregado = true;
      resolve(valor);
    };
    try {
      geolocation.getCurrentPosition(
        (pos) =>
          entregar({
            ok: true,
            latitude: pos?.coords?.latitude,
            longitude: pos?.coords?.longitude,
            accuracy: pos?.coords?.accuracy,
          }),
        (err) => entregar({ ok: false, reason: err?.message || 'No pude obtener tu ubicación' }),
        opciones
      );
    } catch (e) {
      // Algunos navegadores lanzan en vez de llamar al callback de error.
      entregar({ ok: false, reason: e?.message || 'Error obteniendo ubicación' });
    }
  });
}
