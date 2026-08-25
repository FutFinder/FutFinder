const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../matchRules.js');

/**
 * REGRESIÓN — «Publicar partido abierto» debe partir siempre del paso 1.
 *
 * `PublishMatchScreen` reutiliza la misma ruta (`CreateMatch`) para cada
 * publicación nueva. `isFreshPublishEntry` es el guard que decide si, al
 * recuperar el foco, hay que resetear el wizard al paso 1 con un borrador
 * limpio. El bug real era que nada garantizaba ese reseteo: si la pantalla
 * no se remontaba entre una publicación y la siguiente, el paso (y los
 * datos) de la vez anterior quedaban pegados.
 */

test('sin params (Publicar un partido / botón central) es una entrada nueva', () => {
  assert.equal(R.isFreshPublishEntry(undefined), true);
  assert.equal(R.isFreshPublishEntry(null), true);
  assert.equal(R.isFreshPublishEntry({}), true);
});

test('un partido de clubes prefijado sigue siendo una entrada nueva (parte en paso 1)', () => {
  assert.equal(R.isFreshPublishEntry({ clubChallengeId: 'ch-1' }), true);
  assert.equal(R.isFreshPublishEntry({ clubId: 'club-1' }), true);
});

test('la ruta antigua con matchId (→ edición) no cuenta como entrada nueva', () => {
  assert.equal(R.isFreshPublishEntry({ matchId: 'm-1' }), false);
});

test('un borrador guardado con draftStep válido (1-3) continúa donde quedó', () => {
  assert.equal(R.isFreshPublishEntry({ draftStep: 1 }), false);
  assert.equal(R.isFreshPublishEntry({ draftStep: 2 }), false);
  assert.equal(R.isFreshPublishEntry({ draftStep: 3 }), false);
});

test('un draftStep fuera de rango o inválido no cuenta como borrador guardado', () => {
  assert.equal(R.isFreshPublishEntry({ draftStep: 0 }), true);
  assert.equal(R.isFreshPublishEntry({ draftStep: 4 }), true);
  assert.equal(R.isFreshPublishEntry({ draftStep: '3' }), true);
  assert.equal(R.isFreshPublishEntry({ draftStep: null }), true);
});
