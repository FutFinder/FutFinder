/**
 * I03 (pendientes de calidad del 2026-09-23): la tarjeta de reputación de
 * Inicio no decía lo mismo que Perfil.
 *
 * EL FALLO. Inicio leía `profiles.partidos_jugados`, un contador que nada
 * incrementa (Perfil ya usa `asistencias_confirmadas`, ver `deriveStats`), y
 * `profile.reportes`, una columna que no existe: «0 partidos jugados · 0
 * reportes» para todo el mundo. Perfil cuenta los reportes con la RPC
 * `count_reports_against`.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { lineaDeReputacion } = require('../playerMeta.js');

test('I03: la línea dice partidos y reportes, con singular y plural', () => {
  assert.equal(lineaDeReputacion(3, 2), '3 partidos jugados · 2 reportes');
  assert.equal(lineaDeReputacion(1, 1), '1 partido jugado · 1 reporte');
  assert.equal(lineaDeReputacion(0, 0), '0 partidos jugados · 0 reportes');
});

test('I03: si no se pudieron contar los reportes, no se inventa un cero', () => {
  assert.equal(lineaDeReputacion(4, null), '4 partidos jugados');
});

test('I03: Inicio cuenta como Perfil', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'HomeScreen.js'), 'utf8');
  assert.ok(!/profile\?\.partidos_jugados/.test(src), 'Inicio vuelve a leer partidos_jugados, que nada incrementa');
  assert.ok(!/profile\?\.reportes/.test(src), 'Inicio vuelve a leer profile.reportes, que no existe');
  assert.match(src, /profile\?\.asistencias_confirmadas/);
  assert.match(src, /countReportsAgainst\(/);
});

test('I03: la tarjeta arma su línea con lineaDeReputacion', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'home', 'TrustScoreCard.js'),
    'utf8'
  );
  assert.match(src, /lineaDeReputacion\(matchesPlayed, reports\)/);
});
