/**
 * La bandeja de Chats (ChatScreen), pendientes C11 y C16 de la lista de
 * calidad del 2026-09-23.
 *
 *   C11  La bandeja carga al montar, al volver el foco, al refrescar y con
 *        cada señal de Realtime, sin turno: una respuesta vieja que llegaba
 *        tarde pisaba la lista nueva.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'ChatScreen.js'), 'utf8');

function cuerpoDeLoad() {
  const ini = SRC.indexOf('const load = useCallback(async');
  assert.ok(ini > 0, 'no se encontró load');
  return SRC.slice(ini, SRC.indexOf('\n  }, [', ini));
}

test('C11: cada carga pide turno y una vieja no escribe la lista', () => {
  const load = cuerpoDeLoad();
  assert.match(load, /const turno = secuencia\.abrir\(\);/);
  const esperas = (load.match(/await /g) || []).length;
  const chequeos = (load.match(/if \(!mountedRef\.current \|\| !secuencia\.vigente\(turno\)\) return;/g) || []).length;
  assert.ok(esperas >= 1);
  assert.equal(chequeos, esperas, 'hay una espera en load sin chequeo de turno después');
});

// ---------------------------------------------------------------------------
// C16: si fallaba `listIncomingRequests`, la bandeja ponía `requests = []` y
// la tarjeta de solicitudes desaparecía con su contador, como si no hubiera
// ninguna. Un fallo conserva lo último que se supo.
// ---------------------------------------------------------------------------

const { solicitudesTrasCargar } = require('../../utils/chatMeta.js');

test('C16: un fallo de las solicitudes conserva las que ya se mostraban', () => {
  const previas = [{ id: 'f1' }, { id: 'f2' }];
  assert.deepEqual(solicitudesTrasCargar(previas, { data: null, error: { message: 'red' } }), previas);
});

test('C16: sin error, manda lo que llegó (también una lista vacía de verdad)', () => {
  assert.deepEqual(solicitudesTrasCargar([{ id: 'f1' }], { data: [], error: null }), []);
  assert.deepEqual(solicitudesTrasCargar([], { data: [{ id: 'f3' }], error: null }), [{ id: 'f3' }]);
});

test('C16: la bandeja ya no convierte el error en una lista vacía', () => {
  const load = cuerpoDeLoad();
  assert.ok(!/catch\(\(\) => \(\{ data: \[\], error: null \}\)\)/.test(load), 'el error vuelve a disfrazarse de «sin solicitudes»');
  assert.match(load, /setRequests\(\(previas\) => solicitudesTrasCargar\(previas, reqsRes\)\)/);
});
