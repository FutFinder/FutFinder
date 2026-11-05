/**
 * Cuándo el chat da un hilo por leído (C01 y C02 de la auditoría de chats y
 * avisos del 2026-09-23).
 *
 *   C01  La carga inicial marcaba leído aunque la consulta de mensajes
 *        hubiera fallado: el remitente veía «leído» algo que nunca se mostró.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { cargaPermiteMarcarLeido } = require('../lecturaDeHilo.js');

const PANTALLA = fs.readFileSync(
  path.join(__dirname, '..', '..', 'screens', 'ChatThreadScreen.js'),
  'utf8'
);

// ---------------------------------------------------------------------------
// C01 — una carga fallida no marca leído
// ---------------------------------------------------------------------------

test('C01: una carga con error no autoriza a marcar leído', () => {
  assert.equal(
    cargaPermiteMarcarLeido({ data: [], hasMore: false, error: { message: 'red caída' } }),
    false
  );
  assert.equal(cargaPermiteMarcarLeido(null), false);
  assert.equal(cargaPermiteMarcarLeido(undefined), false);
});

test('C01: una carga buena sí, aunque el hilo esté vacío', () => {
  assert.equal(cargaPermiteMarcarLeido({ data: [{ id: 'm1' }], hasMore: false, error: null }), true);
  assert.equal(cargaPermiteMarcarLeido({ data: [], hasMore: false, error: null }), true);
});

test('C01: la carga inicial de la pantalla pasa por la regla antes de marcar', () => {
  // Bloque de la carga inicial: desde que pide la primera página hasta el
  // catch. Ahí no puede quedar un markThreadAsRead suelto.
  const ini = PANTALLA.indexOf('listThreadMessages(threadKey, { limit: PAGE_SIZE })');
  assert.ok(ini > 0, 'no se encontró la carga inicial del hilo');
  const fin = PANTALLA.indexOf("console.error('[FutFinder] ChatThread load:'", ini);
  assert.ok(fin > ini, 'no se encontró el final de la carga inicial');
  const bloque = PANTALLA.slice(ini, fin);
  assert.match(
    bloque,
    /if \(cargaPermiteMarcarLeido\(page\)\)\s*\{?\s*markThreadAsRead\(/,
    'la carga inicial vuelve a marcar leído sin mirar si los mensajes llegaron'
  );
  const sueltas = bloque.match(/markThreadAsRead\(/g) || [];
  assert.equal(sueltas.length, 1, 'hay más de una llamada a markThreadAsRead en la carga inicial');
});
