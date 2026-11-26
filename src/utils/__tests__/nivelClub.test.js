const test = require('node:test');
const assert = require('node:assert/strict');

const N = require('../nivelClub.js');
const E = require('../clubEdit.js');

/**
 * Nivel del club (migración 199). Lo que se protege:
 *
 *   · El vocabulario es el MISMO que acepta el CHECK de `clubs.nivel`, en el
 *     mismo orden: de él salen el selector, el chip y el número de barras.
 *   · `null` no es «recreativo»: un club que no eligió no muestra nada.
 *   · El formulario no manda nunca un nivel inventado.
 */

const DEL_CHECK = ['recreativo', 'amateur', 'intermedio', 'competitivo', 'elite'];

test('los cinco niveles son los del CHECK de la migración 199, de menor a mayor', () => {
  assert.deepEqual(N.NIVELES_CLUB.map((n) => n.value), DEL_CHECK);
});

test('cada nivel dibuja una barra más que el anterior, de 1 a 5', () => {
  assert.deepEqual(N.NIVELES_CLUB.map((n) => n.barras), [1, 2, 3, 4, 5]);
});

test('cada nivel trae etiqueta y descripción en español', () => {
  for (const n of N.NIVELES_CLUB) {
    assert.ok(n.label && n.desc, n.value);
  }
  assert.equal(N.etiquetaNivel('elite'), 'Élite');
});

test('sin nivel, o con un valor desconocido, no hay nada que dibujar', () => {
  assert.equal(N.nivelDeClub(null), null);
  assert.equal(N.nivelDeClub(undefined), null);
  assert.equal(N.nivelDeClub(''), null);
  assert.equal(N.nivelDeClub('profesional'), null);
  assert.equal(N.etiquetaNivel(null), null);
});

test('sólo los cinco valores son válidos', () => {
  for (const v of DEL_CHECK) assert.equal(N.esNivelClubValido(v), true, v);
  for (const v of [null, undefined, '', 'Élite', 'ELITE', 'profesional', 3]) {
    assert.equal(N.esNivelClubValido(v), false, String(v));
  }
});

test('Editar club manda el nivel elegido', () => {
  const { patch, error } = E.buildClubPatch({ nivel: 'competitivo' });
  assert.equal(error, null);
  assert.deepEqual(patch, { nivel: 'competitivo' });
});

test('Editar club puede volver a «sin nivel», y lo manda como null', () => {
  const { patch, error } = E.buildClubPatch({ nivel: null });
  assert.equal(error, null);
  assert.deepEqual(patch, { nivel: null });
});

test('un nivel que el formulario no tocó no viaja', () => {
  const { patch } = E.buildClubPatch({ nombre: 'Los Tigres' });
  assert.equal('nivel' in patch, false);
});

test('un nivel inventado se rechaza antes de llegar a la base', () => {
  const { patch, error } = E.buildClubPatch({ nivel: 'profesional' });
  assert.equal(patch, null);
  assert.match(error.message, /nivel/i);
});
