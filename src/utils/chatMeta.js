/**
 * Reglas de presentación del módulo de chat: filtros, orden, contadores,
 * fechas, vista previa del último mensaje y agrupación de burbujas.
 *
 * Vive fuera de los componentes a propósito: son funciones puras, sin acceso
 * a Supabase ni a React, así que se pueden probar con `node --test`
 * (ver `src/utils/__tests__/chatMeta.test.js`).
 *
 * Reglas que NO se negocian aquí:
 *   - Las fechas vienen del servidor (`messages.created_at`). `now` se pasa
 *     como argumento para que las pruebas sean deterministas y para no
 *     confundir la hora del dispositivo con la del mensaje.
 *   - Un contador en cero NO se muestra.
 *   - Sin dato real se escribe `N.A.`, nunca un valor inventado.
 */

// ============================================================
// COMANDOS DEL COMPOSITOR (chats grupales)
// ============================================================

/**
 * Comandos disponibles en chats grupales (club y partido; no existen en DM,
 * donde no hay a quién más avisar o mencionar).
 *
 * `/importante` rompe el silencio: el aviso llega igual a quien tenga el chat
 * silenciado. Solo lo pueden usar los administradores del club — lo valida un
 * trigger en la BD (migración 32), no solo esta lista. Es exclusivo del chat
 * de club: un partido no tiene "administradores" en el mismo sentido.
 *
 * `/todos` menciona a todos los participantes reales del hilo (jugadores del
 * club, o inscritos/organizador del partido) y genera un aviso para cada
 * uno. Cualquier participante lo puede usar — la autorización real (que
 * quien lo manda sea de verdad parte del grupo, y que solo se notifique a
 * quien de verdad pertenece) la impone el backend, no esta lista: ver la
 * migración 39 y `supabase/tests/39_chat_mention_all_test.sql`.
 *
 * OJO: el diseño menciona un rol «Capitán» que no existe en el modelo de
 * datos (`club_members.rol` es 'admin' | 'jugador'), así que el permiso de
 * /importante queda en admin.
 */
export const CHAT_COMMANDS = [
  {
    command: '/importante',
    hint: 'Aviso que llega aunque tengan el chat silenciado',
    adminOnly: true,
    scopes: ['club'],
  },
  {
    command: '/todos',
    hint: 'Menciona a todos los participantes del chat',
    adminOnly: false,
    scopes: ['club', 'match'],
  },
];

/**
 * Separa el comando del cuerpo del mensaje.
 * '/importante Se adelantó el partido' → { command: '/importante', body: 'Se adelantó el partido' }
 * Un texto normal, o una barra con una palabra desconocida, devuelve
 * { command: null, body: <texto completo> }.
 */
export function parseComposerCommand(text) {
  const raw = text || '';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return { command: null, body: trimmed, raw };

  const match = trimmed.match(/^(\/[a-záéíóúñ]+)(\s+([\s\S]*))?$/i);
  if (!match) return { command: null, body: trimmed, raw };

  const command = match[1].toLowerCase();
  if (!CHAT_COMMANDS.some((c) => c.command === command)) {
    return { command: null, body: trimmed, raw };
  }
  return { command, body: (match[3] || '').trim(), raw };
}

/**
 * Comandos que calzan con lo que se está escribiendo ('/imp' → /importante),
 * filtrados también por en qué tipo de hilo estás — un DM no ofrece ninguno.
 */
export function suggestCommands(text, { isClubAdmin = false, threadType = 'club' } = {}) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith('/') || /\s/.test(trimmed)) return [];
  return CHAT_COMMANDS.filter(
    (c) =>
      c.command.startsWith(trimmed.toLowerCase()) &&
      (!c.adminOnly || isClubAdmin) &&
      (!c.scopes || c.scopes.includes(threadType))
  );
}

// ============================================================
// BANDEJA: normaliza una fila de get_my_threads() (RPC, migración 40)
// ============================================================

/**
 * Traduce una fila de la RPC `get_my_threads()` — `{ thread_key, thread_type,
 * last_at, payload }`, con los datos propios de cada tipo empacados en
 * `payload` — a la forma plana que ya esperaba el resto del chat (misma
 * forma que armaba `listMyThreads()` a mano antes de la migración 40).
 *
 * Pura a propósito: así se puede probar el mapeo exacto sin tocar Supabase.
 */
