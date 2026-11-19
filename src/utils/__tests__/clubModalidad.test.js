const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPCIONES_MODALIDAD,
  esModalidadValida,
  MODALIDADES,
  modalidadBadges,
  modalidadInline,
} = require('../clubModalidad.js');

// Migración 195: un club puede ser de Fútbol 5. «Ambos» sigue siendo 7 y 11
// (es lo que guardan los clubes que ya lo eligieron).

test('crear y editar club ofrecen Fútbol 5, primero', () => {
  assert.deepEqual(OPCIONES_MODALIDAD[0], { value: 'futbol5', label: 'Fútbol 5' });
  assert.equal(esModalidadValida('futbol5'), true);
  assert.equal(MODALIDADES.FUTBOL_5, 'futbol5');
});

test('un club de Fútbol 5 se muestra con su etiqueta', () => {
  assert.deepEqual(modalidadBadges('futbol5'), ['FÚTBOL 5']);
  assert.equal(modalidadInline('futbol5'), 'Fútbol 5');
});

test('ambos sigue siendo 7 y 11', () => {
  assert.deepEqual(modalidadBadges('ambos'), ['FÚTBOL 7', 'FÚTBOL 11']);
  assert.equal(modalidadInline('ambos'), 'Fútbol 7 y Fútbol 11');
});

test('sin modalidad no hay chip ni etiqueta', () => {
  assert.deepEqual(modalidadBadges(null), []);
  assert.equal(modalidadInline(null), null);
  assert.equal(esModalidadValida('futbol8'), false);
});
