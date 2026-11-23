/**
 * «Publicar partido»: la modalidad Fútbol 5 (migración 183) y los valores
 * con que abre el formulario (14 jugadores, falta 1).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ARMADO_INICIAL,
  asientosIniciales,
  conFaltan,
  conTotal,
  conTotalYFaltan,
  libresDelBorrador,
  limitesDeFaltan,
  validarArmado,
} = require('../asientos.js');
const {
  MODALIDADES,
  MODALIDAD_INICIAL,
  modalidadLabel,
  sugerenciaDeTotal,
  validateDraft,
} = require('../../services/matchRules.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

// ── Valores iniciales ───────────────────────────────────────────

test('el formulario abre con 14 jugadores y falta 1', () => {
  assert.deepEqual(ARMADO_INICIAL, { total: 14, faltan: 1 });
  const asientos = asientosIniciales();
  assert.equal(asientos.length, 12, '12 reservados + el creador = 13 confirmados');
  assert.ok(asientos.every((a) => a.tipo === 'reservado'));
  assert.equal(libresDelBorrador(14, asientos), 1);
  assert.equal(validarArmado(14, asientos), null, 'el borrador inicial se puede publicar tal cual');
});

test('la pantalla usa esos valores, no unos propios', () => {
  const pantalla = leer('src/screens/PublishMatchScreen.js');
  assert.match(pantalla, /total:\s*ARMADO_INICIAL\.total/);
  assert.match(pantalla, /asientos:\s*asientosIniciales\(ARMADO_INICIAL\)/);
  assert.match(pantalla, /modalidad:\s*MODALIDAD_INICIAL/);
  assert.equal(MODALIDAD_INICIAL, 'futbol7', '14 jugadores es Fútbol 7');
});

// ── «¿Cuántos te faltan?» ───────────────────────────────────────

test('faltan va de 1 al total menos el creador', () => {
  assert.deepEqual(limitesDeFaltan(14), { min: 1, max: 13 });
  assert.deepEqual(limitesDeFaltan(2), { min: 1, max: 1 });
});

test('subir y bajar «faltan» ajusta los reservados y nunca sale de sus límites', () => {
  const inicio = asientosIniciales();
  assert.equal(libresDelBorrador(14, conFaltan(inicio, 14, 3)), 3);
  assert.equal(libresDelBorrador(14, conFaltan(inicio, 14, 13)), 13, 'vas solo');
  assert.equal(libresDelBorrador(14, conFaltan(inicio, 14, 0)), 1, 'el mínimo es 1');
  assert.equal(libresDelBorrador(14, conFaltan(inicio, 14, 99)), 13, 'no más que el total menos tú');
  for (let f = 1; f <= 13; f++) {
    assert.equal(validarArmado(14, conFaltan(inicio, 14, f)), null, `faltan ${f} se puede publicar`);
  }
});

test('cambiar el total con el contador conserva a los confirmados mientras quepan', () => {
  const inicio = asientosIniciales();
  assert.equal(libresDelBorrador(16, conTotal(inicio, 16)), 3, 'sube el total: faltan más');
  assert.equal(libresDelBorrador(10, conTotal(inicio, 10)), 1, 'baja el total: queda 1 libre');
});

// ── Fútbol 5 ────────────────────────────────────────────────────

test('Fútbol 5 está entre las modalidades y se rotula bien', () => {
  assert.deepEqual(
    MODALIDADES.map((m) => m.value),
    ['futbol5', 'futbol7', 'futbol11']
  );
  assert.equal(modalidadLabel({ modalidad: 'futbol5' }), 'Fútbol 5');
  assert.equal(modalidadLabel({ modalidad: 'futbol7' }), 'Fútbol 7');
  assert.equal(modalidadLabel({ modalidad: 'futbol11' }), 'Fútbol 11');
  assert.equal(modalidadLabel({}), null, 'partidos antiguos sin modalidad');
});

test('el paso 2 acepta Fútbol 5 y rechaza lo que no es modalidad', () => {
  const base = { titulo: 'x', cancha: 'x', region: 'x', comuna: 'x' };
  assert.equal(validateDraft({ ...base, modalidad: 'futbol5' }, 2).modalidad, undefined);
  assert.equal(validateDraft({ ...base, modalidad: 'futbol6' }, 2).modalidad, 'Elige la modalidad');
});

test('la base acepta exactamente las mismas modalidades que la app', () => {
  const sql = leer('supabase/migrations/183_futbol_5.sql');
  const check = sql.match(/matches_modalidad_check\s+check\s*\(([^;]+)\);/i);
  assert.ok(check, 'la 183 redefine matches_modalidad_check');
  const enLaBase = [...check[1].matchAll(/'([a-z0-9]+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(enLaBase, MODALIDADES.map((m) => m.value).sort());
});

test('elegir Fútbol 5 con los 14 de Fútbol 7 sugiere 10, sin imponerlo', () => {
  assert.deepEqual(sugerenciaDeTotal('futbol5', 14), {
    total: 10,
    texto: 'Fútbol 5 se suele jugar con 10 jugadores y tu partido tiene 14.',
  });
  assert.equal(sugerenciaDeTotal('futbol5', 10), null, 'ya calza');
  assert.equal(sugerenciaDeTotal('futbol7', 14), null, 'el formulario recién abierto no sugiere nada');
  assert.equal(sugerenciaDeTotal('futbol11', 10)?.total, 22);
  assert.equal(sugerenciaDeTotal('futbol5', 12), null, 'un total propio no se discute');
  assert.equal(sugerenciaDeTotal(null, 14), null);
});

test('aceptar la sugerencia cambia el total y deja igual cuántos faltan', () => {
  const faltanDos = conFaltan(asientosIniciales(), 14, 2);
  const enFutbol5 = conTotalYFaltan(faltanDos, 14, 10);
  assert.equal(enFutbol5.length, 7, '7 reservados + tú + 2 que faltan = 10');
  assert.equal(libresDelBorrador(10, enFutbol5), 2);
  assert.equal(validarArmado(10, enFutbol5), null);
  const enFutbol11 = conTotalYFaltan(enFutbol5, 10, 22);
  assert.equal(libresDelBorrador(22, enFutbol11), 2);
  // Si faltaban más de los que caben, queda el máximo.
  assert.equal(libresDelBorrador(10, conTotalYFaltan(conFaltan([], 22, 15), 22, 10)), 9);
});
