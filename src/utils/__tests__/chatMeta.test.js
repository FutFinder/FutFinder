/**
 * Pruebas de la lógica pura del chat.
 *
 * Se ejecutan con el runner que trae Node (no hay que instalar nada):
 *
 *     npm test
 *
 * Solo se prueban funciones puras: filtros, orden, contadores, fechas,
 * vista previa, agrupación de burbujas y validación de envío. Las capas que
 * hablan con Supabase no se prueban aquí porque el proyecto no tiene
 * infraestructura de mocks ni una base de pruebas.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterThreads,
  filterCounts,
  sortThreadsByActivity,
  totalUnread,
  mapThreadRow,
  threadTimeLabel,
  dayLabel,
  hourLabel,
  threadPreview,
  decorateMessages,
  canSendDraft,
  canUseMentionAll,
  mergeOlderMessages,
  decideAutoScroll,
  attachCachedSender,
  needsSenderFetch,
  createSharedChannel,
  trustLabel,
  playerLine,
  initialOf,
  parseComposerCommand,
  suggestCommands,
} = require('../chatMeta.js');

// ── Datos de apoyo ──────────────────────────────────────────────
const NOW = new Date('2026-08-05T15:00:00');

const threads = [
  {
    key: 'match:1',
    type: 'match',
    title: 'Mixto Ñuñoa',
    subtitle: 'sáb 21:00',
    last_at: '2026-08-05T14:32:00',
    unread: 3,
    last_message: { content: 'Llevo yo los petos', sender_id: 'u2' },
    last_sender_name: 'Camilo',
  },
  {
    key: 'club:9',
    type: 'club',
    title: 'Club Prueba',
    last_at: '2026-08-04T10:00:00',
    unread: 0,
    last_message: { content: 'hola hola', sender_id: 'me' },
    last_sender_name: 'Tú',
  },
  {
    key: 'match:2',
    type: 'match',
    title: 'Copa Barrio',
    last_at: '2026-08-04T21:00:00',
    unread: 0,
    last_message: { content: 'Quedamos 9 confirmados', sender_id: 'u3' },
    last_sender_name: 'Rodrigo',
  },
  {
    key: 'dm:7',
    type: 'dm',
    title: '@vicente23',
    last_at: '2026-08-05T12:04:00',
    unread: 1,
    last_message: { content: '¿Vas al partido del jueves?', sender_id: 'u7' },
  },
];

// ── Bandeja: mapThreadRow (fila de get_my_threads() → forma plana) ──
test('mapThreadRow: partido con mensajes, remitente ajeno', () => {
  const row = {
    thread_key: 'match:m1',
    thread_type: 'match',
    last_at: '2026-08-05T14:32:00',
    payload: {
      match_id: 'm1',
      titulo: 'Mixto Ñuñoa',
      cancha_nombre: 'Cancha 3',
      comuna: 'Ñuñoa',
      hora: '2026-08-05T21:00:00',
      estado: 'abierto',
      id_organizador: 'org1',
      foto_url: 'https://x/foto.jpg',
      unread: 3,
      has_important: false,
      muted: false,
      last_message: {
        id: 'msg1',
        content: 'Llevo yo los petos',
        created_at: '2026-08-05T14:32:00',
        sender_id: 'u2',
        is_important: false,
        mention_all: false,
        sender_username: 'camilo',
      },
    },
  };

  const out = mapThreadRow(row, 'me');
  assert.deepEqual(out, {
    key: 'match:m1',
    type: 'match',
    last_message: {
      id: 'msg1',
      content: 'Llevo yo los petos',
      created_at: '2026-08-05T14:32:00',
      sender_id: 'u2',
      is_important: false,
      mention_all: false,
    },
    last_at: '2026-08-05T14:32:00',
    unread: 3,
    has_important: false,
    muted: false,
    match_id: 'm1',
    title: 'Mixto Ñuñoa',
    subtitle: 'Cancha 3 · Ñuñoa',
    hora: '2026-08-05T21:00:00',
    estado: 'abierto',
    is_organizer: false,
    foto_url: 'https://x/foto.jpg',
    last_sender_name: 'camilo',
    last_sender_is_me: false,
  });
});

test('mapThreadRow: el organizador viendo su propio último mensaje dice "Tú"', () => {
  const row = {
    thread_key: 'match:m1',
    thread_type: 'match',
    last_at: '2026-08-05T14:32:00',
    payload: {
      match_id: 'm1',
      titulo: 'Mixto Ñuñoa',
      id_organizador: 'me',
      unread: 0,
      has_important: false,
      muted: false,
      last_message: { id: 'msg1', content: 'Llego en 10', sender_id: 'me' },
    },
  };
  const out = mapThreadRow(row, 'me');
  assert.equal(out.is_organizer, true);
  assert.equal(out.last_sender_name, 'Tú');
  assert.equal(out.last_sender_is_me, true);
});

test('mapThreadRow: partido sin mensajes no inventa un remitente ni una vista previa', () => {
  const row = {
    thread_key: 'match:m2',
    thread_type: 'match',
    last_at: '2026-08-06T21:00:00',
    payload: {
      match_id: 'm2',
      titulo: 'Partido nuevo',
      unread: 0,
      has_important: false,
      muted: false,
      last_message: null,
    },
  };
  const out = mapThreadRow(row, 'me');
  assert.equal(out.last_message, null);
  assert.equal('last_sender_name' in out, false);
  assert.equal('last_sender_is_me' in out, false);
});

test('mapThreadRow: club', () => {
  const row = {
    thread_key: 'club:c1',
    thread_type: 'club',
    last_at: '2026-08-04T10:00:00',
    payload: {
      club_id: 'c1',
      nombre: 'Club Prueba',
      foto_url: null,
      comuna: 'Providencia',
      member_count: 5,
      my_role: 'admin',
      unread: 0,
      has_important: true,
      muted: true,
      last_message: { id: 'msg2', content: 'hola hola', sender_id: 'me', is_important: true },
    },
  };
  const out = mapThreadRow(row, 'me');
  assert.equal(out.type, 'club');
  assert.equal(out.title, 'Club Prueba');
  assert.equal(out.subtitle, 'Chat del club · Providencia');
  assert.equal(out.member_count, 5);
  assert.equal(out.my_role, 'admin');
  assert.equal(out.muted, true);
  assert.equal(out.has_important, true);
  assert.equal(out.last_sender_name, 'Tú');
  assert.equal(out.last_message.is_important, true);
});

test('mapThreadRow: club sin comuna no deja un "· " colgando en el subtítulo', () => {
  const row = {
    thread_key: 'club:c2',
    thread_type: 'club',
    last_at: null,
    payload: { club_id: 'c2', nombre: 'Sin Comuna', member_count: 1, last_message: null },
  };
  const out = mapThreadRow(row, 'me');
  assert.equal(out.subtitle, 'Chat del club');
});

test('mapThreadRow: DM usa el username del otro para título y vista previa', () => {
  const row = {
    thread_key: 'dm:u7',
    thread_type: 'dm',
    last_at: '2026-08-05T12:04:00',
    payload: {
      other_id: 'u7',
      other_username: 'vicente23',
      other_foto_url: 'https://x/vicente.jpg',
      unread: 1,
      has_important: false,
      muted: false,
      last_message: { id: 'msg3', content: '¿Vas al partido del jueves?', sender_id: 'u7' },
    },
  };
  const out = mapThreadRow(row, 'me');
  assert.equal(out.type, 'dm');
  assert.equal(out.title, '@vicente23');
  assert.equal(out.subtitle, 'Amigos');
  assert.equal(out.other_id, 'u7');
  assert.equal(out.foto_url, 'https://x/vicente.jpg');
  // Los DMs nunca llevan "prefijo de remitente" (threadPreview ya lo asume).
  assert.equal('last_sender_name' in out, false);
});

test('mapThreadRow: sin payload no rompe, degrada a valores por defecto', () => {
  const out = mapThreadRow({ thread_key: 'club:c3', thread_type: 'club', last_at: null }, 'me');
  assert.equal(out.unread, 0);
  assert.equal(out.has_important, false);
  assert.equal(out.muted, false);
  assert.equal(out.member_count, 1);
});

// ── Filtros ─────────────────────────────────────────────────────
test('el filtro Todos devuelve todas las conversaciones', () => {
  assert.equal(filterThreads(threads, 'todos').length, 4);
});

test('cada filtro devuelve solo su tipo de conversación', () => {
  assert.deepEqual(
    filterThreads(threads, 'partidos').map((t) => t.key),
    ['match:1', 'match:2']
  );
  assert.deepEqual(filterThreads(threads, 'clubes').map((t) => t.key), ['club:9']);
  assert.deepEqual(filterThreads(threads, 'amigos').map((t) => t.key), ['dm:7']);
});

test('un filtro sin conversaciones devuelve una lista vacía, no un error', () => {
  assert.deepEqual(filterThreads([], 'clubes'), []);
  assert.deepEqual(filterThreads(undefined, 'clubes'), []);
});

test('los contadores de las píldoras cuentan conversaciones por tipo', () => {
  assert.deepEqual(filterCounts(threads), {
    todos: 4,
    partidos: 2,
    clubes: 1,
    amigos: 1,
  });
});

test('sin conversaciones todos los contadores son cero (la UI los oculta)', () => {
  assert.deepEqual(filterCounts([]), { todos: 0, partidos: 0, clubes: 0, amigos: 0 });
});

// ── Orden ───────────────────────────────────────────────────────
test('las conversaciones se ordenan por actividad más reciente', () => {
  assert.deepEqual(
    sortThreadsByActivity(threads).map((t) => t.key),
    ['match:1', 'dm:7', 'match:2', 'club:9']
  );
});

test('una conversación sin actividad queda al final, no arriba', () => {
  const conNulo = [...threads, { key: 'match:3', type: 'match', last_at: null }];
  const ordenado = sortThreadsByActivity(conNulo);
  assert.equal(ordenado[ordenado.length - 1].key, 'match:3');
});

test('el orden no muta el arreglo original', () => {
  const copia = [...threads];
  sortThreadsByActivity(threads);
  assert.deepEqual(threads.map((t) => t.key), copia.map((t) => t.key));
});

// ── No leídos ───────────────────────────────────────────────────
test('el total de no leídos suma todas las conversaciones', () => {
  assert.equal(totalUnread(threads), 4);
});

test('sin no leídos el total es cero', () => {
  assert.equal(totalUnread([{ unread: 0 }, {}]), 0);
});

// ── Fechas ──────────────────────────────────────────────────────
test('un mensaje de hoy muestra la hora', () => {
  assert.equal(threadTimeLabel('2026-08-05T14:32:00', NOW), '14:32');
});

test('un mensaje de ayer dice «Ayer»', () => {
  assert.equal(threadTimeLabel('2026-08-04T21:00:00', NOW), 'Ayer');
});

test('un mensaje de esta semana muestra los días transcurridos', () => {
  assert.equal(threadTimeLabel('2026-08-02T21:00:00', NOW), '3 d');
});

test('un mensaje viejo muestra día y mes', () => {
  const label = threadTimeLabel('2026-06-12T21:00:00', NOW);
  assert.match(label, /12/);
  assert.doesNotMatch(label, /:/); // ya no es una hora
});

test('una fecha inválida o ausente no rompe la etiqueta', () => {
  assert.equal(threadTimeLabel(null, NOW), '');
  assert.equal(threadTimeLabel('no-es-fecha', NOW), '');
  assert.equal(hourLabel(undefined), '');
});

test('los separadores de día usan HOY y AYER', () => {
  assert.equal(dayLabel('2026-08-05T09:00:00', NOW), 'HOY');
  assert.equal(dayLabel('2026-08-04T09:00:00', NOW), 'AYER');
  assert.match(dayLabel('2026-07-01T09:00:00', NOW), /JUL/i);
});

// ── Vista previa ────────────────────────────────────────────────
test('en un grupo la vista previa antepone el remitente', () => {
  const p = threadPreview(threads[0]);
  assert.equal(p.prefix, 'Camilo:');
  assert.equal(p.text, 'Llevo yo los petos');
  assert.equal(p.tone, 'normal');
});

test('en un DM la vista previa no lleva remitente', () => {
  assert.equal(threadPreview(threads[3]).prefix, null);
});

test('una conversación de grupo sin mensajes invita a saludar, no repite el subtítulo', () => {
  const p = threadPreview({ type: 'match', subtitle: 'Chat del partido' });
  assert.equal(p.text, 'Sé el primero en saludar');
  assert.equal(p.prefix, null);
});

test('un DM sin mensajes dice que no hay mensajes todavía', () => {
  assert.equal(threadPreview({ type: 'dm' }).text, 'Sin mensajes todavía');
});

test('un aviso /importante marca la vista previa como importante', () => {
  const p = threadPreview({
    type: 'club',
    last_message: { content: 'Se adelantó el partido', is_important: true },
    last_sender_name: 'Rodrigo',
  });
  assert.equal(p.tone, 'important');
});

// ── Agrupación de burbujas ──────────────────────────────────────
const base = '2026-08-05T20:00:00';
const msgs = [
  { id: '1', sender_id: 'u2', content: 'Confirmen quién llega', created_at: '2026-08-05T20:04:00' },
  { id: '2', sender_id: 'u2', content: 'Yo llevo los petos', created_at: '2026-08-05T20:05:00' },
  { id: '3', sender_id: 'me', content: 'Yo llego 20:30', created_at: '2026-08-05T20:11:00' },
  { id: '4', sender_id: 'u3', content: 'Nos vemos', created_at: '2026-08-06T20:19:00' },
];

test('el primer mensaje del día abre un separador', () => {
  const d = decorateMessages(msgs, { myId: 'me', isGroup: true, now: NOW });
  assert.equal(d[0].startsDay, true);
  assert.equal(d[1].startsDay, false);
  assert.equal(d[3].startsDay, true); // cambia de día
});

test('el segundo mensaje seguido del mismo autor pierde avatar y nombre', () => {
  const d = decorateMessages(msgs, { myId: 'me', isGroup: true, now: NOW });
  assert.equal(d[0].showAvatar, true);
  assert.equal(d[0].showSenderName, true);
  assert.equal(d[1].showAvatar, false);
  assert.equal(d[1].showSenderName, false);
});

test('los mensajes propios se marcan como míos y nunca muestran avatar', () => {
  const d = decorateMessages(msgs, { myId: 'me', isGroup: true, now: NOW });
  assert.equal(d[2].isMine, true);
  assert.equal(d[2].showAvatar, false);
});

test('en un chat individual nunca se muestra avatar ni nombre', () => {
  const d = decorateMessages(msgs, { myId: 'me', isGroup: false, now: NOW });
  assert.ok(d.every((x) => x.showAvatar === false && x.showSenderName === false));
});

test('dos mensajes del mismo autor muy separados en el tiempo no se agrupan', () => {
  const lejanos = [
    { id: 'a', sender_id: 'u2', content: 'uno', created_at: '2026-08-05T20:00:00' },
    { id: 'b', sender_id: 'u2', content: 'dos', created_at: '2026-08-05T21:00:00' },
  ];
  const d = decorateMessages(lejanos, { myId: 'me', isGroup: true, now: NOW });
  assert.equal(d[1].showAvatar, true);
});

test('un aviso importante nunca se agrupa con el anterior', () => {
  const conAviso = [
    { id: 'a', sender_id: 'u2', content: 'uno', created_at: '2026-08-05T20:00:00' },
    { id: 'b', sender_id: 'u2', content: 'AVISO', created_at: '2026-08-05T20:01:00', is_important: true },
  ];
  const d = decorateMessages(conAviso, { myId: 'me', isGroup: true, now: NOW });
  assert.equal(d[1].showAvatar, true);
});

test('una lista vacía de mensajes no rompe la decoración', () => {
  assert.deepEqual(decorateMessages([], { myId: 'me', isGroup: true }), []);
  assert.deepEqual(decorateMessages(undefined, { myId: 'me', isGroup: true }), []);
});

// ── Compositor ──────────────────────────────────────────────────
test('un mensaje vacío o de puros espacios no se puede enviar', () => {
  assert.equal(canSendDraft(''), false);
  assert.equal(canSendDraft('   '), false);
  assert.equal(canSendDraft('\n\t '), false);
  assert.equal(canSendDraft(undefined), false);
});

test('un mensaje con texto sí se puede enviar', () => {
  assert.equal(canSendDraft('Nos vemos allá'), true);
  assert.equal(canSendDraft('  hola  '), true);
});

test('no se puede enviar mientras hay un envío en curso (evita el duplicado)', () => {
  assert.equal(canSendDraft('hola', { sending: true }), false);
});

test('sin permiso de escritura no se puede enviar', () => {
  assert.equal(canSendDraft('hola', { canWrite: false }), false);
});

test('un mensaje más largo que el máximo se rechaza', () => {
  assert.equal(canSendDraft('x'.repeat(1001), { maxLength: 1000 }), false);
  assert.equal(canSendDraft('x'.repeat(1000), { maxLength: 1000 }), true);
});

test('desconexión: sin conexión no se puede enviar, aunque el resto esté en orden', () => {
  assert.equal(canSendDraft('hola', { offline: true }), false);
  assert.equal(canSendDraft('hola', { offline: true, canWrite: true, sending: false }), false);
  // Confirma que offline no es solo "otro más": sin él, ese mismo borrador sí se puede enviar.
  assert.equal(canSendDraft('hola', { offline: false, canWrite: true, sending: false }), true);
});

// ── Comandos grupales ───────────────────────────────────────────
test('/importante separa el comando del cuerpo del mensaje', () => {
  const p = parseComposerCommand('/importante Se adelantó el partido');
  assert.equal(p.command, '/importante');
  assert.equal(p.body, 'Se adelantó el partido');
});

test('un texto normal no se interpreta como comando', () => {
  const p = parseComposerCommand('nos vemos a las 20:45');
  assert.equal(p.command, null);
  assert.equal(p.body, 'nos vemos a las 20:45');
});

test('una barra con una palabra desconocida no es un comando', () => {
  assert.equal(parseComposerCommand('/loquesea hola').command, null);
});

test('las sugerencias completan lo que se está escribiendo', () => {
  const s = suggestCommands('/imp', { isClubAdmin: true, threadType: 'club' });
  assert.deepEqual(s.map((c) => c.command), ['/importante']);
});

test('un jugador que no es admin no ve /importante entre las sugerencias', () => {
  const s = suggestCommands('/', { isClubAdmin: false, threadType: 'club' });
  assert.ok(!s.some((c) => c.command === '/importante'));
  assert.ok(s.some((c) => c.command === '/todos'));
});

test('sin barra no se sugiere ningún comando', () => {
  assert.deepEqual(suggestCommands('hola', { isClubAdmin: true }), []);
});

// ── /todos: autorizado en grupos, rechazado en DM ────────────────
// La autorización real (que quien lo manda sea de verdad participante del
// grupo, y que solo se notifique a quien pertenece) la valida el backend —
// ver supabase/migrations/39_chat_mencion_todos.sql y
// supabase/tests/39_chat_mention_all_test.sql. Esto es la validación del
// lado del cliente: feedback inmediato, no la autorización en sí.
test('/todos autorizado: existe en chats de club y de partido', () => {
  assert.equal(canUseMentionAll('club'), true);
  assert.equal(canUseMentionAll('match'), true);
});

test('/todos rechazado: no existe en un DM ni con un tipo desconocido', () => {
  assert.equal(canUseMentionAll('dm'), false);
  assert.equal(canUseMentionAll(undefined), false);
  assert.equal(canUseMentionAll(null), false);
});

test('/todos aparece entre las sugerencias de un partido, /importante no', () => {
  const s = suggestCommands('/', { isClubAdmin: false, threadType: 'match' });
  assert.ok(s.some((c) => c.command === '/todos'));
  assert.ok(!s.some((c) => c.command === '/importante'));
});

test('en un DM no se sugiere ningún comando grupal', () => {
  const s = suggestCommands('/', { isClubAdmin: true, threadType: 'dm' });
  assert.deepEqual(s, []);
});

// ── Paginación: mensajes anteriores sin duplicar ─────────────────
test('mergeOlderMessages antepone la página antigua sin duplicar lo ya cargado', () => {
  const prev = [{ id: 'm3' }, { id: 'm4' }];
  const older = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]; // m3 ya estaba
  assert.deepEqual(mergeOlderMessages(prev, older), [
    { id: 'm1' },
    { id: 'm2' },
    { id: 'm3' },
    { id: 'm4' },
  ]);
});

test('mergeOlderMessages con una página vacía no cambia nada', () => {
  const prev = [{ id: 'm1' }];
  assert.deepEqual(mergeOlderMessages(prev, []), prev);
  assert.deepEqual(mergeOlderMessages(prev, undefined), prev);
});

// ── Scroll: nunca scrollToEnd() al paginar hacia atrás ───────────
test('decideAutoScroll al paginar (prepend) ajusta el offset, nunca "toEnd"', () => {
  const action = decideAutoScroll({
    isPrepending: true,
    isInitial: false,
    nearBottom: true, // aunque esté "cerca del fondo", prepending manda
    prevHeight: 2000,
    newHeight: 2450,
    prevScrollY: 300,
  });
  assert.equal(action.type, 'toOffset');
  assert.equal(action.offset, 300 + (2450 - 2000)); // conserva lo que se veía
  assert.equal(action.animated, false);
});

test('decideAutoScroll al paginar sin crecimiento real no hace nada', () => {
  const action = decideAutoScroll({
    isPrepending: true,
    isInitial: false,
    nearBottom: true,
    prevHeight: 2000,
    newHeight: 2000, // Realtime ya había traído todo: no hubo prepend real
    prevScrollY: 300,
  });
  assert.deepEqual(action, { type: 'none' });
});

test('decideAutoScroll en la carga inicial sí va al final (sin animación)', () => {
  const action = decideAutoScroll({
    isPrepending: false,
    isInitial: true,
    nearBottom: false,
    prevHeight: 0,
    newHeight: 900,
    prevScrollY: 0,
  });
  assert.deepEqual(action, { type: 'toEnd', animated: false });
});

test('decideAutoScroll con un mensaje nuevo solo sigue al final si ya estabas cerca', () => {
  const cercaDelFondo = decideAutoScroll({
    isPrepending: false,
    isInitial: false,
    nearBottom: true,
    prevHeight: 900,
    newHeight: 960,
    prevScrollY: 500,
  });
  assert.deepEqual(cercaDelFondo, { type: 'toEnd', animated: true });

  const leyendoHistorial = decideAutoScroll({
    isPrepending: false,
    isInitial: false,
    nearBottom: false, // el usuario scrolleó hacia arriba a leer mensajes viejos
    prevHeight: 900,
    newHeight: 960,
    prevScrollY: 50,
  });
  assert.deepEqual(leyendoHistorial, { type: 'none' });
});

// ── Realtime: remitente de un mensaje grupal recién llegado ─────
test('attachCachedSender completa el remitente si ya estaba en caché', () => {
  const profilesById = new Map([['u2', { username: 'camilo', foto_url: null }]]);
  const row = { id: 'm9', sender_id: 'u2', content: 'vamos' };
  const out = attachCachedSender(row, { isGroup: true, myId: 'me', profilesById });
  assert.deepEqual(out.sender, { username: 'camilo', foto_url: null });
});

test('attachCachedSender no toca mensajes propios ni DMs, y no inventa un remitente que no está en caché', () => {
  const profilesById = new Map();
  const propio = attachCachedSender(
    { id: 'm1', sender_id: 'me', content: 'hola' },
    { isGroup: true, myId: 'me', profilesById }
  );
  assert.equal(propio.sender, undefined);

  const dm = attachCachedSender(
    { id: 'm2', sender_id: 'u2', content: 'hola' },
    { isGroup: false, myId: 'me', profilesById }
  );
  assert.equal(dm.sender, undefined);

  const sinCache = attachCachedSender(
    { id: 'm3', sender_id: 'u3', content: 'hola' },
    { isGroup: true, myId: 'me', profilesById }
  );
  assert.equal(sinCache.sender, undefined);
});

test('needsSenderFetch: solo hace falta ir a buscarlo si es un grupo, es de otra persona y no está en caché', () => {
  const profilesById = new Map([['u2', { username: 'camilo' }]]);

  assert.equal(
    needsSenderFetch({ id: 'm1', sender_id: 'u3' }, { isGroup: true, myId: 'me', profilesById }),
    true
  );
  assert.equal(
    needsSenderFetch({ id: 'm2', sender_id: 'u2' }, { isGroup: true, myId: 'me', profilesById }),
    false // ya está en caché
  );
  assert.equal(
    needsSenderFetch({ id: 'm3', sender_id: 'me' }, { isGroup: true, myId: 'me', profilesById }),
    false // es mi propio mensaje
  );
  assert.equal(
    needsSenderFetch({ id: 'm4', sender_id: 'u3' }, { isGroup: false, myId: 'me', profilesById }),
    false // DM: no hay "remitente" que resolver además de la otra persona
  );
  assert.equal(
    needsSenderFetch(
      { id: 'm5', sender_id: 'u3', sender: { username: 'ya resuelto' } },
      { isGroup: true, myId: 'me', profilesById }
    ),
    false // ya venía con sender (p.ej. de listThreadMessages)
  );
});

// ── Realtime: un solo canal compartido entre varios suscriptores ────
// createSharedChannel es lo que reemplazó "cada pantalla abre su propio
// canal Realtime" — se prueba con un `open`/`close` falsos (nunca con
// Supabase real) para verificar exactamente la multiplexación: un solo
// recurso real, fan-out a todos, se cierra solo con el último.

/** Fábrica de un `open`/`close` de prueba que registra cuántas veces se llamó cada uno. */
function fakeChannelFactory() {
  const calls = { opened: 0, closed: 0 };
  let nextHandleId = 0;
  const io = {}; // se completa en open() para poder emitir desde el test
  return {
    calls,
    open: (ioArg) => {
      calls.opened += 1;
      io.emit = ioArg.emit;
      io.emitStatus = ioArg.emitStatus;
      return { id: ++nextHandleId };
    },
    close: () => {
      calls.closed += 1;
    },
    emit: (payload) => io.emit(payload),
    emitStatus: (status) => io.emitStatus(status),
  };
}

