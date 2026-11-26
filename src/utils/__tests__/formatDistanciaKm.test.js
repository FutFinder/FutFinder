const test = require('node:test');
const assert = require('node:assert/strict');

const { formatDistanciaKm } = require('../distancia.js');

/**
 * La distancia de un rival en español de Chile. Lo que se protege: un club a
 * 1.672,8 km se leía «1672,8 km» en la tarjeta —sin separador de miles y con
 * un decimal que a esa escala no dice nada—.
 */

test('cerca: un decimal con coma', () => {
  assert.equal(formatDistanciaKm(2.43), '2,4 km');
  assert.equal(formatDistanciaKm(0.5), '0,5 km');
  assert.equal(formatDistanciaKm(99.94), '99,9 km');
});

test('bajo 100 m no inventa precisión', () => {
  assert.equal(formatDistanciaKm(0.04), 'menos de 0,1 km');
});

test('desde 100 km: entero y con punto de miles', () => {
  assert.equal(formatDistanciaKm(100), '100 km');
  assert.equal(formatDistanciaKm(1672.8), '1.673 km');
  assert.equal(formatDistanciaKm(12345.4), '12.345 km');
});

test('sin dato: lo dice', () => {
  assert.equal(formatDistanciaKm(null), 'Distancia desconocida');
  assert.equal(formatDistanciaKm(undefined), 'Distancia desconocida');
});