export function mapThreadRow(row, myId) {
  const p = row?.payload || {};
  const last = p.last_message;
  const senderId = last?.sender_id || null;

  const base = {
    key: row.thread_key,
    type: row.thread_type,
    last_message: last
      ? {
          id: last.id,
          content: last.content,
          created_at: last.created_at,
          sender_id: last.sender_id,
          is_important: !!last.is_important,
          mention_all: !!last.mention_all,
        }
      : null,
    last_at: row.last_at,
    unread: p.unread || 0,
    has_important: !!p.has_important,
    muted: !!p.muted,
  };

  const senderExtras = senderId
    ? {
        last_sender_name: senderId === myId ? 'Tú' : last?.sender_username || 'Jugador',
        last_sender_is_me: senderId === myId,
      }
    : {};

  if (row.thread_type === 'match') {
    return {
      ...base,
      match_id: p.match_id,
      title: p.titulo || 'Partido',
      subtitle: (p.cancha_nombre || '') + (p.comuna ? ` · ${p.comuna}` : ''),
      hora: p.hora || null,
      estado: p.estado || null,
      is_organizer: p.id_organizador === myId,
      foto_url: p.foto_url || null,
      ...senderExtras,
    };
  }

  if (row.thread_type === 'club') {
    return {
      ...base,
      club_id: p.club_id,
      title: p.nombre,
      subtitle: 'Chat del club' + (p.comuna ? ` · ${p.comuna}` : ''),
      member_count: p.member_count || 1,
      my_role: p.my_role || 'jugador',
      foto_url: p.foto_url || null,
      ...senderExtras,
    };
  }

  // dm
  return {
    ...base,
    other_id: p.other_id,
    other_username: p.other_username || 'jugador',
    other_foto: p.other_foto_url || null,
    foto_url: p.other_foto_url || null,
    title: '@' + (p.other_username || 'jugador'),
    subtitle: 'Amigos',
  };
}

/** Filtros de la bandeja, en el orden del diseño. */
export const CHAT_FILTERS = [
  { id: 'todos', label: 'Todos' },
  { id: 'partidos', label: 'Partidos' },
  { id: 'clubes', label: 'Clubes' },
  { id: 'amigos', label: 'Amigos' },
];

/** Tipo de hilo que corresponde a cada filtro (null = todos). */
const TYPE_BY_FILTER = {
  todos: null,
  partidos: 'match',
  clubes: 'club',
  amigos: 'dm',
};

/** Conversaciones que entran en un filtro. */
export function filterThreads(threads, filter) {
  const type = TYPE_BY_FILTER[filter];
  if (!type) return threads || [];
  return (threads || []).filter((t) => t.type === type);
}

/**
 * Orden por actividad más reciente. Las conversaciones sin actividad
 * (`last_at` nulo) quedan al final en vez de arriba.
 */
export function sortThreadsByActivity(threads) {
  return [...(threads || [])].sort((a, b) => {
    const ta = a.last_at ? new Date(a.last_at).getTime() : 0;
    const tb = b.last_at ? new Date(b.last_at).getTime() : 0;
    return tb - ta;
  });
}

/**
 * Contadores de cada píldora de filtro: cuántas conversaciones hay en cada
 * categoría. Es la definición que ya usaba el producto antes del rediseño.
 * Los ceros se devuelven como 0 y la UI simplemente no los pinta.
 */
export function filterCounts(threads) {
  const list = threads || [];
  return {
    todos: list.length,
    partidos: list.filter((t) => t.type === 'match').length,
    clubes: list.filter((t) => t.type === 'club').length,
    amigos: list.filter((t) => t.type === 'dm').length,
  };
}

/** Total de mensajes sin leer sumando todas las conversaciones. */
export function totalUnread(threads) {
  return (threads || []).reduce((acc, t) => acc + (t.unread || 0), 0);
}

// ============================================================
// FECHAS
// ============================================================

export function sameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Días de calendario entre dos fechas, ignorando la hora del día. */
function calendarDaysBetween(from, to) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** '14:32' a partir de un ISO del servidor. */
export function hourLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  );
}

/**
 * Etiqueta de la bandeja: hoy → hora, ayer → 'Ayer', esta semana → 'N d',
 * más antiguo → '28 jul'.
 */