test('createSharedChannel: el primer suscriptor abre el canal; los siguientes no abren otro', () => {
  const fake = fakeChannelFactory();
  const shared = createSharedChannel({ open: fake.open, close: fake.close });

  shared.subscribe(() => {});
  assert.equal(fake.calls.opened, 1);

  shared.subscribe(() => {});
  shared.subscribe(() => {});
  assert.equal(fake.calls.opened, 1, 'un segundo y tercer suscriptor no deberían abrir otro canal');
});

test('createSharedChannel: un evento llega a TODOS los suscriptores activos (fan-out)', () => {
  const fake = fakeChannelFactory();
  const shared = createSharedChannel({ open: fake.open, close: fake.close });

  const received = [];
  shared.subscribe((payload) => received.push(['a', payload]));
  shared.subscribe((payload) => received.push(['b', payload]));
  shared.subscribe((payload) => received.push(['c', payload]));

  fake.emit({ eventType: 'INSERT', new: { id: 'm1' } });

  assert.deepEqual(received.map((r) => r[0]).sort(), ['a', 'b', 'c']);
  assert.deepEqual(received[0][1], { eventType: 'INSERT', new: { id: 'm1' } });
});

test('createSharedChannel: cancelar un suscriptor no afecta a los demás ni cierra el canal', () => {
  const fake = fakeChannelFactory();
  const shared = createSharedChannel({ open: fake.open, close: fake.close });

  const received = [];
  const unsubA = shared.subscribe(() => received.push('a'));
  shared.subscribe(() => received.push('b'));

  unsubA();
  assert.equal(fake.calls.closed, 0, 'el canal no debería cerrarse mientras quede un suscriptor');

  fake.emit({});
  assert.deepEqual(received, ['b'], 'el que canceló ya no debería recibir eventos');
});

