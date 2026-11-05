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
 * Aplica `apply` de inmediato (para que la UI reaccione al toque sin esperar
 * la red), ejecuta `action()` — que debe resolver `{ error }`, el mismo
 * contrato que ya usan los servicios — y si falla aplica `revert`.
 *
 * `apply` y `revert` reciben el estado ACTUAL, no una foto del de antes
 * (C07): la bandeja sigue recibiendo avisos por Realtime mientras la
 * petición viaja, y restaurar la foto entera borraba esas novedades o
 * resucitaba avisos que otra acción ya había borrado bien. Cada acción
 * deshace sólo su propio cambio (`deshacerBorrado`, `deshacerLeidos`).
 *
 * Devuelve `{ error }` para que el llamador decida qué mostrar (banner,
 * etc.); la lista ya quedó correcta cuando esta promesa resuelve.
 */
export async function runOptimistic({ apply, revert, action, setItems }) {
  setItems((prev) => apply(prev));
  const { error } = await action();
  if (error) {
    setItems((prev) => revert(prev));
    return { error };
  }
  return { error: null };
}

const fechaDe = (n) => (n && n.created_at) || '';

/**
 * Devuelve a la lista los avisos que un borrado fallido había sacado, en su
 * lugar por fecha (más nuevo primero). Lo que ya está en la lista manda: si
 * llegó una versión más nueva de ese aviso por Realtime, no se pisa.
 */
export function deshacerBorrado(items, borrados = []) {
  const presentes = new Set(items.map((n) => n.id));
  const faltan = (borrados || []).filter((n) => n && !presentes.has(n.id));
  if (faltan.length === 0) return items;
  return [...items, ...faltan]
    .map((n, i) => ({ n, i }))
    .sort((x, y) => {
      const fx = fechaDe(x.n);
      const fy = fechaDe(y.n);
      if (fx !== fy) return fx < fy ? 1 : -1;
      return x.i - y.i;
    })
    .map(({ n }) => n);
}

/**
 * Vuelve a «sin leer» sólo los avisos que lo estaban antes de un «marcar»
 * fallido. Los que ya no están (otra acción los borró) no reaparecen.
 */
export function deshacerLeidos(items, ids = []) {
  const set = new Set(ids);
  if (set.size === 0) return items;
  return items.map((n) => (set.has(n.id) ? { ...n, read: false } : n));
}

/**
 * Abrir un aviso lo marca leído en el acto, pero sólo se queda así si el
 * servidor lo guardó (C08). Antes la tarjeta quedaba leída aunque
 * `markAsRead` fallara: la campana, la tarjeta y otra sesión discrepaban y al
 * recargar el aviso volvía a estar pendiente sin explicación. La navegación
 * no espera esto: se puede abrir el destino aunque el marcado falle.
 */
export async function leerAlAbrir({ id, markAsRead, setItems }) {
  return runOptimistic({
    apply: (items) => withRead(items, id),
    revert: (items) => deshacerLeidos(items, [id]),
    action: async () => {
      try {
        return (await markAsRead(id)) || { error: null };
      } catch (e) {
        return { error: e };
      }
    },
    setItems,
  });
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
  // Migración 48. El aviso dice «Hay un resultado por confirmar · confírmalo
  // o recházalo», así que una vez respondido queda mintiendo igual que una
  // solicitud ya aceptada. `resultado_en_disputa` es el rechazo: la fila
  // queda en 'rechazado' y sólo la moderación la reabre (48b).
  club_resultado_propuesto: { propuesto: null, confirmado: 'aceptada', rechazado: 'rechazada' },
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
  if (n.type === 'club_resultado_propuesto') {
    return r === 'aceptada' ? 'Resultado confirmado' : 'Resultado rechazado';
  }
  return r === 'aceptada' ? 'Solicitud aceptada' : 'Solicitud rechazada';
}

/**
 * Marca como respondidas las tarjetas cuya solicitud ya no está pendiente.
 *
 * `estados` trae, por id, el estado actual de cada fila de origen
 * (`friendships`, `requests`, `challenges`, `resultados`), o `null` si no se pudo
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
    } else if (n.type === 'club_resultado_propuesto' && data.resultId) {
      estado = estados.resultados?.get(data.resultId);
      // Ausente es «no sé», igual que el reto: puede ser la RLS —dejé de
      // administrar el club— y no que el resultado haya desaparecido.
      if (estado === undefined) return n;
    } else {
      return n;
    }
    const resolucion = resolucionDeEstado(n.type, estado);
    return resolucion ? { ...n, _actionsResolved: true, _resolucion: resolucion } : n;
  });
}