export function threadTimeLabel(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  if (sameDay(d, now)) return hourLabel(iso);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Ayer';

  // Días de CALENDARIO, no horas transcurridas: 'Ayer' ya cubre el día −1, así
  // que un mensaje del lunes visto el jueves tiene que decir «3 d» aunque no
  // hayan pasado 72 horas exactas.
  const days = calendarDaysBetween(d, now);
  if (days >= 0 && days < 7) return `${Math.max(1, days)} d`;

  try {
    return d
      .toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
      .replace(/-/g, ' ')
      .replace('.', '')
      .trim();
  } catch {
    return '';
  }
}

/** Separador de día dentro de la conversación: 'HOY' | 'AYER' | 'MAR 12 AGO'. */
export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, now)) return 'HOY';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'AYER';

  try {
    return d
      .toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' })
      .replace(/\./g, '')
      .toUpperCase();
  } catch {
    return '';
  }
}

// ============================================================
// VISTA PREVIA DEL ÚLTIMO MENSAJE
// ============================================================

/**
 * Texto de la fila de la bandeja.
 *
 * @returns {{ prefix: string|null, text: string, tone: 'normal'|'important' }}
 *   `prefix` es el remitente en los grupos ('Camilo:' / 'Tú:'); en los DMs es
 *   null porque solo hay dos personas. `tone` marca los avisos /importante.
 */
export function threadPreview(thread) {
  const last = thread?.last_message;
  if (!last) {
    // Sin mensajes NO se repite el subtítulo: la fila de abajo ya dice de qué
    // conversación se trata, y verlo dos veces se lee como si fuera el último
    // mensaje.
    const isGroupThread = thread?.type === 'match' || thread?.type === 'club';
    return {
      prefix: null,
      text: isGroupThread ? 'Sé el primero en saludar' : 'Sin mensajes todavía',
      tone: 'normal',
    };
  }

  const isGroup = thread.type === 'match' || thread.type === 'club';
  const prefix = isGroup && thread.last_sender_name ? `${thread.last_sender_name}:` : null;

  return {
    prefix,
    text: last.content || '',
    tone: last.is_important ? 'important' : 'normal',
  };
}

/** Etiqueta del tipo de conversación bajo el título. */
export function threadKindLabel(thread) {
  if (thread?.type === 'club') return 'CHAT DEL CLUB';
  if (thread?.type === 'match') {
    return thread.subtitle ? `Chat del partido · ${thread.subtitle}` : 'Chat del partido';
  }
  return 'Amigos';
}

// ============================================================
// AGRUPACIÓN DE BURBUJAS
// ============================================================

/** Minutos dentro de los cuales dos mensajes del mismo autor se agrupan. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Decora cada mensaje con lo que la burbuja necesita saber de sus vecinos:
 * si abre un día nuevo, si muestra avatar y nombre, y si es el primero o el
 * último de una tanda del mismo autor (para afilar la esquina).
 *
 * @param {object[]} messages  ordenados antiguo → nuevo
 * @param {{ myId: string|null, isGroup: boolean, now?: Date }} opts
 */
export function decorateMessages(messages, { myId, isGroup, now = new Date() } = {}) {
  const list = messages || [];
  return list.map((m, i) => {
    const prev = list[i - 1];
    const next = list[i + 1];
    const isMine = !!myId && m.sender_id === myId;

    const startsDay = !prev || !sameDay(prev.created_at, m.created_at);

    const withinWindow = (a, b) => {
      if (!a || !b) return false;
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return Math.abs(tb - ta) <= GROUP_WINDOW_MS;
    };

    const samePrev =
      !startsDay && prev?.sender_id === m.sender_id && withinWindow(prev, m) && !m.is_important;
    const sameNext =
      next &&
      sameDay(m.created_at, next.created_at) &&
      next.sender_id === m.sender_id &&
      withinWindow(m, next) &&
      !next.is_important;

    return {
      message: m,
      isMine,
      startsDay,
      dayLabel: startsDay ? dayLabel(m.created_at, now) : null,
      // El avatar y el nombre solo en el primer mensaje de la tanda, y solo
      // en grupos para mensajes ajenos.
      showAvatar: isGroup && !isMine && !samePrev,
      showSenderName: isGroup && !isMine && !samePrev,
      isFirstOfRun: !samePrev,
      isLastOfRun: !sameNext,
    };
  });
}

// ============================================================
// COMPOSITOR
// ============================================================

/**
 * ¿Se puede enviar lo que hay escrito?
 * Rechaza vacíos y espacios sueltos, bloquea el doble envío, respeta el
 * permiso de escritura y — sin conexión — no ofrece enviar nada: no existe
 * una cola offline, así que prometerla sería mentir.
 */
