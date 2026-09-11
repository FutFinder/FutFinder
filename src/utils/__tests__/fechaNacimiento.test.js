/**
 * Pruebas de las reglas puras de fecha de nacimiento → edad del formulario
 * de "Crear cuenta" (pantalla 2B de `Bienvenida.dc.html`).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseFechaNacimiento,
  calcularEdad,
  validarFechaNacimiento,
  usernameDesdeNombre,
} = require('../fechaNacimiento.js');

test('parseFechaNacimiento: arma una fecha válida', () => {
  const f = parseFechaNacimiento('15', '8', '2000');
  assert.equal(f.getFullYear(), 2000);
  assert.equal(f.getMonth(), 7); // agosto = índice 7
  assert.equal(f.getDate(), 15);
});

test('parseFechaNacimiento: rechaza 31 de febrero (Date la correría a marzo)', () => {
  assert.equal(parseFechaNacimiento('31', '2', '2000'), null);
});

test('parseFechaNacimiento: rechaza mes fuera de 1-12', () => {
  assert.equal(parseFechaNacimiento('10', '13', '2000'), null);
});

test('parseFechaNacimiento: rechaza campos vacíos o incompletos', () => {
  assert.equal(parseFechaNacimiento('', '8', '2000'), null);
  assert.equal(parseFechaNacimiento('15', '', '2000'), null);
  assert.equal(parseFechaNacimiento('15', '8', ''), null);
});

test('parseFechaNacimiento: rechaza un año que no tiene 4 dígitos', () => {
  assert.equal(parseFechaNacimiento('15', '8', '00'), null);
});

test('calcularEdad: cumplió años este año', () => {
  const nacimiento = new Date(2000, 4, 10); // 10 mayo 2000
  const hoy = new Date(2026, 5, 1); // 1 junio 2026 → ya cumplió
  assert.equal(calcularEdad(nacimiento, hoy), 26);
});

test('calcularEdad: todavía no cumple años este año', () => {
  const nacimiento = new Date(2000, 11, 20); // 20 diciembre 2000
  const hoy = new Date(2026, 5, 1); // 1 junio 2026 → aún no cumple
  assert.equal(calcularEdad(nacimiento, hoy), 25);
});

test('calcularEdad: el día exacto del cumpleaños ya cuenta como cumplido', () => {
  const nacimiento = new Date(2000, 5, 1);
  const hoy = new Date(2026, 5, 1);
  assert.equal(calcularEdad(nacimiento, hoy), 26);
});

test('validarFechaNacimiento: acepta una edad dentro de 12-99', () => {
  const hoy = new Date(2026, 5, 1);
  const r = validarFechaNacimiento('1', '1', '2000', hoy);
  assert.equal(r.ok, true);
  assert.equal(r.edad, 26);
});

test('validarFechaNacimiento: rechaza menores de 12 años', () => {
  const hoy = new Date(2026, 5, 1);
  const r = validarFechaNacimiento('1', '1', '2020', hoy);
  assert.equal(r.ok, false);
  assert.match(r.reason, /entre 12 y 99/);
});

test('validarFechaNacimiento: rechaza mayores de 99 años', () => {
  const hoy = new Date(2026, 5, 1);
  const r = validarFechaNacimiento('1', '1', '1900', hoy);
  assert.equal(r.ok, false);
  assert.match(r.reason, /entre 12 y 99/);
});

test('validarFechaNacimiento: rechaza una fecha futura', () => {
  const hoy = new Date(2026, 5, 1);
  const r = validarFechaNacimiento('1', '1', '2027', hoy);
  assert.equal(r.ok, false);
  assert.match(r.reason, /futura/);
});

test('validarFechaNacimiento: rechaza una fecha inválida', () => {
  const hoy = new Date(2026, 5, 1);
  const r = validarFechaNacimiento('31', '2', '2000', hoy);
  assert.equal(r.ok, false);
  assert.match(r.reason, /válida/);
});

test('usernameDesdeNombre: sanitiza espacios y tildes', () => {
  assert.equal(usernameDesdeNombre('Vicente Sedini', 'vicente@correo.cl'), 'vicente_sedini');
});

test('usernameDesdeNombre: quita acentos', () => {
  assert.equal(usernameDesdeNombre('José Ávila', 'jose@correo.cl'), 'jose_avila');
});

test('usernameDesdeNombre: recorta a 20 caracteres', () => {
  const largo = usernameDesdeNombre('Nombre Extremadamente Larguisimo De Verdad', 'x@correo.cl');
  assert.ok(largo.length <= 20);
});

test('usernameDesdeNombre: cae al correo si el nombre no deja nada usable', () => {
  assert.equal(usernameDesdeNombre('!!!', 'carlos@correo.cl'), 'carlos');
});

test('usernameDesdeNombre: cae a "jugador" si tampoco hay correo usable', () => {
  assert.equal(usernameDesdeNombre('', ''), 'jugador');
});
