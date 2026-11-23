/**
 * «Publicar partido»: cada confirmado tiene que decir quién es —la cuenta de
 * un amigo o un nombre—, nunca «Reservado» ni un nombre genérico
 * (pedido de Vicente, 2026-11-18; migración 187).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  NOMBRES_GENERICOS,
  asientosIniciales,
  asientosSinIdentificar,
  errorDeNombre,
  esNombreGenerico,
  limpiarNombre,
  payloadDeAsientos,
  traducirErrorDeAsiento,
  validarArmado,
  validarIdentificados,
} = require('../asientos.js');
const { FIELD_ORDER } = require('../../services/matchRules.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const amigo = (id) => ({ tipo: 'amigo', user_id: id, username: id });
const nombre = (n) => ({ tipo: 'nombre', nombre: n });
const reservado = { tipo: 'reservado' };

test('8 confirmados «Reservado» no se publican, y se sabe cuáles faltan', () => {
  const ocho = Array.from({ length: 8 }, () => reservado);
  assert.deepEqual(asientosSinIdentificar(ocho), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(
    validarIdentificados(ocho),
    'Faltan 8 jugadores confirmados por identificar: elige a un amigo o escribe su nombre. ' +
      'Si todavía no sabes quiénes son, súmalos en «¿Cuántos te faltan?».'
  );
});

test('con cuenta o nombre en cada uno, sí se publica', () => {
  const ok = [amigo('u1'), nombre('Tomás'), nombre('Álvaro')];
  assert.deepEqual(asientosSinIdentificar(ok), []);
  assert.equal(validarIdentificados(ok), null);
  assert.equal(validarIdentificados([]), null, 'vas solo: no hay a quién identificar');
});

test('basta uno sin identificar, y se marca justo ése', () => {
  const lista = [nombre('Tomás'), reservado, amigo('u1'), { tipo: 'amigo' }, nombre('  ')];
  assert.deepEqual(asientosSinIdentificar(lista), [1, 3, 4]);
  assert.match(validarIdentificados([nombre('Tomás'), reservado]), /^Falta identificar a 1 jugador confirmado/);
});

test('sin nombres (bandera vencida) el mensaje sólo pide amigos', () => {
  const m = validarIdentificados([reservado], { nombres: false });
  assert.match(m, /elige a un amigo\./);
  assert.doesNotMatch(m, /nombre/);
});

test('el borrador con que abre el formulario NO se puede publicar tal cual', () => {
  // 14 y falta 1 = 12 confirmados que hay que identificar en el último paso.
  assert.equal(asientosSinIdentificar(asientosIniciales()).length, 12);
  assert.equal(validarArmado(14, asientosIniciales()), null, 'pero el paso 1 sí deja seguir');
});

test('los nombres genéricos no identifican a nadie', () => {
  for (const n of [
    'Jugador reservado',
    'Asiento reservado',
    'RESERVADO',
    'Jugador 3',
    '  jugador-reservado. ',
    'Cupo libre',
    'Invitado',
    'X',
    '1',
    '...',
    'Sin nombre',
  ]) {
    assert.equal(esNombreGenerico(n), true, n);
    assert.equal(limpiarNombre(n), null, n);
  }
  for (const n of ['Tomás', 'Álvaro', 'Ñandú', 'Jo', 'Tomás Pérez', 'Juan Jugador']) {
    assert.equal(esNombreGenerico(n), false, n);
    assert.equal(limpiarNombre(n), n, n);
  }
});

test('el campo de nombre explica por qué no sirve', () => {
  assert.equal(errorDeNombre('Tomás'), null);
  assert.equal(errorDeNombre('   '), 'Escribe un nombre de hasta 40 letras');
  assert.equal(errorDeNombre('Jugador reservado'), 'Escribe el nombre de la persona, por ejemplo «Tomás» o «Álvaro»');
  assert.equal(validarArmado(10, [nombre('Jugador')]), 'Escribe el nombre de la persona, por ejemplo «Tomás» o «Álvaro»');
});

test('lo que se manda al servidor lleva el nombre limpio', () => {
  assert.deepEqual(payloadDeAsientos([nombre('  Tomás   Pérez ')]), [{ tipo: 'nombre', nombre: 'Tomás Pérez' }]);
});

test('los errores nuevos del servidor se traducen', () => {
  assert.equal(
    traducirErrorDeAsiento({ message: 'ASIENTO_SIN_IDENTIFICAR' }),
    'Cada jugador confirmado tiene que tener una cuenta o un nombre.'
  );
  assert.match(traducirErrorDeAsiento({ message: 'ASIENTO_NOMBRE_GENERICO' }), /Tomás/);
});

test('la base rechaza exactamente los mismos nombres genéricos', () => {
  const sql = leer('supabase/migrations/187_los_confirmados_tienen_nombre.sql');
  const bloque = sql.match(/clave = any \(array\[([\s\S]*?)\]\)/);
  assert.ok(bloque, 'la 187 define la lista en _asiento_nombre_generico');
  const enLaBase = [...bloque[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(enLaBase, [...NOMBRES_GENERICOS].sort());
});

test('la pantalla bloquea publicar en el último paso y marca las filas', () => {
  const pantalla = leer('src/screens/PublishMatchScreen.js');
  assert.match(pantalla, /validarIdentificados\(d\.asientos/);
  assert.match(pantalla, /s === 3/);
  assert.match(pantalla, /f === 'asientos'\s*\?\s*3/, 'un error de asientos lleva al paso 3');
  assert.match(pantalla, /falta: true/);
  assert.ok(FIELD_ORDER.includes('asientos'), 'el error de asientos cuenta para el scroll');
  assert.match(leer('src/components/partidos/ListaDeAsientos.js'), /a\.falta/);
});
