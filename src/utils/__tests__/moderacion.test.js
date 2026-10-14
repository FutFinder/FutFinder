/**
 * Pruebas de la pantalla de moderación, en su parte sin red.
 *
 * LO QUE MÁS IMPORTA ACÁ, y por eso está en una función y no dentro del JSX:
 *
 *   · los reportes de usuario se MUESTRAN pero no se resuelven. Resolverlos
 *     exige decidir estados, medidas y apelación, que es diseño de producto
 *     y sigue abierto. Si alguien agrega un botón sin darse cuenta, esta
 *     prueba se pone roja y le explica por qué;
 *   · una cola vacía y una cola que no se pudo leer no son lo mismo. En una
 *     pantalla de sanciones sin resolver, confundirlas es grave.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../moderacion.js');

test('son tres colas y sólo dos se pueden resolver desde acá', () => {
  assert.equal(M.COLAS.length, 3);
  const reportes = M.COLAS.find((c) => c.clave === 'reportes_sin_mirar');
  assert.equal(reportes.accionable, false, 'los reportes NO se resuelven todavía');
  assert.ok(reportes.nota, 'y la pantalla tiene que decir por qué, no sólo no traer botones');
  for (const clave of ['revisiones_de_sancion', 'resultados_en_disputa']) {
    assert.equal(M.COLAS.find((c) => c.clave === clave).accionable, true);
  }
});

test('las tres claves son las que devuelve moderacion_cola()', () => {
  // Fijadas contra la migración 151. Un nombre mal escrito acá deja una cola
  // permanentemente vacía sin que falle nada.
  assert.deepEqual(M.COLAS.map((c) => c.clave).sort(), [
    'reportes_sin_mirar', 'resultados_en_disputa', 'revisiones_de_sancion',
  ]);
});

test('filasDe aguanta cualquier cosa que llegue', () => {
  assert.deepEqual(M.filasDe({ a: [1, 2] }, 'a'), [1, 2]);
  assert.deepEqual(M.filasDe({}, 'a'), []);
  assert.deepEqual(M.filasDe(null, 'a'), []);
  assert.deepEqual(M.filasDe(undefined, 'a'), []);
  assert.deepEqual(M.filasDe({ a: 'no es arreglo' }, 'a'), []);
  assert.deepEqual(M.filasDe({ a: null }, 'a'), []);
});

test('el total suma las tres colas', () => {
  assert.equal(M.totalPendiente({
    revisiones_de_sancion: [1],
    resultados_en_disputa: [1, 2],
    reportes_sin_mirar: [1, 2, 3],
  }), 6);
  assert.equal(M.totalPendiente({}), 0);
  assert.equal(M.totalPendiente(null), 0);
});

test('vacía y no-se-pudo-leer son estados distintos', () => {
  const clave = 'revisiones_de_sancion';
  assert.equal(M.estadoDeLaCola({ cargando: true, clave }), 'cargando');
  assert.equal(M.estadoDeLaCola({ error: new Error('x'), clave }), 'error');
  // `cola` nulo sin error explícito: tampoco se leyó. Mostrar «no hay nada»
  // aquí diría que no hay sanciones esperando cuando no se sabe.
  assert.equal(M.estadoDeLaCola({ cola: null, clave }), 'error');
  assert.equal(M.estadoDeLaCola({ cola: { [clave]: [] }, clave }), 'vacia');
  assert.equal(M.estadoDeLaCola({ cola: { [clave]: [{}] }, clave }), 'con-filas');
});

test('los motivos de reporte se leen en español', () => {
  assert.equal(M.motivoLegible('suplantacion'), 'Suplantación de identidad');
  assert.equal(M.motivoLegible('informacion_falsa'), 'Información falsa');
});

test('un motivo desconocido se muestra, no se esconde', () => {
  // En una cola de moderación, no enseñar algo es peor que enseñarlo feo.
  assert.equal(M.motivoLegible('algo_nuevo'), 'algo nuevo');
  assert.equal(M.motivoLegible(null), 'Sin motivo');
  assert.equal(M.motivoLegible(''), 'Sin motivo');
});

test('los tipos de sanción también', () => {
  assert.equal(M.tipoSancionLegible('incomparecencia'), 'Incomparecencia');
  assert.equal(M.tipoSancionLegible('cancelacion_tardia'), 'Cancelación tardía');
  assert.equal(M.tipoSancionLegible('loquesea'), 'loquesea');
  assert.equal(M.tipoSancionLegible(null), 'Sanción');
});

test('sólo «retirar» y «mantener» son decisiones válidas', () => {
  // Es lo que acepta `resolver_revision_sancion` desde la 47c. Comprobarlo
  // acá evita un viaje para recibir un `ok:false` que ya sabíamos.
  assert.equal(M.puedeResolver({ decision: 'retirar' }), true);
  assert.equal(M.puedeResolver({ decision: 'mantener' }), true);
  assert.equal(M.puedeResolver({ decision: 'anular' }), false);
  assert.equal(M.puedeResolver({ decision: 'Retirar' }), false);
  assert.equal(M.puedeResolver({}), false);
  assert.equal(M.puedeResolver(), false);
});

test('la nota tiene el mismo tope que el servidor', () => {
  assert.equal(M.NOTA_MAX, 1000);
  assert.equal(M.puedeResolver({ decision: 'retirar', nota: 'x'.repeat(1000) }), true);
  assert.equal(M.puedeResolver({ decision: 'retirar', nota: 'x'.repeat(1001) }), false);
});
