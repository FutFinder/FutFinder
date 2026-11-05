/**
 * I04 y I02 de los pendientes de calidad (2026-09-23), los dos en la carga
 * de Inicio.
 *
 *   I04  `load()` corre al enfocar, al refrescar y después de inscribirse, y
 *        nada descartaba una respuesta vieja: si la primera llegaba
 *        después, pisaba la lista nueva.
 *   I02  Si `listOpenMatches` fallaba, Inicio tiraba el `error` y mostraba
 *        «Sin partidos en tu radio»: sin red parecía que no había partidos.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.js'), 'utf8');

function cuerpoDeLoad() {
  const ini = SRC.indexOf('const load = useCallback(async () => {');
  assert.ok(ini > 0, 'no se encontró load');
  return SRC.slice(ini, SRC.indexOf('\n  }, [', ini));
}

test('I04: cada carga pide turno y una vieja no escribe', () => {
  const load = cuerpoDeLoad();
  assert.match(load, /const turno = secuenciaCarga\.abrir\(\);/);
  // Después de cada espera, antes de escribir estado, se mira el turno.
  const esperas = (load.match(/await /g) || []).length;
  const chequeos = (load.match(/if \(!secuenciaCarga\.vigente\(turno\)\) return;/g) || []).length;
  assert.ok(esperas >= 3, 'cambió la forma de load: revisa esta prueba');
  assert.equal(chequeos, esperas, 'hay una espera en load sin chequeo de turno después');
});

// ---------------------------------------------------------------------------
// I02 — un fallo no es «sin partidos»
// ---------------------------------------------------------------------------

const { vistaDePartidosCerca } = require('../../utils/clubsHomeSources.js');

test('I02: con error y sin nada cargado, la vista es de error, no de vacío', () => {
  assert.equal(vistaDePartidosCerca({ cuantos: 0, error: { message: 'red' } }), 'error');
  assert.equal(vistaDePartidosCerca({ cuantos: 0, error: null }), 'vacio');
});

test('I02: con error y datos previos, se conservan y se avisa', () => {
  assert.equal(vistaDePartidosCerca({ cuantos: 3, error: { message: 'red' } }), 'lista-con-error');
  assert.equal(vistaDePartidosCerca({ cuantos: 3, error: null }), 'lista');
});

test('I02: Inicio lee el error de listOpenMatches y no pisa la lista con él', () => {
  const load = cuerpoDeLoad();
  assert.match(load, /const \{ data: list, error: errorLista \} = await listOpenMatches\(/);
  assert.match(SRC, /vistaDePartidosCerca\(/);
  assert.match(SRC, /No pudimos cargar los partidos/);
});
