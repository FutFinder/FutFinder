/**
 * Pruebas del tiempo relativo compacto de la portada de Clubes.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { haceCuanto } = require('../tiempoRelativo.js');

const AHORA = new Date('2026-08-28T12:00:00Z');
const hace = (ms) => new Date(AHORA.getTime() - ms).toISOString();

const MIN = 60000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

test('menos de un minuto es «ahora»', () => {
  assert.equal(haceCuanto(hace(0), AHORA), 'ahora');
  assert.equal(haceCuanto(hace(59000), AHORA), 'ahora');
});

test('los minutos se truncan hacia abajo', () => {
  assert.equal(haceCuanto(hace(MIN), AHORA), '1 min');
  assert.equal(haceCuanto(hace(59 * MIN), AHORA), '59 min');
});

test('a partir de una hora se cuenta en horas', () => {
  assert.equal(haceCuanto(hace(HORA), AHORA), '1 h');
  assert.equal(haceCuanto(hace(23 * HORA), AHORA), '23 h');
});

test('a partir de un día se cuenta en días', () => {
  assert.equal(haceCuanto(hace(DIA), AHORA), '1 d');
  assert.equal(haceCuanto(hace(6 * DIA), AHORA), '6 d');
});

test('a partir de una semana se cuenta en semanas', () => {
  assert.equal(haceCuanto(hace(7 * DIA), AHORA), '1 sem');
  assert.equal(haceCuanto(hace(20 * DIA), AHORA), '2 sem');
});

test('una fecha futura se muestra como «ahora», no en negativo', () => {
  // El reloj del servidor y el del teléfono no siempre coinciden. Un aviso
  // «hace -3 min» es peor que uno recién llegado.
  assert.equal(haceCuanto(new Date(AHORA.getTime() + 5 * MIN).toISOString(), AHORA), 'ahora');
});

test('una fecha ilegible no devuelve texto, devuelve null', () => {
  // La fila se dibuja igual, sin la etiqueta: mejor que un «NaN min».
  assert.equal(haceCuanto('cualquier cosa', AHORA), null);
  assert.equal(haceCuanto(null, AHORA), null);
  assert.equal(haceCuanto(undefined, AHORA), null);
});
