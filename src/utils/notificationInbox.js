/**
 * Lógica pura de la bandeja de Avisos: qué vista mostrar, cómo aplicar un
 * cambio optimista con rollback si el servidor falla, y cómo evitar que una
 * misma acción (aceptar, rechazar, borrar, marcar todo…) se dispare dos
 * veces mientras la primera todavía está en vuelo.
 *
 * Deliberadamente sin React ni Supabase: la pantalla solo conecta esto con
 * `useState` y los servicios reales, para poder probar la lógica con
 * `node --test` sin levantar un renderer ni mockear la red.
 */

/**
 * Qué vista de la bandeja corresponde según el estado de carga.
 * `loading` manda siempre; si no está cargando, un error de listNotifications()
 * debe ganarle al estado vacío — nunca hay que mostrar «Todo al día» cuando en
 * realidad no pudimos ni preguntar si hay avisos.
 */
export function getInboxStatus({ loading, loadError }) {
  if (loading) return 'loading';
  if (loadError) return 'error';
  return 'ready';
}

/**
 * Guarda de una sola ejecución por id. `begin(id)` devuelve `false` si esa
 * misma acción ya está en curso — el llamador debe ignorar el segundo tap en
 * vez de repetir la operación. `end(id)` libera el id (siempre, haya salido
 * bien o mal la acción).
 */
export function createRequestGuard() {
  const busy = new Set();
  return {
    isBusy: (id) => busy.has(id),
    begin: (id) => {
      if (busy.has(id)) return false;
      busy.add(id);
      return true;
    },
    end: (id) => {
      busy.delete(id);
    },
  };
}

/**
 * Aplica `apply(items)` de inmediato (para que la UI reaccione al toque sin
 * esperar la red), ejecuta `action()` — que debe resolver `{ error }`, el
 * mismo contrato que ya usan los servicios — y si falla revierte `items` a
 * como estaba antes de tocar nada.
 *
 * Devuelve `{ error }` para que el llamador decida qué mostrar (banner,
 * etc.); el propio `items` ya quedó correcto (optimista u original) cuando
 * esta promesa resuelve.
 */
export async function runOptimistic({ items, apply, action, setItems }) {
  setItems(apply(items));
  const { error } = await action();
  if (error) {
    setItems(items);
    return { error };
  }
  return { error: null };
}

// Transformaciones puras reutilizadas como `apply` de runOptimistic.
export const withRead = (items, id) =>
  items.map((p) => (p.id === id ? { ...p, read: true } : p));

export const withAllRead = (items) => items.map((p) => ({ ...p, read: true }));

export const withoutId = (items, id) => items.filter((p) => p.id !== id);

/**
 * La tarjeta ya se respondió: sin botones y, si se sabe, con el resultado
 * (`'aceptada'`, `'rechazada'` o `'cerrada'`) para decirlo en su lugar.
 */
export const withActionsResolved = (items, id, resolucion = null) =>
  items.map((p) =>
    p.id === id ? { ...p, read: true, _actionsResolved: true, _resolucion: resolucion } : p
  );

/**
 * Mete en la lista un aviso que llegó por Realtime (INSERT o UPDATE).
 *
 * UN UPDATE NO PUEDE BORRAR LO QUE SÓLO SABE LA PANTALLA. Aceptar una
 * solicitud marca el aviso como leído; ese UPDATE vuelve por Realtime con la
 * fila de la base, que no trae `_actionsResolved`. Reemplazar la tarjeta
 * entera hacía reaparecer «Aceptar / Rechazar» un segundo después de haber
 * aceptado, y el segundo toque terminaba en «Cannot coerce the result to a
 * single JSON object»: la solicitud ya no estaba pendiente.
 */
export function fusionarAvisoEnVivo(items, notif) {
  const idx = items.findIndex((p) => p.id === notif.id);
  if (idx < 0) return [notif, ...items];
  const previo = items[idx];
  const next = [...items];
  next[idx] = previo._actionsResolved
    ? { ...notif, _actionsResolved: true, _resolucion: previo._resolucion ?? null }
    : notif;
  return next;
}

// Estado de la fila de origen → cómo terminó, por tipo de aviso. `null` es
// «sigue pendiente»: la tarjeta conserva sus botones.
const ESTADOS = {
  friend_request: { pending: null, accepted: 'aceptada', rejected: 'rechazada' },
  club_request: { pending: null, approved: 'aceptada', rejected: 'rechazada' },
  club_challenge: { pendiente: null, aceptado: 'aceptada', rechazado: 'rechazada' },
};

/**
 * Cómo terminó una solicitud según el estado de su fila. Cualquier estado
 * que no sea pendiente cierra la tarjeta; uno que no tiene nombre propio
 * (un reto caducado, una amistad borrada porque quien la envió la canceló)
 * queda como `'cerrada'`.
 */
export function resolucionDeEstado(tipo, estado) {
  const mapa = ESTADOS[tipo] || {};
  if (estado in mapa) return mapa[estado];
  return 'cerrada';
}

/** Lo que dice la tarjeta en lugar de los botones, o `null` si no aplica. */
export function textoResolucion(n) {
  const r = n?._resolucion;
  if (!r) return null;
  if (r === 'cerrada') return 'Ya no está pendiente';
  if (n.type === 'club_challenge') return r === 'aceptada' ? 'Reto aceptado' : 'Reto rechazado';
  return r === 'aceptada' ? 'Solicitud aceptada' : 'Solicitud rechazada';
}

/**
 * Marca como respondidas las tarjetas cuya solicitud ya no está pendiente.
 *
 * `estados` trae, por id, el estado actual de cada fila de origen
 * (`friendships`, `requests`, `challenges`), o `null` si no se pudo
 * averiguar — y entonces no se toca nada: mejor ofrecer los botones que
 * esconderlos sin saber.
 *
 * Sólo una amistad AUSENTE cuenta como cerrada: quien la envió puede
 * cancelarla y la fila se borra, pero las dos partes siempre pueden leerla
 * mientras existe. Una solicitud de club o un reto ausentes pueden ser la RLS
 * (dejé de administrar el club), así que ahí ausente es «no sé».
 */
export function conResoluciones(items, estados) {
  if (!estados) return items;
  return items.map((n) => {
    const data = n?.data || {};
    let estado;
    if (n.type === 'friend_request' && data.friendshipId) {
      estado = estados.friendships?.get(data.friendshipId);
    } else if (n.type === 'club_request' && data.requestId) {
      estado = estados.requests?.get(data.requestId);
      if (estado === undefined) return n;
    } else if (n.type === 'club_challenge' && data.challengeId) {
      estado = estados.challenges?.get(data.challengeId);
      if (estado === undefined) return n;
    } else {
      return n;
    }
    const resolucion = resolucionDeEstado(n.type, estado);
    return resolucion ? { ...n, _actionsResolved: true, _resolucion: resolucion } : n;
  });
}
