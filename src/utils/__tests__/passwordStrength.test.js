const test = require('node:test');
const assert = require('node:assert/strict');

const { passwordStrength } = require('../passwordStrength.js');

test('passwordStrength: menos de 8 caracteres es siempre 0', () => {
  assert.equal(passwordStrength('abc123'), 0);
  assert.equal(passwordStrength(''), 0);
  assert.equal(passwordStrength(undefined), 0);
});

test('passwordStrength: 8+ caracteres sin mayúscula ni número es 1', () => {
  assert.equal(passwordStrength('abcdefgh'), 1);
});

test('passwordStrength: 8+ con mayúscula y minúscula (sin número) es 2', () => {
  assert.equal(passwordStrength('Abcdefgh'), 2);
});

test('passwordStrength: 8+ con número (sin mayúscula) es 2', () => {
  assert.equal(passwordStrength('abcdefg1'), 2);
});

test('passwordStrength: mayúscula + minúscula + número es 3', () => {
  assert.equal(passwordStrength('Abcdefg1'), 3);
});

test('passwordStrength: mayúscula + minúscula + símbolo también llega a 3', () => {
  assert.equal(passwordStrength('Abcdefg!'), 3);
});
