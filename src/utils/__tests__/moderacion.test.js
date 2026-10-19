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
const fs = require('node:fs');
const path = require('node:path');

const M = require('../moderacion.js');

const MIGRACIONES = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');

/**
 * Las claves que `moderacion_cola()` devuelve DE VERDAD, leídas de la última
 * migración que la declara.
 *
 * Antes estaban copiadas a mano en esta prueba, fijadas contra la 151: la
 * 164 agregó una cuarta cola y lo único que pasó fue que la prueba se puso
 * roja pidiendo que se actualizara el número. Leyéndolas de la migración,
 * una cola nueva en el servidor que nadie cableó en la app se delata sola,
 * que es el fallo que esta prueba vino a cazar. Mismo criterio que
 * `avisosCompletos`.
 */
function clavesDeLaCola() {
  const archivo = fs.readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => /create or replace function public\.moderacion_cola/
      .test(fs.readFileSync(path.join(MIGRACIONES, f), 'utf8')))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .pop();
  assert.ok(archivo, 'ninguna migración declara moderacion_cola()');

  const src = fs.readFileSync(path.join(MIGRACIONES, archivo), 'utf8');
  const cuerpo = src.slice(src.indexOf('jsonb_build_object'));
  // Las claves son los literales que abren cada par de `jsonb_build_object`
  // en la primera columna del return, siempre al principio de su línea.
  return [...cuerpo.matchAll(/^\s{4}'([a-z_]+)',/gm)].map((m) => m[1]).sort();
}

test('las claves de COLAS son las que devuelve moderacion_cola()', () => {
  // Un nombre mal escrito acá deja una cola permanentemente vacía sin que
  // falle nada, y una cola nueva en el servidor pasaría desapercibida.
  assert.deepEqual(M.COLAS.map((c) => c.clave).sort(), clavesDeLaCola());
});

test('los reportes se muestran y no se tocan; el resto sí se resuelve', () => {
  const reportes = M.COLAS.find((c) => c.clave === 'reportes_sin_mirar');
  assert.equal(reportes.accionable, false, 'los reportes NO se resuelven todavía');
  assert.ok(reportes.nota, 'y la pantalla tiene que decir por qué, no sólo no traer botones');
  for (const clave of ['revisiones_de_sancion', 'resultados_en_disputa', 'recintos_esperando']) {
    assert.equal(M.COLAS.find((c) => c.clave === clave).accionable, true);
  }
  // Toda cola tiene su texto de vacía: sin él, «no hay nada» se lee como
  // «no se pudo leer».
  for (const c of M.COLAS) assert.ok(c.vacio, `${c.clave} sin texto de cola vacía`);
});

test('la espera se cuenta en días de calendario y se lee en español', () => {
  // LAS FECHAS SE ARMAN EN HORA LOCAL, no con cadenas en Z. La cuenta es de
  // días de CALENDARIO —el de quien mira la pantalla— así que una cadena UTC
  // haría que esta prueba pasara en Santiago y fallara en otro huso, o al
  // revés. Con `new Date(a, m, d, h)` la intención no depende de dónde corra.
  const local = (a, m, d, h = 12) => new Date(a, m - 1, d, h, 0, 0);
  const ahora = local(2026, 10, 19, 12);

  assert.equal(M.diasEsperando(local(2026, 10, 19, 1), ahora), 0);
  assert.equal(M.esperaLegible(local(2026, 10, 19, 1), ahora), 'hoy');
  // Pedida ayer a las 23:00 y mirada hoy a las 09:00 es «ayer», aunque no
  // hayan pasado 24 horas.
  assert.equal(M.esperaLegible(local(2026, 10, 18, 23), local(2026, 10, 19, 9)), 'ayer');
  assert.equal(M.esperaLegible(local(2026, 9, 14, 13), ahora), 'hace 35 días');
  // También acepta la cadena ISO que llega de la base.
  assert.equal(M.diasEsperando(local(2026, 10, 18, 10).toISOString(), ahora), 1);
  // Nada de esto puede reventar con lo que llegue de la base.
  assert.equal(M.diasEsperando(null, ahora), null);
  assert.equal(M.esperaLegible(null, ahora), null);
  assert.equal(M.esperaLegible('no es fecha', ahora), null);
  // Un reloj atrasado no puede dar días negativos.
  assert.equal(M.diasEsperando(local(2026, 10, 25), ahora), 0);
});

test('filasDe aguanta cualquier cosa que llegue', () => {
  assert.deepEqual(M.filasDe({ a: [1, 2] }, 'a'), [1, 2]);
  assert.deepEqual(M.filasDe({}, 'a'), []);
  assert.deepEqual(M.filasDe(null, 'a'), []);
  assert.deepEqual(M.filasDe(undefined, 'a'), []);
  assert.deepEqual(M.filasDe({ a: 'no es arreglo' }, 'a'), []);
  assert.deepEqual(M.filasDe({ a: null }, 'a'), []);
});

test('el total suma todas las colas', () => {
  assert.equal(M.totalPendiente({
    revisiones_de_sancion: [1],
    resultados_en_disputa: [1, 2],
    reportes_sin_mirar: [1, 2, 3],
    recintos_esperando: [1, 2, 3, 4],
  }), 10);
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