test('createSharedChannel: el canal se cierra exactamente cuando se va el último suscriptor', () => {
  const fake = fakeChannelFactory();
  const shared = createSharedChannel({ open: fake.open, close: fake.close });

  const unsubA = shared.subscribe(() => {});
  const unsubB = shared.subscribe(() => {});

  unsubA();
  assert.equal(fake.calls.closed, 0);

  unsubB();
  assert.equal(fake.calls.closed, 1, 'debería cerrarse justo al irse el último');
});

test('createSharedChannel: tras cerrarse del todo, un nuevo suscriptor vuelve a abrir el canal', () => {
  const fake = fakeChannelFactory();
  const shared = createSharedChannel({ open: fake.open, close: fake.close });

  shared.subscribe(() => {})();
  assert.equal(fake.calls.opened, 1);
  assert.equal(fake.calls.closed, 1);

  shared.subscribe(() => {});
  assert.equal(fake.calls.opened, 2, 'un ciclo nuevo debería abrir el canal otra vez');
});

test('createSharedChannel: un suscriptor que lanza una excepción no le impide recibir a los demás', () => {
  const fake = fakeChannelFactory();
  const shared = createSharedChannel({ open: fake.open, close: fake.close });

  const received = [];
  shared.subscribe(() => {
    throw new Error('boom');
  });
  shared.subscribe((payload) => received.push(payload));

  assert.doesNotThrow(() => fake.emit({ id: 'm1' }));
  assert.deepEqual(received, [{ id: 'm1' }]);
});

