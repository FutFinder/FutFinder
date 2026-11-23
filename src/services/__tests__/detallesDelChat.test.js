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

// ---------------------------------------------------------------------------
// C14: el hilo `challenge:<id>` caía en el subtítulo por omisión «Mensaje
// directo», aunque es un grupo entre los dos clubes del desafío.
// ---------------------------------------------------------------------------

const { subtituloDeDetalles } = require('../../utils/chatMeta.js');

test('C14: el hilo de un desafío se presenta como desafío entre clubes', () => {
  assert.equal(subtituloDeDetalles({ tipo: 'challenge', cuantos: 4 }), 'Desafío entre clubes · 4 participantes');
  assert.equal(subtituloDeDetalles({ tipo: 'challenge', cuantos: 1 }), 'Desafío entre clubes · 1 participante');
});

test('C14: los demás siguen igual', () => {
  assert.equal(subtituloDeDetalles({ tipo: 'club', cuantos: 12 }), 'Chat del club · 12 jugadores');
  assert.equal(subtituloDeDetalles({ tipo: 'match', cuantos: 1 }), 'Chat del partido · 1 inscrito');
  assert.equal(subtituloDeDetalles({ tipo: 'dm', cuantos: 2 }), 'Mensaje directo');
});

test('C14: la pantalla usa subtituloDeDetalles', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'ChatDetailsScreen.js'), 'utf8');
  assert.match(src, /subtituloDeDetalles\(\{/);
});

// ---------------------------------------------------------------------------
// C15: si getThreadParticipants devolvía { data: [], error }, Detalles
// ignoraba el error y anunciaba «0 jugadores»: el chat parecía vacío.
// ---------------------------------------------------------------------------

test('C15: con error el subtítulo no afirma cuántos hay', () => {
  for (const tipo of ['club', 'match', 'challenge']) {
    const s = subtituloDeDetalles({ tipo, cuantos: 0, error: true });
    assert.ok(!/\b0\b/.test(s), `${tipo}: vuelve a decir 0 con un error`);
    assert.match(s, /No pudimos cargar los participantes/);
  }
});

test('C15: la pantalla guarda el error de participantes y ofrece reintentar', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'ChatDetailsScreen.js'), 'utf8');
  assert.match(src, /setErrorParticipantes\(people\.error \|\| null\)/, 'el error de la consulta se vuelve a ignorar');
  assert.match(src, /subtituloDeDetalles\(\{[^}]*error: !!errorParticipantes/);
  assert.match(src, /Reintentar/);
});
