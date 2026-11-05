/**
 * P04 (pendientes de calidad del 2026-09-23): si fallaba la consulta del
 * estado de cuenta, el servicio devolvía `suspended: false` y la tarjeta
 * afirmaba «Cuenta en buen estado · Sin sanciones ni restricciones
 * activas». No saber no es lo mismo que no tener sanciones.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { encabezadoEstadoDeCuenta } = require('../playerMeta.js');

test('P04: sin saber el estado, no se afirma buen estado', () => {
  const e = encabezadoEstadoDeCuenta({ desconocido: true });
  assert.equal(e.tono, 'desconocido');
  assert.doesNotMatch(e.titulo, /buen estado/i);
  assert.doesNotMatch(e.sub, /Sin sanciones/i);
  assert.match(e.titulo, /No pudimos comprobar/);
});

test('P04: con el dato, lo de siempre', () => {
  assert.equal(encabezadoEstadoDeCuenta({ suspended: false }).titulo, 'Cuenta en buen estado');
  const s = encabezadoEstadoDeCuenta({ suspended: true, hasta: '12 de noviembre', ausencias: 2 });
  assert.equal(s.tono, 'sancion');
  assert.equal(s.sub, 'No puede inscribirse hasta el 12 de noviembre · 2 ausencias');
});

test('P04: el servicio marca el fallo y la tarjeta lo usa', () => {
  const svc = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'profile.js'), 'utf8');
  const ini = svc.indexOf('export async function getAccountStatusFor(');
  const cuerpo = svc.slice(ini, svc.indexOf('\n}\n', ini));
  assert.match(cuerpo, /desconocido: true/, 'un fallo vuelve a leerse como «sin sanciones»');
  const card = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'player', 'AccountStatusCard.js'),
    'utf8'
  );
  assert.match(card, /encabezadoEstadoDeCuenta\(/);
  const perfil = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'ProfileScreen.js'), 'utf8');
  assert.match(perfil, /desconocido=\{!!accountStatus\.desconocido\}/);
});
