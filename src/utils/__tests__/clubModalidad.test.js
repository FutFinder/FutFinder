const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPCIONES_MODALIDAD,
  esModalidadValida,
  MODALIDADES,
  modalidadBadges,
  modalidadInline,
  modalidadesDe,
  valorDeModalidades,
  alternarModalidad,
} = require('../clubModalidad.js');

// Migración 195: un club puede ser de Fútbol 5. Migración 201 (2026-11-26):
// un club puede jugar VARIAS modalidades y se muestran juntas, «Fútbol 5, 7».

test('el selector ofrece las tres modalidades sueltas, Fútbol 5 primero', () => {
  assert.deepEqual(
    OPCIONES_MODALIDAD.map((o) => o.value),
    ['futbol5', 'futbol7', 'futbol11']
  );
  assert.deepEqual(OPCIONES_MODALIDAD[0], { value: 'futbol5', label: 'Fútbol 5' });
  assert.equal(MODALIDADES.FUTBOL_5, 'futbol5');
});

test('varias modalidades se guardan en un solo valor canónico', () => {
  assert.equal(valorDeModalidades([]), null);
  assert.equal(valorDeModalidades(['futbol7']), 'futbol7');
  assert.equal(valorDeModalidades(['futbol7', 'futbol5']), 'futbol5_7');
  assert.equal(valorDeModalidades(['futbol11', 'futbol5']), 'futbol5_11');
  assert.equal(valorDeModalidades(['futbol11', 'futbol7', 'futbol5']), 'futbol5_7_11');
  // 7 y 11 sigue siendo «ambos»: es lo que ya guardan los clubes y lo que
  // entienden las versiones anteriores de la app.
  assert.equal(valorDeModalidades(['futbol11', 'futbol7']), 'ambos');
  // Repetidas o desconocidas no cuentan.
  assert.equal(valorDeModalidades(['futbol7', 'futbol7', 'futbol8']), 'futbol7');
});

test('el valor guardado se vuelve a abrir como lista, en orden', () => {
  assert.deepEqual(modalidadesDe(null), []);
  assert.deepEqual(modalidadesDe('futbol5'), ['futbol5']);
  assert.deepEqual(modalidadesDe('ambos'), ['futbol7', 'futbol11']);
  assert.deepEqual(modalidadesDe('futbol5_11'), ['futbol5', 'futbol11']);
  assert.deepEqual(modalidadesDe('futbol5_7_11'), ['futbol5', 'futbol7', 'futbol11']);
  assert.deepEqual(modalidadesDe('futbol8'), []);
});

test('juntas se leen «Fútbol 5, 7» y «Fútbol 5, 7, 11»', () => {
  assert.equal(modalidadInline('futbol5'), 'Fútbol 5');
  assert.equal(modalidadInline('futbol5_7'), 'Fútbol 5, 7');
  assert.equal(modalidadInline('futbol5_11'), 'Fútbol 5, 11');
  assert.equal(modalidadInline('ambos'), 'Fútbol 7, 11');
  assert.equal(modalidadInline('futbol5_7_11'), 'Fútbol 5, 7, 11');
});

test('un chip por modalidad', () => {
  assert.deepEqual(modalidadBadges('futbol5'), ['FÚTBOL 5']);
  assert.deepEqual(modalidadBadges('ambos'), ['FÚTBOL 7', 'FÚTBOL 11']);
  assert.deepEqual(modalidadBadges('futbol5_7_11'), ['FÚTBOL 5', 'FÚTBOL 7', 'FÚTBOL 11']);
});

test('valores válidos: las sueltas y sus combinaciones, nada más', () => {
  for (const v of ['futbol5', 'futbol7', 'futbol11', 'ambos', 'futbol5_7', 'futbol5_11', 'futbol5_7_11']) {
    assert.equal(esModalidadValida(v), true, v);
  }
  for (const v of ['futbol8', 'futbol7_11', 'futbol7_5', '', 'futbol5_5']) {
    assert.equal(esModalidadValida(v), false, v);
  }
});

test('sin modalidad no hay chip ni etiqueta', () => {
  assert.deepEqual(modalidadBadges(null), []);
  assert.equal(modalidadInline(null), null);
});

test('tocar una modalidad la marca o la desmarca', () => {
  assert.equal(alternarModalidad(null, 'futbol7'), 'futbol7');
  assert.equal(alternarModalidad('futbol7', 'futbol5'), 'futbol5_7');
  assert.equal(alternarModalidad('futbol5_7', 'futbol11'), 'futbol5_7_11');
  assert.equal(alternarModalidad('futbol5_7_11', 'futbol5'), 'ambos');
  assert.equal(alternarModalidad('ambos', 'futbol11'), 'futbol7');
  assert.equal(alternarModalidad('futbol7', 'futbol7'), null);
});