test('createSharedChannel: el estado del canal (SUBSCRIBED/CHANNEL_ERROR…) llega a todos los que pidieron onStatus', () => {
  const fake = fakeChannelFactory();
  const shared = createSharedChannel({ open: fake.open, close: fake.close });

  const statusesA = [];
  const statusesB = [];
  shared.subscribe(() => {}, { onStatus: (s) => statusesA.push(s) });
  shared.subscribe(() => {}, { onStatus: (s) => statusesB.push(s) });

  fake.emitStatus('SUBSCRIBED');
  fake.emitStatus('CHANNEL_ERROR');

  assert.deepEqual(statusesA, ['SUBSCRIBED', 'CHANNEL_ERROR']);
  assert.deepEqual(statusesB, ['SUBSCRIBED', 'CHANNEL_ERROR']);
});

test('createSharedChannel: quien se suscribe después de que el canal ya esté "SUBSCRIBED" lo sabe de inmediato', () => {
  const fake = fakeChannelFactory();
  const shared = createSharedChannel({ open: fake.open, close: fake.close });

  shared.subscribe(() => {}, { onStatus: () => {} });
  fake.emitStatus('SUBSCRIBED');

  // Se suscribe tarde, sin esperar el próximo cambio de estado real.
  const lateStatuses = [];
  shared.subscribe(() => {}, { onStatus: (s) => lateStatuses.push(s) });

  assert.deepEqual(lateStatuses, ['SUBSCRIBED']);
});

