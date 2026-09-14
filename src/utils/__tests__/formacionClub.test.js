/**
 * Pruebas de la formación y los puestos del tablero de alineación
 * (migración 92).
 *
 * QUÉ SE FIJA ACÁ:
 *   · `layoutSlots` siempre agrega el arquero y exactamente un puesto por
 *     línea, sin importar la formación.
 *   · `fitsForMember` traduce las 7 posiciones reales a puestos de cancha,
 *     junta las de un arreglo con varias posiciones sin repetir, y `flanco`
 *     antepone el lado sin descartar el otro.
 *   · `autocompletarAsignaciones` no deja puestos libres si hay banca
 *     suficiente, y prioriza el calce exacto sobre cualquiera.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { F7, F11, layoutSlots, fitsForMember, autocompletarAsignaciones } = require('../formacionClub.js');

test('layoutSlots: "4-3-3" tiene arquero + 4 + 3 + 3 = 11 puestos', () => {
  const slots = layoutSlots('4-3-3');
  assert.equal(slots.length, 11);
  assert.equal(slots.filter((s) => s.label === 'POR').length, 1);
  assert.equal(slots[0].key, 'gk');
});

test('layoutSlots: "2-3-1" (fútbol 7) tiene arquero + 2 + 3 + 1 = 7 puestos', () => {
  const slots = layoutSlots('2-3-1');
  assert.equal(slots.length, 7);
});

test('layoutSlots: la defensa de 4 usa laterales en los extremos', () => {
  const slots = layoutSlots('4-4-2');
  const defensa = slots.filter((s) => s.top === slots[1].top); // primera línea tras el arquero
  const labels = defensa.map((s) => s.label);
  assert.deepEqual(labels, ['LI', 'DFC', 'DFC', 'LD']);
});

test('layoutSlots: la línea de ataque queda más arriba (top menor) que la defensa', () => {
  const slots = layoutSlots('4-3-3');
  const topDe = (label) => slots.find((s) => s.label === label).top;
  assert.ok(topDe('LI') > topDe('MC'), 'la defensa (LI) debe estar más abajo que el medio (MC)');
  assert.ok(topDe('MC') > topDe('ED'), 'el medio debe estar más abajo que el ataque (ED)');
});

test('layoutSlots: claves únicas para cada puesto', () => {
  const slots = layoutSlots('4-2-3-1');
  const claves = new Set(slots.map((s) => s.key));
  assert.equal(claves.size, slots.length);
});

test('F7 y F11 no se pisan y tienen formaciones reales', () => {
  assert.ok(F7.includes('2-3-1'));
  assert.ok(F11.includes('4-3-3'));
  assert.equal(F7.some((f) => F11.includes(f)), false);
});

test('fitsForMember: un arquero sólo calza en POR', () => {
  const fits = fitsForMember({ posicion_preferida: ['arquero'] });
  assert.deepEqual(fits, ['POR']);
});

test('fitsForMember: varias posiciones se juntan sin repetir', () => {
  const fits = fitsForMember({ posicion_preferida: ['medio', 'volante'] });
  assert.deepEqual(fits, ['MC', 'MCD', 'MI', 'MD']);
});

test('fitsForMember: "sin_definir" no aporta ningún puesto', () => {
  const fits = fitsForMember({ posicion_preferida: ['sin_definir'] });
  assert.deepEqual(fits, []);
});

test('fitsForMember: sin posición_preferida no revienta', () => {
  assert.deepEqual(fitsForMember({}), []);
  assert.deepEqual(fitsForMember(null), []);
});

test('fitsForMember: flanco izquierdo antepone LI a LD sin descartarlo', () => {
  const fits = fitsForMember({ posicion_preferida: ['lateral'], flanco: 'izquierdo' });
  assert.equal(fits[0], 'LI');
  assert.ok(fits.includes('LD'));
});

test('fitsForMember: flanco derecho antepone LD a LI', () => {
  const fits = fitsForMember({ posicion_preferida: ['lateral'], flanco: 'derecho' });
  assert.equal(fits[0], 'LD');
});

test('fitsForMember: sin flanco (o "ambos") no reordena', () => {
  const sinFlanco = fitsForMember({ posicion_preferida: ['lateral'] });
  const ambos = fitsForMember({ posicion_preferida: ['lateral'], flanco: 'ambos' });
  assert.deepEqual(sinFlanco, ambos);
});

test('autocompletarAsignaciones: completa todos los puestos si hay banca suficiente', () => {
  const slots = layoutSlots('2-3-1');
  const banca = [
    { member_id: 'a', posicion_preferida: ['arquero'] },
    { member_id: 'b', posicion_preferida: ['defensa'] },
    { member_id: 'c', posicion_preferida: ['defensa'] },
    { member_id: 'd', posicion_preferida: ['medio'] },
    { member_id: 'e', posicion_preferida: ['medio'] },
    { member_id: 'f', posicion_preferida: ['medio'] },
    { member_id: 'g', posicion_preferida: ['delantero'] },
  ];
  const asignaciones = autocompletarAsignaciones(slots, banca);
  assert.equal(Object.keys(asignaciones).length, slots.length);
  assert.equal(asignaciones.gk, 'a');
});

test('autocompletarAsignaciones: prioriza el calce exacto sobre cualquier calce', () => {
  const slots = [{ key: 'gk', label: 'POR', left: 50, top: 90 }];
  const banca = [
    { member_id: 'volante-cualquiera', posicion_preferida: ['volante'] },
    { member_id: 'el-arquero', posicion_preferida: ['arquero'] },
  ];
  const asignaciones = autocompletarAsignaciones(slots, banca);
  assert.equal(asignaciones.gk, 'el-arquero');
});

test('autocompletarAsignaciones: sin banca suficiente deja el resto de los puestos libres', () => {
  const slots = layoutSlots('2-3-1');
  const banca = [{ member_id: 'a', posicion_preferida: ['arquero'] }];
  const asignaciones = autocompletarAsignaciones(slots, banca);
  assert.equal(Object.keys(asignaciones).length, 1);
});

test('autocompletarAsignaciones: sin banca no asigna nada y no revienta', () => {
  const slots = layoutSlots('2-3-1');
  assert.deepEqual(autocompletarAsignaciones(slots, []), {});
});
