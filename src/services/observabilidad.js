import * as Sentry from '@sentry/react-native';

import {
  debeActivarse,
  limpiarEvento,
  limpiarUrl,
} from '../utils/observabilidad';

/**
 * El arranque de Sentry.
 *
 * La aduana —qué se enciende y qué datos se dejan salir— vive en
 * `utils/observabilidad.js`, que es puro y se prueba sin SDK ni red. Acá sólo
 * está lo que toca al SDK de verdad, que no se puede probar en Node.
 *
 * SIN `EXPO_PUBLIC_SENTRY_DSN` NO SE INICIALIZA NADA. No es un modo
 * degradado: es que no pasa absolutamente nada, igual que el mapa web sin su
 * token. Nadie tiene que configurar esto para que FutFinder funcione, y un
 * repositorio recién clonado no manda errores a ninguna parte.
 *
 * NO HAY OTA EN ESTE PROYECTO (`expo-updates` no está instalado), así que un
 * informe sin mapas de origen llega con el stack minificado y no sirve de
 * nada. Subir los mapas es parte del build, no de este archivo; está anotado
 * en `docs/memoria/arquitectura/despliegue-y-entornos.md`.
 */

let activa = false;

/** ¿Se está informando de verdad? Para no prometer lo que no se cumple. */
export function estaActiva() {
  return activa;
}

export function iniciarObservabilidad() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!debeActivarse({ dsn, dev: __DEV__ })) return false;

  try {
    Sentry.init({
      dsn,
      // Nunca. Ni correo, ni IP, ni cabeceras de la petición. Si alguna vez
      // se enciende, `limpiarEvento` sigue siendo la última barrera, pero la
      // primera es no pedirlo.
      sendDefaultPii: false,
      // Sin trazas de rendimiento: la pregunta de hoy es «¿se rompió algo?»,
      // no «¿cuánto tardó?». Las trazas multiplican el volumen y la cuota.
      tracesSampleRate: 0,
      // La versión que se ve en la tienda, para saber a qué build pertenece
      // cada informe. Sin esto todos los errores se mezclan.
      release: process.env.EXPO_PUBLIC_APP_VERSION || undefined,
      beforeSend: (evento) => limpiarEvento(evento),
      beforeBreadcrumb: (miga) => {
        // Las migas de consola se descartan enteras: en esta app los
        // `console.error` de los servicios imprimen el objeto de error de
        // PostgREST, que puede traer el texto de la consulta.
        if (miga?.category === 'console') return null;
        if (miga?.data && typeof miga.data === 'object' && 'url' in miga.data) {
          miga.data.url = limpiarUrl(miga.data.url);
        }
        return miga;
      },
    });
    activa = true;
    return true;
  } catch (e) {
    // Que la observabilidad falle no puede tumbar la app: sería el colmo.
    console.warn('[FutFinder] no se pudo iniciar Sentry:', e?.message || e);
    activa = false;
    return false;
  }
}

/**
 * Manda un error que ya se atrapó.
 *
 * Lo usa `ErrorBoundary`, que es por donde pasan TODOS los errores de render
 * de la app —uno por pantalla, más el de la raíz—. `contexto` es el nombre de
 * la pantalla y el árbol de componentes: dice dónde reventó, sin decir a
 * quién.
 *
 * Si Sentry no está activo no hace nada y no falla.
 */
export function reportarError(error, contexto = {}) {
  if (!activa) return;
  try {
    Sentry.withScope((scope) => {
      if (contexto.pantalla) scope.setTag('pantalla', contexto.pantalla);
      if (contexto.componentStack) {
        scope.setContext('react', { componentStack: String(contexto.componentStack) });
      }
      Sentry.captureException(error);
    });
  } catch (_) {
    /* Un informe perdido no vale una excepción nueva. */
  }
}
