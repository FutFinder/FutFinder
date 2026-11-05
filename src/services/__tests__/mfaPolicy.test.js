/**
 * Política de la verificación en dos pasos (TOTP).
 *
 * Lo que importa fijar: una sesión que entró sólo con la contraseña de alguien
 * que activó el segundo paso NO cuenta como acceso; una sesión de alguien que
 * no lo activó, sí (la verificación es opcional para la gente común); y un
 * token ilegible no deja a nadie fuera de su cuenta.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MFA_MENSAJES,
  describeMfaError,
  necesitaSegundoPaso,
  nivelDesdeSesion,
  normalizarCodigo,
  codigoCompleto,
  factoresVerificados,
  claveEnGrupos,
  xmlDelQr,
} = require('../mfaPolicy.js');

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.firma`;
const sesion = ({ aal, factores = [] } = {}) => ({
  access_token: jwt({ sub: 'u1', aal }),
  user: { id: 'u1', factors: factores },
});

test('sin segundo paso activado, la sesión de contraseña alcanza', () => {
  const nivel = nivelDesdeSesion(sesion({ aal: 'aal1' }));
  assert.deepEqual(nivel, { currentLevel: 'aal1', nextLevel: 'aal1' });
  assert.equal(necesitaSegundoPaso(nivel), false);
});

test('con segundo paso activado, una sesión aal1 todavía debe el código', () => {
  const nivel = nivelDesdeSesion(sesion({ aal: 'aal1', factores: [{ id: 'f', status: 'verified', factor_type: 'totp' }] }));
  assert.deepEqual(nivel, { currentLevel: 'aal1', nextLevel: 'aal2' });
  assert.equal(necesitaSegundoPaso(nivel), true);
});

test('con segundo paso activado y el código ya presentado (aal2), pasa', () => {
  const nivel = nivelDesdeSesion(sesion({ aal: 'aal2', factores: [{ id: 'f', status: 'verified', factor_type: 'totp' }] }));
  assert.equal(necesitaSegundoPaso(nivel), false);
});

test('un factor a medias (sin verificar) no obliga a nada', () => {
  const nivel = nivelDesdeSesion(sesion({ aal: 'aal1', factores: [{ id: 'f', status: 'unverified', factor_type: 'totp' }] }));
  assert.equal(necesitaSegundoPaso(nivel), false);
});

test('un token ilegible o ausente no deja a nadie fuera', () => {
  assert.equal(nivelDesdeSesion(null), null);
  assert.equal(nivelDesdeSesion({ access_token: 'basura', user: {} }), null);
  assert.equal(nivelDesdeSesion({ access_token: 'a.b.c', user: {} }), null);
  assert.equal(necesitaSegundoPaso(null), false);
  assert.equal(necesitaSegundoPaso(undefined), false);
  assert.equal(necesitaSegundoPaso('aal2'), false);
});

test('el código se limpia a lo que de verdad se puede pegar', () => {
  assert.equal(normalizarCodigo('123 456'), '123456');
  assert.equal(normalizarCodigo('123-456'), '123456');
  assert.equal(normalizarCodigo('12345678'), '123456');
  assert.equal(normalizarCodigo(null), '');
  assert.equal(codigoCompleto('123456'), true);
  assert.equal(codigoCompleto('12345'), false);
  assert.equal(codigoCompleto('12345a'), false);
});

test('los errores del servidor se traducen, y el código vencido no se llama «incorrecto»', () => {
  assert.equal(describeMfaError(null), null);
  assert.equal(describeMfaError({ code: 'mfa_verification_failed' }), MFA_MENSAJES.codigoIncorrecto);
  assert.equal(describeMfaError({ code: 'mfa_challenge_expired' }), MFA_MENSAJES.codigoVencido);
  assert.equal(describeMfaError({ message: 'Invalid TOTP code entered' }), MFA_MENSAJES.codigoIncorrecto);
  assert.equal(describeMfaError({ status: 429, message: 'x' }), MFA_MENSAJES.demasiados);
  assert.equal(describeMfaError({ name: 'AuthRetryableFetchError', message: 'x' }), MFA_MENSAJES.sinConexion);
  assert.equal(describeMfaError({ message: 'algo raro' }), MFA_MENSAJES.inesperado);
});

test('los textos están en español de Chile y nunca filtran el mensaje en inglés del servidor', () => {
  for (const texto of Object.values(MFA_MENSAJES)) {
    assert.doesNotMatch(texto, /invalid|failed|error:/i);
  }
  assert.doesNotMatch(describeMfaError({ message: 'Internal Server Error' }), /Internal/);
});

test('sólo cuentan los factores TOTP verificados', () => {
  const f = [
    { id: 'a', status: 'verified', factor_type: 'totp' },
    { id: 'b', status: 'unverified', factor_type: 'totp' },
    { id: 'c', status: 'verified', factor_type: 'phone' },
  ];
  assert.deepEqual(factoresVerificados(f).map((x) => x.id), ['a']);
  assert.deepEqual(factoresVerificados(undefined), []);
});

test('la clave se muestra en grupos de cuatro', () => {
  assert.equal(claveEnGrupos('ABCDEFGHIJKLMNOP'), 'ABCD EFGH IJKL MNOP');
  assert.equal(claveEnGrupos('ABCDEFGHIJ'), 'ABCD EFGH IJ');
});

test('el QR de data URI se convierte en XML', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
  assert.equal(xmlDelQr(`data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`), svg);
  assert.equal(xmlDelQr('otra cosa'), null);
});
