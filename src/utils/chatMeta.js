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
// COMANDOS DEL COMPOSITOR (chat de club)
// ============================================================

/**
 * Comandos disponibles en el chat del club.
 *
 * `/importante` rompe el silencio: el aviso llega igual a quien tenga el chat
 * silenciado. Solo lo pueden usar los administradores del club — lo valida un
 * trigger en la BD (migración 32), no solo esta lista.
 *
 * OJO: el diseño menciona un rol «Capitán» que no existe en el modelo de
 * datos (`club_members.rol` es 'admin' | 'jugador'), así que el permiso queda
 * en admin.
 */
export const CHAT_COMMANDS = [
  {
    command: '/importante',
    hint: 'Aviso que llega aunque tengan el chat silenciado',
    adminOnly: true,
  },
  {
    command: '/todos',
    hint: 'Menciona a todos los jugadores del club',
    adminOnly: false,
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

/** Comandos que calzan con lo que se está escribiendo ('/imp' → /importante). */
export function suggestCommands(text, { isClubAdmin = false } = {}) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith('/') || /\s/.test(trimmed)) return [];
  return CHAT_COMMANDS.filter(
    (c) => c.command.startsWith(trimmed.toLowerCase()) && (!c.adminOnly || isClubAdmin)
  );
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
 * Rechaza vacíos y espacios sueltos, bloquea el doble envío y respeta el
 * permiso de escritura.
 */
export function canSendDraft(draft, { sending = false, canWrite = true, maxLength = 1000 } = {}) {
  if (!canWrite || sending) return false;
  const trimmed = (draft || '').trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > maxLength) return false;
  return true;
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
