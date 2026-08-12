/**
 * Pruebas del hilo de negociación de un desafío entre clubes.
 *
 * Lo que de verdad se está protegiendo acá:
 *   - La clave del hilo tiene que caber en `chat_reads.thread_key`, que
 *     tiene `check (length between 3 and 120)`. Si no cabe, marcar como
 *     leído falla en silencio y el hilo queda con no leídos para siempre.
 *   - El título no depende de quién mira: los dos administradores tienen
 *     que estar viendo el mismo «Retador vs Retado».
 *   - El acento rojo neón se apaga por administrador, no para todos.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const T = require('../challengeThread.js');

const UUID = '3f7c1a2e-9b4d-4f11-8a2c-1d5e6f7a8b90';

// ─────────────────────────────────────────────── clave del hilo

test('challengeThreadKey arma la clave con el prefijo del tipo de hilo', () => {
  assert.equal(T.challengeThreadKey(UUID), `challenge:${UUID}`);
});

test('la clave del hilo cabe en el CHECK de chat_reads (3 a 120)', () => {
  const key = T.challengeThreadKey(UUID);
  assert.ok(key.length >= T.THREAD_KEY_MIN, 'la clave es más corta que el mínimo');
  assert.ok(key.length <= T.THREAD_KEY_MAX, 'la clave pasa el máximo de chat_reads');
});

test('un id que haría una clave demasiado larga devuelve null en vez de una clave inválida', () => {
  assert.equal(T.challengeThreadKey('x'.repeat(200)), null);
});

test('sin id no hay clave', () => {
  assert.equal(T.challengeThreadKey(null), null);
  assert.equal(T.challengeThreadKey(undefined), null);
  assert.equal(T.challengeThreadKey(''), null);
});

test('parseChallengeThread recupera exactamente el id que se le puso', () => {
  assert.deepEqual(T.parseChallengeThread(`challenge:${UUID}`), { challengeId: UUID });
});

test('parseChallengeThread ignora los otros tipos de hilo', () => {
  assert.equal(T.parseChallengeThread(`dm:${UUID}`), null);
  assert.equal(T.parseChallengeThread(`club:${UUID}`), null);
  assert.equal(T.parseChallengeThread(`match:${UUID}`), null);
  assert.equal(T.parseChallengeThread(null), null);
});

test('«challenge:» sin id no es un hilo válido', () => {
  assert.equal(T.parseChallengeThread('challenge:'), null);
});

test('isChallengeThreadKey distingue el tipo nuevo de los tres anteriores', () => {
  assert.equal(T.isChallengeThreadKey(`challenge:${UUID}`), true);
  assert.equal(T.isChallengeThreadKey(`club:${UUID}`), false);
  assert.equal(T.isChallengeThreadKey(undefined), false);
});

// ─────────────────────────────────────────────── título y subtítulo

const hilo = (extra = {}) => ({
  type: 'challenge',
  estado: 'negociacion',
  club_retador: { id: 'a', nombre: 'Los Tigres' },
  club_retado: { id: 'b', nombre: 'Deportivo Sur' },
  ...extra,
});

test('el título es «Retador vs Retado» y no cambia según quién lo mire', () => {
  assert.equal(T.challengeThreadTitle(hilo()), 'Los Tigres vs Deportivo Sur');
  // El mismo hilo, mirado por un admin del club retado: mismo título.
  assert.equal(
    T.challengeThreadTitle(hilo({ mi_club_id: 'b' })),
    'Los Tigres vs Deportivo Sur'
  );
});

test('sin los dos clubes el título no inventa nombres', () => {
  assert.equal(T.challengeThreadTitle({ club_retador: { nombre: 'Los Tigres' } }),
    'Desafío entre clubes');
  assert.equal(T.challengeThreadTitle(null), 'Desafío entre clubes');
});

test('el subtítulo es la etiqueta en español del estado', () => {
  assert.equal(T.challengeThreadSubtitle(hilo()), 'Negociación');
  assert.equal(
    T.challengeThreadSubtitle(hilo({ estado: 'esperando_aprobacion' })),
    'Propuesta oficial enviada'
  );
});

// ─────────────────────────────────────────────── cuenta atrás

test('la cuenta atrás se mide contra la hora que se le pasa, no contra el reloj del equipo', () => {
  const ahora = new Date('2026-08-10T12:00:00Z');
  const vence = new Date('2026-08-11T12:00:00Z').toISOString();
  const c = T.challengeCountdown(hilo({ vence_at: vence }), ahora);
  assert.equal(c.vencido, false);
  assert.equal(c.label, 'Quedan 1 día');
});

test('un plazo pasado se informa como vencido, no como tiempo negativo', () => {
  const ahora = new Date('2026-08-12T12:00:00Z');
  const vence = new Date('2026-08-11T12:00:00Z').toISOString();
  const c = T.challengeCountdown(hilo({ vence_at: vence }), ahora);
  assert.equal(c.vencido, true);
  assert.equal(c.label, 'Plazo vencido');
});

test('un desafío cerrado no muestra cuenta atrás', () => {
  const ahora = new Date('2026-08-10T12:00:00Z');
  const vence = new Date('2026-08-11T12:00:00Z').toISOString();
  assert.equal(T.challengeCountdown(hilo({ estado: 'cancelado', vence_at: vence }), ahora), null);
  assert.equal(T.challengeCountdown(hilo({ estado: 'sin_acuerdo', vence_at: vence }), ahora), null);
});

test('sin vence_at no hay cuenta atrás que mostrar', () => {
  assert.equal(T.challengeCountdown(hilo(), new Date()), null);
});

test('la cuenta atrás avisa cuando el plazo abierto es la prórroga', () => {
  const ahora = new Date('2026-08-10T12:00:00Z');
  const vence = new Date('2026-08-10T18:00:00Z').toISOString();
  const c = T.challengeCountdown(
    hilo({ vence_at: vence, prorroga_abierta: true }),
    ahora
  );
  assert.equal(c.prorroga, true);
  assert.equal(c.label, 'Quedan 6 h');
});

// ─────────────────────────────────────────────── acento de la tarjeta

test('un desafío sin abrir lleva el acento rojo neón', () => {
  assert.equal(T.resolveThreadAccent(hilo({ abierto_alguna_vez: false })), 'neon');
});

test('el acento neón se apaga en cuanto ESE administrador abre el hilo', () => {
  assert.equal(T.resolveThreadAccent(hilo({ abierto_alguna_vez: true })), 'challenge');
});

test('el acento no se apaga para todos: depende de abierto_alguna_vez, que es por usuario', () => {
  // Misma conversación, dos administradores distintos: uno ya la abrió y
  // el otro no. `abierto_alguna_vez` sale de `chat_reads`, que tiene una
  // fila por usuario, así que cada uno ve su propio acento.
  const yaLaAbrio = hilo({ abierto_alguna_vez: true });
  const noLaAbrio = hilo({ abierto_alguna_vez: false });
  assert.notEqual(T.resolveThreadAccent(yaLaAbrio), T.resolveThreadAccent(noLaAbrio));
});

test('el aviso /importante manda sobre el resto de los acentos', () => {
  assert.equal(
    T.resolveThreadAccent({ type: 'club', has_important: true }),
    'important'
  );
});

test('los otros tipos de hilo conservan el acento que ya tenían', () => {
  assert.equal(T.resolveThreadAccent({ type: 'club' }), 'club');
  assert.equal(T.resolveThreadAccent({ type: 'match' }), null);
  assert.equal(T.resolveThreadAccent({ type: 'dm' }), null);
  assert.equal(T.resolveThreadAccent(null), null);
});

// ─────────────────────────────────────────────── etiqueta de la tarjeta

test('sin abrir, la tarjeta anuncia el desafío nuevo', () => {
  assert.equal(T.challengeCardLabel(hilo({ abierto_alguna_vez: false })), 'Nuevo desafío aceptado');
});

test('ya abierta, la tarjeta baja el tono al estado real', () => {
  assert.equal(T.challengeCardLabel(hilo({ abierto_alguna_vez: true })), 'Negociación activa');
  assert.equal(
    T.challengeCardLabel(hilo({ abierto_alguna_vez: true, estado: 'publicado' })),
    'Partido publicado'
  );
  assert.equal(
    T.challengeCardLabel(hilo({ abierto_alguna_vez: true, estado: 'sin_acuerdo' })),
    'Sin acuerdo'
  );
});

// ════════════════════════════════════════════════════════════════
// CONTEXTO DE LA ACCIÓN DEL DESAFÍO
// ════════════════════════════════════════════════════════════════
// Regresión: la pantalla armaba este objeto a mano y nombraba la
// variable local en español (`miClubId`) mientras que `getChallengeCta`
// lee la clave en inglés (`myClubId`). Con la forma abreviada de objeto,
// ese desajuste no era una clave mal puesta sino una referencia a un
// identificador inexistente: `ReferenceError: myClubId is not defined`
// en cada render, que dejaba el chat del desafío en blanco.
//
// Por eso el contexto se arma en una función pura y estas pruebas fijan
// el NOMBRE de la clave, no solo su valor.

const { getChallengeCta } = require('../../services/clubChallengeRules.js');

const desafio = {
  estado: 'negociacion',
  club_retador_id: 'club-a',
  club_retado_id: 'club-b',
};

test('challengeCtaContext usa exactamente la clave myClubId que lee getChallengeCta', () => {
  const ctx = T.challengeCtaContext({ challenge: desafio, misClubIds: ['club-b'] });
  assert.ok(
    Object.prototype.hasOwnProperty.call(ctx, 'myClubId'),
    'el contexto tiene que traer la clave myClubId'
  );
  assert.equal(ctx.myClubId, 'club-b');
});

test('reconoce mi club sea el retador o el retado', () => {
  assert.equal(T.challengeCtaContext({ challenge: desafio, misClubIds: ['club-a'] }).myClubId, 'club-a');
  assert.equal(T.challengeCtaContext({ challenge: desafio, misClubIds: ['club-b'] }).myClubId, 'club-b');
});

test('un club ajeno al desafío no me convierte en parte de él', () => {
  const ctx = T.challengeCtaContext({ challenge: desafio, misClubIds: ['otro-club'] });
  assert.equal(ctx.myClubId, null);
});

test('sin clubes administrados no soy admin y no hay club propio', () => {
  const ctx = T.challengeCtaContext({ challenge: desafio, misClubIds: [] });
  assert.equal(ctx.myClubId, null);
  assert.equal(ctx.soyAdmin, false);
});

test('no revienta con entradas ausentes', () => {
  const ctx = T.challengeCtaContext({});
  assert.equal(ctx.myClubId, null);
  assert.equal(ctx.soyAdmin, false);
});

test('el contexto encaja con getChallengeCta: un admin en negociación puede crear la propuesta', () => {
  // Ésta es la prueba que habría atrapado el fallo: con el contexto mal
  // armado, `myClubId` llegaba indefinido y la acción caía a otra rama.
  const cta = getChallengeCta(T.challengeCtaContext({ challenge: desafio, misClubIds: ['club-b'] }));
  assert.equal(cta.kind, 'crear_propuesta');
});

test('quien no administra ninguno de los dos clubes solo lee', () => {
  const cta = getChallengeCta(T.challengeCtaContext({ challenge: desafio, misClubIds: [] }));
  assert.equal(cta.kind, 'solo_lectura');
});

test('sin conexión la acción lo dice antes que cualquier otra cosa', () => {
  const cta = getChallengeCta(
    T.challengeCtaContext({ challenge: desafio, misClubIds: ['club-b'], online: false })
  );
  assert.equal(cta.kind, 'sin_conexion');
});
