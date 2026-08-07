/**
 * Pruebas de describeFriendRequestError(): que un bloqueo por privacidad
 * (violación de la política RLS de `friendships`, migración 35) se
 * traduzca en un mensaje comprensible, y que otros errores no se
 * confundan con un bloqueo de privacidad.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { describeFriendRequestError, PRIVACY_BLOCKED_MESSAGE } = require('../friendRequestPrivacy.js');

test('sin error, no hay nada que describir (solicitud permitida)', () => {
  assert.equal(describeFriendRequestError(null), null);
  assert.equal(describeFriendRequestError(undefined), null);
});

test('una violación de row-level security (código 42501) se marca como bloqueo de privacidad', () => {
  const d = describeFriendRequestError({
    code: '42501',
    message: 'new row violates row-level security policy for table "friendships"',
  });
  assert.equal(d.blockedByPrivacy, true);
  assert.equal(d.message, PRIVACY_BLOCKED_MESSAGE);
});

test('un mensaje de RLS sin el código también se reconoce como bloqueo de privacidad', () => {
  const d = describeFriendRequestError({
    message: 'new row violates row-level security policy for table "friendships"',
  });
  assert.equal(d.blockedByPrivacy, true);
  assert.equal(d.message, PRIVACY_BLOCKED_MESSAGE);
});

test('otros errores de base de datos no se camuflan como bloqueo de privacidad', () => {
  const d = describeFriendRequestError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "friendships_unique_pair"',
  });
  assert.equal(d.blockedByPrivacy, false);
  assert.equal(d.message, 'duplicate key value violates unique constraint "friendships_unique_pair"');
});

test('un error sin mensaje cae a un texto genérico, no a undefined', () => {
  const d = describeFriendRequestError({ code: '500' });
  assert.equal(d.blockedByPrivacy, false);
  assert.equal(d.message, 'No se pudo enviar la solicitud.');
});
