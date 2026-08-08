/**
 * Pruebas de la lógica pura que decide si un push externo se envía o se
 * omite según las preferencias notif_matches / notif_clubs / notif_chat /
 * notif_friends del destinatario. La misma decisión se replica en
 * `supabase/functions/send-push/index.ts` (ver comentario de espejo ahí).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NOTIF_TYPE_TO_PREFERENCE,
  getPreferenceColumn,
  isPushAllowed,
} = require('../notificationPreferences.js');

const CATEGORIES = {
  notif_matches: [
    'match_join',
    'match_reminder',
    'match_rate',
    'join_request',
    'join_approved',
    'join_rejected',
    'match_cancelled',
    'match_updated',
    'match_slot_free',
    'waitlist_turn',
    'match_left',
    'match_attendance',
  ],
  notif_clubs: [
    'club_request',
    'club_request_accepted',
    'club_request_rejected',
    'club_member_joined',
    'club_member_left',
    'club_invite_accepted',
    'club_challenge',
    'club_challenge_accepted',
    'club_challenge_rejected',
  ],
  notif_chat: ['message_new', 'chat_mention_all'],
  notif_friends: ['friend_request', 'friend_accept'],
};

test('cada tipo de notificación mapea a la preferencia correcta de su categoría', () => {
  for (const [column, types] of Object.entries(CATEGORIES)) {
    for (const type of types) {
      assert.equal(getPreferenceColumn(type), column, `${type} debería mapear a ${column}`);
    }
  }
});

test('el mapeo no deja tipos huérfanos fuera de las cuatro categorías conocidas', () => {
  const knownColumns = new Set(Object.keys(CATEGORIES));
  for (const column of Object.values(NOTIF_TYPE_TO_PREFERENCE)) {
    assert.ok(knownColumns.has(column), `columna desconocida: ${column}`);
  }
});

test('un tipo sin mapear nunca bloquea el push (falla abierto)', () => {
  assert.equal(getPreferenceColumn('tipo_inexistente'), null);
  assert.equal(isPushAllowed({ notif_matches: false }, 'tipo_inexistente'), true);
});

for (const [column, types] of Object.entries(CATEGORIES)) {
  test(`${column} activado (true): se envía el push para cada tipo de su categoría`, () => {
    const profile = { notif_matches: true, notif_clubs: true, notif_chat: true, notif_friends: true };
    for (const type of types) {
      assert.equal(isPushAllowed(profile, type), true, `${type} debería permitir push`);
    }
  });

  test(`${column} desactivado (false): se omite el push para cada tipo de su categoría`, () => {
    const profile = { notif_matches: true, notif_clubs: true, notif_chat: true, notif_friends: true, [column]: false };
    for (const type of types) {
      assert.equal(isPushAllowed(profile, type), false, `${type} debería omitir push`);
    }
  });

  test(`${column} desactivado no afecta a las demás categorías`, () => {
    const profile = { notif_matches: true, notif_clubs: true, notif_chat: true, notif_friends: true, [column]: false };
    for (const [otherColumn, otherTypes] of Object.entries(CATEGORIES)) {
      if (otherColumn === column) continue;
      for (const type of otherTypes) {
        assert.equal(isPushAllowed(profile, type), true, `${type} no debería verse afectado por ${column}=false`);
      }
    }
  });
}

test('un perfil sin la columna definida (undefined) deja pasar el push', () => {
  assert.equal(isPushAllowed({}, 'match_join'), true);
  assert.equal(isPushAllowed({ notif_matches: null }, 'match_join'), true);
});

test('sin perfil (destinatario no encontrado) deja pasar el push', () => {
  assert.equal(isPushAllowed(null, 'friend_request'), true);
  assert.equal(isPushAllowed(undefined, 'club_challenge'), true);
});
