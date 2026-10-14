/**
 * Qué sale de la app cuando algo se rompe.
 *
 * POR QUÉ EXISTE. Hasta ahora, un fallo en el teléfono de alguien no dejaba
 * rastro en ninguna parte: la única traza era un `console.error` que nadie
 * iba a leer nunca. No es teórico — en octubre de 2026 hubo dos fallos vivos
 * en producción (el editor de club abriéndose vacío y `search_canchas`
 * devolviendo 42501 a todo el mundo) y los dos se encontraron mirando a mano,
 * no porque algo avisara.
 *
 * ESTE ARCHIVO NO ES «LA INTEGRACIÓN DE SENTRY». Es la aduana: decide si se
 * enciende y, sobre todo, **qué se deja salir**. Mandar un error a un
 * servicio de terceros es publicar datos, y las URL de esta app llevan
 * identificadores de persona y texto que la gente escribió:
 *
 *     /rest/v1/profiles?id=eq.<uuid de alguien>
 *     /rest/v1/matches?or=(titulo.ilike.%<lo que buscó>%)
 *     /clubes/<uuid>/editar
 *
 * Una miga de pan con eso dentro es una filtración silenciosa, y silenciosa
 * es la peor clase. Por eso todo pasa por `limpiarEvento` antes de salir.
 *
 * LAS FUNCIONES PURAS VIVEN ACÁ y el SDK se toca en `iniciar()`: así la parte
 * que decide qué se publica se puede probar sin red, sin SDK y sin DSN. Las
 * pruebas están en `__tests__/observabilidad.test.js`.
 *
 * SIN DSN NO PASA NADA. Es el mismo trato que el mapa web: si la variable no
 * está, la app se comporta exactamente como antes. Nadie tiene que configurar
 * nada para que FutFinder funcione.
 */

/** El marcador que trae `.env.example`. No es un DSN: no enciende nada. */
export const DSN_DE_EJEMPLO = 'https://REEMPLAZA_CON_TU_DSN@oXXXX.ingest.sentry.io/XXXX';

/**
 * ¿Se enciende?
 *
 * En desarrollo no, aunque haya DSN: esos errores ya se ven en la consola y
 * en el boundary, que muestra el stack entero. Mandarlos sólo ensucia el
 * panel y gasta la cuota con ruido que nadie va a mirar.
 */
export function debeActivarse({ dsn, dev } = {}) {
  if (dev) return false;
  const limpio = typeof dsn === 'string' ? dsn.trim() : '';
  if (limpio === '') return false;
  if (limpio === DSN_DE_EJEMPLO) return false;
  return true;
}

// Un uuid, en cualquier parte del camino. `clubes/<uuid>/editar` y
// `p/<uuid>` son rutas reales de esta app.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Una URL sin lo que identifica a nadie.
 *
 * Se va la query ENTERA —ahí viven los `id=eq.<uuid>` y el texto que la
 * persona escribió en el buscador— y los uuid del camino se reemplazan por
 * `<id>`. Se conserva el camino, que es lo único que sirve para depurar:
 * «falló una petición» no se puede arreglar, «falló `/rpc/buscar_jugadores`»
 * sí.
 *
 * NUNCA LANZA. Corre dentro del envío de un error: si reventara acá, el
 * error original se perdería y además aparecería uno nuevo y falso.
 */
export function limpiarUrl(url) {
  if (typeof url !== 'string') {
    if (url === null || url === undefined) return url;
    return String(url);
  }
  try {
    const sinQuery = url.split('?')[0].split('#')[0];
    return sinQuery.replace(UUID, '<id>');
  } catch (_) {
    return '';
  }
}

/**
 * El evento tal como se deja salir.
 *
 * Quita la identidad que el SDK pudiera haber adjuntado y recorta todas las
 * URL: la de la petición que falló y la de cada miga de pan. El mensaje del
 * error y el stack se conservan enteros — son lo que hace útil el informe.
 *
 * TAMPOCO LANZA, y por la misma razón: Sentry cambia la forma de sus eventos
 * entre versiones y esto corre en el camino de salida de todos.
 */
export function limpiarEvento(evento) {
  if (!evento || typeof evento !== 'object') return evento;
  try {
    // No se identifica a nadie. Un informe anónimo sirve para arreglar el
    // fallo; saber a quién le pasó no cambia el arreglo.
    delete evento.user;

    if (evento.request && typeof evento.request === 'object') {
      evento.request.url = limpiarUrl(evento.request.url);
    }

    if (Array.isArray(evento.breadcrumbs)) {
      for (const miga of evento.breadcrumbs) {
        if (miga && miga.data && typeof miga.data === 'object' && 'url' in miga.data) {
          miga.data.url = limpiarUrl(miga.data.url);
        }
      }
    }
  } catch (_) {
    /* Un evento con una forma inesperada se manda como está antes que
       perderlo: la limpieza es la aduana, no un portón cerrado. */
  }
  return evento;
}