export function canSendDraft(
  draft,
  { sending = false, canWrite = true, offline = false, maxLength = 1000 } = {}
) {
  if (!canWrite || sending || offline) return false;
  const trimmed = (draft || '').trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > maxLength) return false;
  return true;
}

/**
 * /todos («mencionar a todos») solo tiene sentido en un chat grupal — en un
 * DM ya está la otra persona, no hay a quién más mencionar. Esta es la
 * validación del lado del cliente para dar feedback inmediato; la
 * autorización real (quién es de verdad participante del grupo) la impone
 * el backend — ver la migración 39 y `supabase/tests/39_chat_mention_all_test.sql`.
 */
export function canUseMentionAll(threadType) {
  return threadType === 'match' || threadType === 'club';
}

// ============================================================
// PAGINACIÓN Y SCROLL
// ============================================================

/**
 * Combina una página de mensajes más antiguos con los ya cargados, sin
 * duplicar los que ya estaban (Realtime puede haber traído alguno mientras
 * se pedía la página anterior).
 *
 * @param {object[]} prev       mensajes ya cargados, antiguo → nuevo
 * @param {object[]} olderPage  página nueva, antiguo → nuevo (ya invertida)
 */
export function mergeOlderMessages(prev, olderPage) {
  const known = new Set((prev || []).map((m) => m.id));
  return [...(olderPage || []).filter((m) => !known.has(m.id)), ...(prev || [])];
}

/**
 * Decide qué hacer con el scroll cuando cambia el contenido de la lista de
 * mensajes. Nunca hace `scrollToEnd()` al paginar hacia atrás — en ese caso
 * ajusta el offset para que el mensaje que el usuario estaba mirando se
 * quede exactamente donde estaba, aunque arriba se hayan agregado N px de
 * mensajes nuevos.
 *
 * @returns {{ type: 'none' }
 *          | { type: 'toEnd', animated: boolean }
 *          | { type: 'toOffset', offset: number, animated: boolean }}
 */
export function decideAutoScroll({
  isPrepending,
  isInitial,
  nearBottom,
  prevHeight,
  newHeight,
  prevScrollY,
}) {
  if (isPrepending) {
    const delta = newHeight - prevHeight;
    if (delta <= 0) return { type: 'none' };
    return { type: 'toOffset', offset: prevScrollY + delta, animated: false };
  }
  if (isInitial) return { type: 'toEnd', animated: false };
  if (nearBottom) return { type: 'toEnd', animated: true };
  return { type: 'none' };
}

// ============================================================
// REALTIME: remitente de un mensaje grupal recién llegado
// ============================================================

/**
 * Un mensaje que llega por Realtime es la fila cruda de Postgres: no trae
 * `sender` (username/foto_url) como sí trae la carga inicial (que lo resuelve
 * con un join en `listThreadMessages`). Estas dos funciones deciden, sin
 * tocar la red, si ya se puede completar con lo que hay en caché y si además
 * hace falta ir a buscarlo.
 *
 * `profilesById` puede ser un `Map<string, {username, foto_url}>` o un
 * objeto plano — se usa lo que haya.
 */
function lookupProfile(profilesById, id) {
  if (!profilesById) return null;
  if (typeof profilesById.get === 'function') return profilesById.get(id) || null;
  return profilesById[id] || null;
}

function hasProfile(profilesById, id) {
  if (!profilesById) return false;
  if (typeof profilesById.has === 'function') return profilesById.has(id);
  return Object.prototype.hasOwnProperty.call(profilesById, id);
}

/** Devuelve el mensaje con `sender` adjunto si ya lo teníamos en caché. */
export function attachCachedSender(row, { isGroup, myId, profilesById }) {
  if (!isGroup || !row || row.sender_id === myId || row.sender) return row;
  const cached = lookupProfile(profilesById, row.sender_id);
  return cached ? { ...row, sender: cached } : row;
}

/** ¿Hace falta ir a buscar el perfil de quien mandó este mensaje? */
export function needsSenderFetch(row, { isGroup, myId, profilesById }) {
  if (!isGroup || !row || row.sender_id === myId || row.sender) return false;
  return !hasProfile(profilesById, row.sender_id);
}

// ============================================================
// MULTIPLEXADO DE UN CANAL COMPARTIDO (p.ej. Realtime)
// ============================================================