test('createSharedChannel: un suscriptor sin onStatus no revienta cuando cambia el estado', () => {
  const fake = fakeChannelFactory();
  const shared = createSharedChannel({ open: fake.open, close: fake.close });

  shared.subscribe(() => {}); // sin onStatus
  assert.doesNotThrow(() => fake.emitStatus('SUBSCRIBED'));
});

test('createSharedChannel: muchos suscriptores simultáneos (bandeja + badge + varios hilos) siguen siendo un solo canal', () => {
  const fake = fakeChannelFactory();
  const shared = createSharedChannel({ open: fake.open, close: fake.close });

  const counters = Array.from({ length: 50 }, () => 0);
  const unsubs = counters.map((_, i) => shared.subscribe(() => { counters[i] += 1; }));

  assert.equal(fake.calls.opened, 1, '50 suscriptores no deberían abrir 50 canales');

  fake.emit({ id: 'm1' });
  fake.emit({ id: 'm2' });

  assert.ok(counters.every((c) => c === 2), 'cada uno de los 50 debería haber recibido los 2 eventos');

  unsubs.forEach((unsub) => unsub());
  assert.equal(fake.calls.closed, 1, 'con todos fuera, el canal se cierra una sola vez');
});

// ── Datos de jugador: N.A. en vez de valores inventados ─────────
test('sin asistencias confirmadas el Trust Score es N.A., nunca 100', () => {
  assert.equal(trustLabel({ trust_score: 100, asistencias_confirmadas: 0 }), 'N.A.');
  assert.equal(trustLabel({ trust_score: null }), 'N.A.');
  assert.equal(trustLabel({}), 'N.A.');
});

test('con asistencias confirmadas se muestra el Trust Score real', () => {
  assert.equal(trustLabel({ trust_score: 92, asistencias_confirmadas: 5 }), '92');
});

test('la línea del jugador escribe N.A. en los tramos sin dato', () => {
  assert.equal(
    playerLine({ posicion_preferida: ['delantero'], comuna: 'Ñuñoa', trust_score: 92, asistencias_confirmadas: 4 }),
    'Delantero · Ñuñoa · Trust 92'
  );
  assert.equal(playerLine({}), 'Posición N.A. · Comuna N.A. · Trust N.A.');
});

test('la posición centinela «sin_definir» no cuenta como posición', () => {
  assert.match(playerLine({ posicion_preferida: ['sin_definir'] }), /^Posición N\.A\./);
});

test('la inicial del avatar ignora la arroba', () => {
  assert.equal(initialOf('@vicente23'), 'V');
  assert.equal(initialOf({ username: 'camilo_9' }), 'C');
  assert.equal(initialOf(''), '?');
});
