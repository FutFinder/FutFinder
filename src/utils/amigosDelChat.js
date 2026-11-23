/**
 * La lista del filtro «Amigos» de la bandeja de chat.
 *
 * ANTES el filtro mostraba sólo los DM que ya tenían un mensaje: con amigos
 * aceptados y ningún chat salía «Todavía no tienes chats con amigos», y para
 * escribirle a alguien había que entrar a su perfil. Ahora la lista son TODOS
 * los amigos aceptados; al que ya tiene conversación se le pinta su hilo real
 * (último mensaje, no leídos) y al que no, un DM vacío con la misma forma, de
 * modo que la tarjeta es la de siempre y tocarla abre `dm:<id>`, igual que el
 * botón «Mensaje» del perfil.
 *
 * BLOQUEOS. `listMyFriends()` sólo trae amistades `accepted`, y
 * `bloquear_usuario()` (migración 51) pasa la fila del par a 'blocked' sea
 * quien sea el que bloqueó, así que un bloqueo en cualquier sentido ya deja
 * fuera al amigo. Los hilos DM de `get_my_threads()` traen `friend_status`
 * (migración 131): uno en 'blocked' se descarta acá. `bloqueados` (los ids
 * que bloqueé yo) es un resguardo extra por si algo llegara desfasado.
 *
 * Pura y sin dependencias, para poder probarla con `node --test`.
 */

/** Texto comparable: sin tildes, sin mayúsculas, sin @ inicial, sin bordes. */
export function normalizarBusqueda(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^@+/, '')
    .trim();
}

function tiempo(hilo) {
  const t = hilo?.last_at ? new Date(hilo.last_at).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/** DM vacío para un amigo con el que todavía no hay mensajes. */
function hiloVacio(amigo) {
  const username = amigo.username || 'jugador';
  return {
    key: `dm:${amigo.user_id}`,
    type: 'dm',
    other_id: amigo.user_id,
    other_username: username,
    other_foto: amigo.foto_url || null,
    foto_url: amigo.foto_url || null,
    friend_status: 'accepted',
    title: `@${username}`,
    subtitle: 'Amigos',
    last_message: null,
    last_at: null,
    unread: 0,
    has_important: false,
    muted: false,
    sin_chat: true,
  };
}

/**
 * Une amigos aceptados y DMs en una sola lista.
 *
 * Orden: primero los que tienen conversación, por actividad más reciente;
 * después los amigos sin chat, por nombre de usuario. Un DM con alguien que
 * ya no es amigo (solo lectura) se conserva, como antes, entre los con chat.
 *
 * @param {{ amigos?: Array, hilos?: Array, bloqueados?: Iterable<string> }} p
 */
export function armarListaDeAmigos({ amigos = [], hilos = [], bloqueados = [] } = {}) {
  const fuera = new Set(bloqueados || []);

  const dmPorUsuario = new Map();
  for (const h of hilos || []) {
    if (!h || h.type !== 'dm' || !h.other_id) continue;
    if (h.friend_status === 'blocked' || fuera.has(h.other_id)) continue;
    dmPorUsuario.set(h.other_id, h);
  }

  const conChat = [];
  const sinChat = [];
  const vistos = new Set();

  for (const a of amigos || []) {
    const id = a?.user_id;
    if (!id || vistos.has(id) || fuera.has(id)) continue;
    vistos.add(id);
    const hilo = dmPorUsuario.get(id);
    if (hilo) conChat.push(hilo);
    else sinChat.push(hiloVacio(a));
  }

  // DM que siguen en la bandeja sin amistad vigente (ni bloqueo): solo lectura.
  for (const [id, hilo] of dmPorUsuario) {
    if (!vistos.has(id)) {
      vistos.add(id);
      conChat.push(hilo);
    }
  }

  conChat.sort((a, b) => tiempo(b) - tiempo(a));
  sinChat.sort((a, b) =>
    normalizarBusqueda(a.other_username).localeCompare(normalizarBusqueda(b.other_username), 'es')
  );
  return [...conChat, ...sinChat];
}

/**
 * Clave de comparación del buscador: además de tildes y mayúsculas, espacio,
 * `_`, `.` y `-` valen lo mismo, porque un usuario no lleva espacios y quien
 * busca «jose pena» quiere encontrar a `@jose_pena`.
 */
function claveDeBusqueda(texto) {
  return normalizarBusqueda(texto).replace(/[\s_.-]+/g, ' ').trim();
}

/** Filtra la lista por nombre de usuario; una búsqueda vacía devuelve todo. */
export function filtrarAmigos(lista, busqueda) {
  const q = claveDeBusqueda(busqueda);
  if (!q) return lista || [];
  return (lista || []).filter((h) =>
    claveDeBusqueda(h.other_username || h.title).includes(q)
  );
}