/**
 * Comparte UN solo recurso (típicamente un canal Realtime) entre varios
 * suscriptores, en vez de que cada uno abra el suyo — la bandeja de chats,
 * el badge del tab y una conversación abierta necesitan enterarse de los
 * mismos cambios en `messages`, y antes cada uno abría su propio WebSocket
 * a la misma tabla.
 *
 * Sin nada de Supabase acá a propósito: `open`/`close` son inyectados, así
 * que esto se prueba con un canal falso — lo que hay que probar es la
 * MULTIPLEXACIÓN en sí (un solo `open`, fan-out a todos, `close` solo con
 * el último), no la llamada real a Supabase.
 *
 * @param {{
 *   open: (io: { emit: Function, emitStatus: Function }) => any,
 *   close: (handle: any) => void,
 * }} deps
 *   `open` se llama solo cuando se pasa de 0 a 1 suscriptores y devuelve el
 *   handle que después recibe `close` (llamado solo al pasar de 1 a 0).
 * @returns {{ subscribe: (onEvent: Function, opts?: { onStatus?: Function }) => Function }}
 *   `subscribe` devuelve la función de limpieza (unsubscribe).
 */
export function createSharedChannel({ open, close }) {
  const listeners = new Map(); // onEvent -> { onStatus }
  let handle = null;
  let lastStatus = null;

  const safeCall = (fn, arg) => {
    if (!fn) return;
    try {
      fn(arg);
    } catch (e) {
      // Un suscriptor que revienta no debe tumbar a los demás ni al canal.
      console.error('[FutFinder] createSharedChannel listener error:', e);
    }
  };

  const emit = (payload) => {
    for (const onEvent of listeners.keys()) safeCall(onEvent, payload);
  };
  const emitStatus = (status) => {
    lastStatus = status;
    for (const { onStatus } of listeners.values()) safeCall(onStatus, status);
  };

  return {
    subscribe(onEvent, { onStatus } = {}) {
      listeners.set(onEvent, { onStatus });
      if (!handle) handle = open({ emit, emitStatus });
      // Quien se suscribe después de que el canal ya esté abierto no debe
      // quedarse "sin estado" hasta el próximo cambio real.
      if (lastStatus !== null) safeCall(onStatus, lastStatus);

      return () => {
        listeners.delete(onEvent);
        if (listeners.size === 0 && handle !== null) {
          close(handle);
          handle = null;
          lastStatus = null;
        }
      };
    },
  };
}

// ============================================================
// DATOS DE JUGADOR EN LISTAS DE CHAT
// ============================================================

const POSICION_LABEL = {
  arquero: 'Arquero',
  defensa: 'Defensa',
  medio: 'Mediocampista',
  delantero: 'Delantero',
  lateral: 'Lateral',
  volante: 'Volante',
};

/**
 * Trust Score de una fila de jugador. Es 100 por defecto en la BD, así que
 * sin asistencias confirmadas todavía no significa nada: 'N.A.', nunca 100.
 */
export function trustLabel(profile) {
  const confirmadas = profile?.asistencias_confirmadas;
  const score = profile?.trust_score;
  if (score === null || score === undefined) return 'N.A.';
  if (confirmadas !== undefined && Number(confirmadas) <= 0) return 'N.A.';
  return String(score);
}

/**
 * Línea secundaria de un jugador: 'Delantero · Ñuñoa · Trust 92'.
 * Cada tramo sin dato se escribe como 'N.A.' en vez de omitirse, porque el
 * diseño muestra explícitamente los huecos.
 */
export function playerLine(profile) {
  const posiciones = (profile?.posicion_preferida || []).filter(
    (p) => p && p !== 'sin_definir'
  );
  const pos = posiciones.length > 0 ? POSICION_LABEL[posiciones[0]] || posiciones[0] : null;
  const lugar = profile?.comuna || profile?.region || null;
  return [
    pos || 'Posición N.A.',
    lugar || 'Comuna N.A.',
    `Trust ${trustLabel(profile)}`,
  ].join(' · ');
}

/** Inicial del avatar sin foto. */
export function initialOf(nameOrProfile) {
  const base =
    typeof nameOrProfile === 'string'
      ? nameOrProfile
      : nameOrProfile?.username || nameOrProfile?.title || '';
  const clean = String(base).replace(/^@/, '').trim();
  return clean ? clean[0].toUpperCase() : '?';
}
