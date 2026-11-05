/**
 * Detalles del chat (ChatDetailsScreen y getThreadParticipants), pendientes
 * C13, C14 y C15 de la lista de calidad del 2026-09-23.
 *
 *   C13  En un chat de partido se listaban como «inscritos» todos los que no
 *        estaban `cancelado`, incluidos los `pendiente` (solicitud manual no
 *        aceptada), que el propio chat deja fuera.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const R = require('../matchRules.js');

test('C13: una solicitud pendiente no cuenta como participante del chat', () => {
  assert.equal(R.participaEnElChatDelPartido('pendiente'), false);
  assert.equal(R.participaEnElChatDelPartido('cancelado'), false);
  assert.equal(R.participaEnElChatDelPartido('inscrito'), true);
  assert.equal(R.participaEnElChatDelPartido('confirmado_gps'), true);
});

test('C13: es la misma regla que abre el chat, no una copia', () => {
  for (const estado of ['pendiente', 'cancelado', 'inscrito', 'confirmado_gps', 'no_asistio']) {
    assert.equal(
      R.participaEnElChatDelPartido(estado),
      R.accesoAlChatDelPartido({ estado }, null).canRead,
      `difieren para ${estado}`
    );
  }
});

test('C13: getThreadParticipants filtra los del partido con esa regla', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'messages.js'), 'utf8');
  const ini = src.indexOf("if (t.type === 'match') {", src.indexOf('export async function getThreadParticipants'));
  const bloque = src.slice(ini, src.indexOf("if (t.type === 'challenge')", ini));
  assert.match(bloque, /participaEnElChatDelPartido\(a\.estado\)/, 'los pendientes vuelven a contarse como inscritos');
});
