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
