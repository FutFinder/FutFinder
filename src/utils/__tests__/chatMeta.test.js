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
  threadTimeLabel,
  dayLabel,
  hourLabel,
  threadPreview,
  decorateMessages,
  canSendDraft,
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

// ── Comandos del club ───────────────────────────────────────────
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
  const s = suggestCommands('/imp', { isClubAdmin: true });
  assert.deepEqual(s.map((c) => c.command), ['/importante']);
});

test('un jugador que no es admin no ve /importante entre las sugerencias', () => {
  const s = suggestCommands('/', { isClubAdmin: false });
  assert.ok(!s.some((c) => c.command === '/importante'));
  assert.ok(s.some((c) => c.command === '/todos'));
});

test('sin barra no se sugiere ningún comando', () => {
  assert.deepEqual(suggestCommands('hola', { isClubAdmin: true }), []);
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
