/**
 * El orden de las migraciones, que ningún `sort` acierta.
 *
 * Las dos trampas son reales y están medidas contra este repositorio:
 *   · alfabético pone la 100 entre la 09 y la 10;
 *   · `sort -V` pone la 44b antes que la 44.
 *
 * Las dos producen una base a medias, y no al leer el directorio sino al
 * aplicar, que es cuando ya es tarde.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  partirNombre,
  compararMigraciones,
  ordenarMigraciones,
} = require('../ordenMigraciones.js');

const MIGRACIONES = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');

test('el número y la letra se leen bien', () => {
  assert.deepEqual(partirNombre('44_partido_de_clubes.sql'), { numero: 44, letra: '' });
  assert.deepEqual(partirNombre('44b_ubicacion_protegida_clubes.sql'), { numero: 44, letra: 'b' });
  assert.deepEqual(partirNombre('157_el_historial.sql'), { numero: 157, letra: '' });
  assert.deepEqual(partirNombre('01_add_region.sql'), { numero: 1, letra: '' });
  assert.equal(partirNombre('sin_numero.sql'), null);
  assert.equal(partirNombre(null), null);
});

test('LA TRAMPA 1: la 100 va después de la 10, no entre la 09 y la 10', () => {
  // Alfabéticamente `100_` < `10_` porque `0` < `_`. Es lo que haría
  // cualquier herramienta que lea el directorio.
  const alfabetico = ['09_a.sql', '100_b.sql', '10_c.sql'].sort();
  assert.deepEqual(alfabetico, ['09_a.sql', '100_b.sql', '10_c.sql'],
    'si esto cambia, la trampa dejó de existir y este caso ya no mide nada');

  assert.deepEqual(
    ordenarMigraciones(['09_a.sql', '100_b.sql', '10_c.sql']),
    ['09_a.sql', '10_c.sql', '100_b.sql']
  );
});

test('LA TRAMPA 2: la 44 va antes que la 44b, que es lo que `sort -V` rompe', () => {
  assert.deepEqual(
    ordenarMigraciones(['44e_x.sql', '44b_x.sql', '44_x.sql', '45_x.sql', '44d_x.sql']),
    ['44_x.sql', '44b_x.sql', '44d_x.sql', '44e_x.sql', '45_x.sql']
  );
});

test('un archivo con un nombre raro se va al final, no rompe el resto', () => {
  assert.deepEqual(
    ordenarMigraciones(['10_b.sql', 'notas.sql', '09_a.sql']),
    ['09_a.sql', '10_b.sql', 'notas.sql']
  );
});

test('comparar es consistente: a<b implica b>a', () => {
  const pares = [['09_a.sql', '100_b.sql'], ['44_x.sql', '44b_x.sql'], ['44b_x.sql', '45_x.sql']];
  for (const [a, b] of pares) {
    assert.ok(compararMigraciones(a, b) < 0, `${a} debería ir antes que ${b}`);
    assert.ok(compararMigraciones(b, a) > 0, `${b} debería ir después de ${a}`);
    assert.equal(compararMigraciones(a, a), 0);
  }
});

// ─── Contra el repositorio de verdad ─────────────────────────────────

test('todas las migraciones del repositorio tienen número legible', () => {
  // Si alguien agrega `arreglo-rapido.sql`, el orden deja de estar definido
  // y se iría al final en silencio. Mejor que falle acá.
  const sinNumero = fs.readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => partirNombre(f) === null);
  assert.deepEqual(sinNumero, [], 'hay migraciones sin número al principio del nombre');
});

test('no hay dos migraciones con el mismo número y letra', () => {
  // Es el choque que describe la nota de memoria sobre las dos Macs: dos
  // sesiones numerando a la vez. Dos archivos con el mismo número tienen un
  // orden indefinido entre sí.
  const vistos = new Map();
  for (const f of fs.readdirSync(MIGRACIONES).filter((x) => x.endsWith('.sql'))) {
    const p = partirNombre(f);
    if (!p) continue;
    const clave = `${p.numero}${p.letra}`;
    if (vistos.has(clave)) {
      assert.fail(`${f} y ${vistos.get(clave)} tienen el mismo número (${clave})`);
    }
    vistos.set(clave, f);
  }
  assert.ok(vistos.size > 100, 'se esperaban más de cien migraciones');
});

test('el orden del repositorio NO coincide con el alfabético', () => {
  // El caso que justifica todo este archivo. Si algún día coincidieran
  // —porque se renumeraran con ceros a la izquierda— esto avisaría de que
  // el script ya no hace falta, en vez de dejarlo ahí sin que nadie sepa
  // por qué.
  const archivos = fs.readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql'));
  const alfabetico = [...archivos].sort();
  const correcto = ordenarMigraciones(archivos);
  assert.notDeepEqual(alfabetico, correcto,
    'el orden alfabético y el correcto coinciden: ¿se renumeraron las migraciones?');
});
