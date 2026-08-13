/**
 * Pruebas de a dónde navega cada tipo de aviso (`resolveNotificationTarget`),
 * de la verificación de que el recurso destino sigue existiendo
 * (`verifyTargetExists`) y del flujo completo resolver→verificar→navegar
 * (`navigateToNotification`).
 *
 * `getMatchById`/`getClubById` son inyectados con fakes — el módulo real no
 * los importa (ver notificationTargets.js), así que no hay que tocar
 * Supabase/React Native para probar esta lógica.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveNotificationTarget,
  verifyTargetExists,
  navigateToNotification,
  UNRESOLVED_NOTIFICATION_COPY,
} = require('../notificationTargets.js');

const { NOTIF_TYPE_TO_PREFERENCE } = require('../notificationPreferences.js');

// ---------------------------------------------------------------------------
// Un payload de `data` plausible para cada tipo — lo mínimo que necesita
// para resolver a un destino real (no null).
// ---------------------------------------------------------------------------
const SAMPLE_DATA_BY_TYPE = {
  match_join: { matchId: 'm1' },
  match_reminder: { matchId: 'm1' },
  match_rate: { matchId: 'm1' },
  join_request: { matchId: 'm1' },
  join_approved: { matchId: 'm1' },
  join_rejected: { matchId: 'm1' },
  match_cancelled: {},
  match_updated: { matchId: 'm1' },
  match_slot_free: { matchId: 'm1' },
  waitlist_turn: { matchId: 'm1' },
  match_left: { matchId: 'm1' },
  match_attendance: { matchId: 'm1' },
  club_request: { clubId: 'c1' },
  club_request_accepted: { clubId: 'c1' },
  club_request_rejected: {},
  club_member_joined: { clubId: 'c1' },
  club_member_left: { clubId: 'c1' },
  club_invite_accepted: { clubId: 'c1' },
  club_challenge: { clubRetadoId: 'c1', clubRetadorId: 'c2' },
  club_challenge_accepted: { clubRetadorId: 'c1', clubRetadoId: 'c2' },
  club_challenge_rejected: { clubRetadorId: 'c1', clubRetadoId: 'c2' },
  // Ciclo formal (migración 43): los tres primeros ocurren dentro de la
  // negociación y siempre traen el hilo. El cierre es el único que puede
  // llegar sin él (un desafío que expiró sin que nadie lo aceptara), y esa
  // rama tiene su propia prueba más abajo.
  club_challenge_extension: { challengeId: 'ch1', threadKey: 'challenge:ch1' },
  club_challenge_closed: { challengeId: 'ch1', threadKey: 'challenge:ch1' },
  club_challenge_proposal: { challengeId: 'ch1', threadKey: 'challenge:ch1' },
  club_challenge_proposal_rejected: { challengeId: 'ch1', threadKey: 'challenge:ch1' },
  // Publicado (migración 44): el destino NO es el hilo sino el partido. Es lo
  // que el aviso anuncia, y lo reciben también los jugadores sin rol, que no
  // tienen nada que hacer en la negociación entre administradores.
  club_match_published: { challengeId: 'ch1', matchId: 'm1', threadKey: 'challenge:ch1' },
  club_match_reserva_omitida: { matchId: 'm1', challengeId: 'ch1', motivo: 'ya tienes otro partido en ese horario' },
  message_new: { threadKey: 'dm:u1' },
  chat_mention_all: { threadKey: 'club:c1' },
  friend_request: { fromUserId: 'u1' },
  friend_accept: { fromUserId: 'u1' },
};

const EXPECTED_SCREEN_BY_TYPE = {
  match_join: 'MatchDetail',
  match_reminder: 'MatchDetail',
  match_rate: 'RateMatch',
  join_request: 'ManageMatch',
  join_approved: 'MatchDetail',
  join_rejected: 'MatchDetail',
  match_cancelled: 'Main',
  match_updated: 'MatchDetail',
  match_slot_free: 'MatchDetail',
  waitlist_turn: 'MatchDetail',
  match_left: 'MatchDetail',
  match_attendance: 'MatchDetail',
  club_request: 'ClubDetail',
  club_request_accepted: 'ClubDetail',
  club_request_rejected: 'Main',
  club_member_joined: 'ClubDetail',
  club_member_left: 'ClubDetail',
  club_invite_accepted: 'ClubDetail',
  club_challenge: 'ClubChallenges',
  club_challenge_accepted: 'ClubChallenges',
  club_challenge_rejected: 'ClubChallenges',
  club_challenge_extension: 'ChatThread',
  club_challenge_closed: 'ChatThread',
  club_challenge_proposal: 'ChatThread',
  club_challenge_proposal_rejected: 'ChatThread',
  club_match_published: 'MatchDetail',
  // A la NÓMINA, no al detalle: lo único que se puede hacer con este aviso
  // es inscribirse cuando el impedimento se resuelva, y eso se hace ahí.
  club_match_reserva_omitida: 'ClubMatchRoster',
  message_new: 'ChatThread',
  chat_mention_all: 'ChatThread',
  friend_request: 'UserProfile',
  friend_accept: 'UserProfile',
};

// ---------------------------------------------------------------------------
// resolveNotificationTarget — cada tipo conocido llega a un destino real
// ---------------------------------------------------------------------------

test('resolveNotificationTarget: todos los tipos mapeados en NOTIF_TYPE_TO_PREFERENCE resuelven a un destino', () => {
  const knownTypes = Object.keys(NOTIF_TYPE_TO_PREFERENCE);
  assert.ok(knownTypes.length > 0, 'la lista de tipos conocidos no debería estar vacía');

  for (const type of knownTypes) {
    const data = SAMPLE_DATA_BY_TYPE[type];
    assert.notEqual(data, undefined, `falta un payload de ejemplo para el tipo "${type}"`);

    const target = resolveNotificationTarget({ type, data });
    assert.ok(target, `"${type}" con datos completos debería resolver a un destino, no null`);
    assert.equal(
      target.screen,
      EXPECTED_SCREEN_BY_TYPE[type],
      `"${type}" debería ir a la pantalla "${EXPECTED_SCREEN_BY_TYPE[type]}"`
    );
  }
});

test('resolveNotificationTarget: no queda ningún tipo de NOTIF_TYPE_TO_PREFERENCE sin destino esperado en la prueba', () => {
  const knownTypes = Object.keys(NOTIF_TYPE_TO_PREFERENCE);
  const testedTypes = Object.keys(EXPECTED_SCREEN_BY_TYPE);
  assert.deepEqual(
    [...knownTypes].sort(),
    [...testedTypes].sort(),
    'esta prueba debe cubrir exactamente los mismos tipos que notificationPreferences.js — si se agrega un tipo ahí, hay que agregarlo aquí también'
  );
});

test('resolveNotificationTarget: un tipo desconocido no inventa un destino', () => {
  assert.equal(resolveNotificationTarget({ type: 'tipo_que_no_existe', data: {} }), null);
});

test('resolveNotificationTarget: sin objeto de notificación no rompe, devuelve null', () => {
  assert.equal(resolveNotificationTarget(null), null);
  assert.equal(resolveNotificationTarget(undefined), null);
});

test('resolveNotificationTarget: match_join sin matchId no navega a ciegas', () => {
  assert.equal(resolveNotificationTarget({ type: 'match_join', data: {} }), null);
});

test('resolveNotificationTarget: club_request sin clubId no navega a ciegas', () => {
  assert.equal(resolveNotificationTarget({ type: 'club_request', data: {} }), null);
});

test('resolveNotificationTarget: message_new sin threadKey (aviso viejo) no navega a ciegas', () => {
  assert.equal(resolveNotificationTarget({ type: 'message_new', data: {} }), null);
});

test('resolveNotificationTarget: friend_request sin fromUserId no navega a ciegas', () => {
  assert.equal(resolveNotificationTarget({ type: 'friend_request', data: {} }), null);
});

test('resolveNotificationTarget: message_new acepta threadId como alias legacy de threadKey', () => {
  const target = resolveNotificationTarget({ type: 'message_new', data: { threadId: 'dm:u1' } });
  assert.deepEqual(target, { screen: 'ChatThread', params: { threadKey: 'dm:u1' } });
});

test('resolveNotificationTarget: join_request lleva al organizador a la pestaña de solicitudes, no al detalle público', () => {
  const target = resolveNotificationTarget({ type: 'join_request', data: { matchId: 'm1' } });
  assert.deepEqual(target, { screen: 'ManageMatch', params: { matchId: 'm1', tab: 'solicitudes' } });
});

test('resolveNotificationTarget: club_challenge (recibido) usa clubRetadoId, no clubRetadorId', () => {
  const target = resolveNotificationTarget({
    type: 'club_challenge',
    data: { clubRetadoId: 'yo', clubRetadorId: 'otro' },
  });
  assert.equal(target.params.clubId, 'yo');
});

test('resolveNotificationTarget: club_challenge_accepted (respondido) usa clubRetadorId, no clubRetadoId', () => {
  const target = resolveNotificationTarget({
    type: 'club_challenge_accepted',
    data: { clubRetadorId: 'yo', clubRetadoId: 'otro' },
  });
  assert.equal(target.params.clubId, 'yo');
});

test('resolveNotificationTarget: los destinos de club llevan `resource` para verificar que el club siga existiendo', () => {
  const target = resolveNotificationTarget({ type: 'club_request', data: { clubId: 'c1' } });
  assert.deepEqual(target.resource, { kind: 'club', id: 'c1' });
});

test('resolveNotificationTarget: los destinos de partido NO llevan `resource` (la propia pantalla ya maneja "no existe")', () => {
  const target = resolveNotificationTarget({ type: 'match_join', data: { matchId: 'm1' } });
  assert.equal(target.resource, undefined);
});

// ---------------------------------------------------------------------------
// verifyTargetExists — confirma o descarta el recurso antes de navegar
// ---------------------------------------------------------------------------

test('verifyTargetExists: un destino sin `resource` se asume válido sin llamar a nada', async () => {
  let called = false;
  const result = await verifyTargetExists(
    { screen: 'Main', params: {} },
    { getMatchById: async () => { called = true; }, getClubById: async () => { called = true; } }
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(called, false);
});

test('verifyTargetExists: partido que existe → ok', async () => {
  const result = await verifyTargetExists(
    { resource: { kind: 'match', id: 'm1' } },
    { getMatchById: async () => ({ data: { id: 'm1' } }) }
  );
  assert.equal(result.ok, true);
});

test('verifyTargetExists: partido que ya no existe → not ok, con copy de "partido no existe"', async () => {
  const result = await verifyTargetExists(
    { resource: { kind: 'match', id: 'm1' } },
    { getMatchById: async () => ({ data: null }) }
  );
  assert.equal(result.ok, false);
  assert.match(result.copy.title, /partido/i);
});

test('verifyTargetExists: club que existe → ok', async () => {
  const result = await verifyTargetExists(
    { resource: { kind: 'club', id: 'c1' } },
    { getClubById: async () => ({ data: { id: 'c1' } }) }
  );
  assert.equal(result.ok, true);
});

test('verifyTargetExists: club que ya no existe → not ok, con copy de "club no existe"', async () => {
  const result = await verifyTargetExists(
    { resource: { kind: 'club', id: 'c1' } },
    { getClubById: async () => ({ data: null }) }
  );
  assert.equal(result.ok, false);
  assert.match(result.copy.title, /club/i);
});

test('verifyTargetExists: un error de red al verificar falla abierto (deja navegar)', async () => {
  const result = await verifyTargetExists(
    { resource: { kind: 'match', id: 'm1' } },
    { getMatchById: async () => { throw new Error('sin conexión'); } }
  );
  assert.deepEqual(result, { ok: true });
});

// ---------------------------------------------------------------------------
// navigateToNotification — el flujo completo, con los callbacks que usan
// App.js (push) y NotificationsScreen.js (tap dentro de la app)
// ---------------------------------------------------------------------------

test('navigateToNotification: tipo desconocido → onUnresolved, nunca navega', async () => {
  let navigated = false;
  let unresolved = null;
  const ok = await navigateToNotification(
    { type: 'tipo_raro', data: {} },
    {
      navigate: () => { navigated = true; },
      onUnresolved: (copy) => { unresolved = copy; },
      onMissing: () => {},
    }
  );
  assert.equal(ok, false);
  assert.equal(navigated, false);
  assert.deepEqual(unresolved, UNRESOLVED_NOTIFICATION_COPY);
});

test('navigateToNotification: recurso ya no existe → onMissing, nunca navega', async () => {
  let navigated = false;
  let missing = null;
  const ok = await navigateToNotification(
    { type: 'club_request', data: { clubId: 'c1' } },
    {
      navigate: () => { navigated = true; },
      onMissing: (copy) => { missing = copy; },
      onUnresolved: () => {},
      getClubById: async () => ({ data: null }),
    }
  );
  assert.equal(ok, false);
  assert.equal(navigated, false);
  assert.ok(missing);
});

test('navigateToNotification: destino resuelto y recurso vigente → navega con los params correctos', async () => {
  let navigatedTo = null;
  const ok = await navigateToNotification(
    { type: 'club_request', data: { clubId: 'c1' } },
    {
      navigate: (screen, params) => { navigatedTo = { screen, params }; },
      onMissing: () => {},
      onUnresolved: () => {},
      getClubById: async () => ({ data: { id: 'c1' } }),
    }
  );
  assert.equal(ok, true);
  assert.deepEqual(navigatedTo, { screen: 'ClubDetail', params: { clubId: 'c1' } });
});

test('navigateToNotification: destino sin `resource` navega directo, sin necesitar getMatchById/getClubById', async () => {
  let navigatedTo = null;
  const ok = await navigateToNotification(
    { type: 'match_cancelled', data: {} },
    {
      navigate: (screen, params) => { navigatedTo = { screen, params }; },
      onMissing: () => {},
      onUnresolved: () => {},
    }
  );
  assert.equal(ok, true);
  assert.deepEqual(navigatedTo, { screen: 'Main', params: { screen: 'SearchTab' } });
});

// ════════════════════════════════════════════════════════════════
// CTA «IR AHORA»: el aviso de desafío aceptado abre el hilo grupal
// ════════════════════════════════════════════════════════════════
// Desde la migración 42, `aceptar_desafio()` mete `threadKey` en el
// `data` del aviso. Las dos ramas importan: los avisos viejos (los que
// escribió el trigger anterior) no lo traen y tienen que seguir yendo
// a donde iban, o un usuario con la bandeja llena se queda sin destino.

test('resolveNotificationTarget: con threadKey, el desafío aceptado abre la conversación', () => {
  assert.deepEqual(
    resolveNotificationTarget({
      type: 'club_challenge_accepted',
      data: {
        challengeId: 'ch-1',
        clubRetadorId: 'c1',
        clubRetadoId: 'c2',
        threadKey: 'challenge:ch-1',
      },
    }),
    { screen: 'ChatThread', params: { threadKey: 'challenge:ch-1' } }
  );
});

test('resolveNotificationTarget: sin threadKey (aviso anterior a la migración 42) conserva el destino de siempre', () => {
  assert.deepEqual(
    resolveNotificationTarget({
      type: 'club_challenge_accepted',
      data: { challengeId: 'ch-1', clubRetadorId: 'c1', clubRetadoId: 'c2' },
    }),
    {
      screen: 'ClubChallenges',
      params: { clubId: 'c1' },
      resource: { kind: 'club', id: 'c1' },
    }
  );
});

// Migración 43: los cuatro avisos del ciclo formal. Los tres que nacen
// dentro de la negociación siempre traen `threadKey`; el de expiración
// no, porque un desafío que nadie aceptó nunca llegó a tener hilo.
for (const type of [
  'club_challenge_extension',
  'club_challenge_proposal',
  'club_challenge_proposal_rejected',
  'club_challenge_closed',
]) {
  test(`resolveNotificationTarget: ${type} con threadKey abre el hilo de negociación`, () => {
    assert.deepEqual(
      resolveNotificationTarget({
        type,
        data: {
          challengeId: 'ch-9',
          clubRetadorId: 'c1',
          clubRetadoId: 'c2',
          threadKey: 'challenge:ch-9',
        },
      }),
      { screen: 'ChatThread', params: { threadKey: 'challenge:ch-9' } }
    );
  });
}

test('resolveNotificationTarget: el desafío que expiró sin hilo lleva a la bandeja del retador', () => {
  assert.deepEqual(
    resolveNotificationTarget({
      type: 'club_challenge_closed',
      data: { challengeId: 'ch-9', clubRetadorId: 'c1', clubRetadoId: 'c2' },
    }),
    {
      screen: 'ClubChallenges',
      params: { clubId: 'c1' },
      resource: { kind: 'club', id: 'c1' },
    }
  );
});

test('resolveNotificationTarget: el desafío rechazado no tiene hilo y sigue yendo a la bandeja', () => {
  const target = resolveNotificationTarget({
    type: 'club_challenge_rejected',
    data: { clubRetadorId: 'c1', clubRetadoId: 'c2' },
  });
  assert.equal(target.screen, 'ClubChallenges');
});

test('resolveNotificationTarget: el destino del hilo no necesita verificar el club', () => {
  // Va a una conversación, y ChatThreadScreen ya sabe decir «este desafío
  // ya no existe» por su cuenta (getThreadAccess). Pedir además el club
  // sería una consulta de más antes de navegar.
  const target = resolveNotificationTarget({
    type: 'club_challenge_accepted',
    data: { threadKey: 'challenge:ch-1', clubRetadorId: 'c1' },
  });
  assert.equal(target.resource, undefined);
});

// La reserva omitida (migración 45) le llega SÓLO a quien pidió el cupo y no
// lo obtuvo. Sin `matchId` no hay adónde ir, y un destino inventado sería peor
// que ninguno.
test('club_match_reserva_omitida sin matchId no resuelve a ninguna pantalla', () => {
  assert.equal(resolveNotificationTarget({ type: 'club_match_reserva_omitida', data: {} }), null);
});

test('club_match_reserva_omitida verifica que el partido siga existiendo', () => {
  const t = resolveNotificationTarget({
    type: 'club_match_reserva_omitida',
    data: { matchId: 'm1' },
  });
  assert.deepEqual(t.resource, { kind: 'match', id: 'm1' });
});
