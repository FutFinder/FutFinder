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

// ---------------------------------------------------------------------------
// I06: «ADMIN · N CLUBES» contaba TODAS las membresías. Quien administra un
// club y juega en otro leía «ADMIN · 2 CLUBES».
// ---------------------------------------------------------------------------

const { etiquetaAdminDeClubes } = require('../clubsHomeSources.js');

test('I06: cuenta sólo los clubes que administro', () => {
  const membresias = [
    { club: { id: 'a' }, miRol: 'admin' },
    { club: { id: 'b' }, miRol: 'jugador' },
  ];
  assert.equal(etiquetaAdminDeClubes('admin', membresias), 'ADMIN · 1 CLUB');
  assert.equal(
    etiquetaAdminDeClubes('admin', [...membresias, { club: { id: 'c' }, miRol: 'admin' }]),
    'ADMIN · 2 CLUBES'
  );
});

test('I06: sin rol de administrador en el club activo, no hay etiqueta', () => {
  assert.equal(etiquetaAdminDeClubes('jugador', [{ club: { id: 'a' }, miRol: 'admin' }]), undefined);
});

test('I06: si las membresías no llegaron, administra al menos el activo', () => {
  assert.equal(etiquetaAdminDeClubes('admin', []), 'ADMIN · 1 CLUB');
  assert.equal(etiquetaAdminDeClubes('admin', null), 'ADMIN · 1 CLUB');
});

test('I06: Inicio usa etiquetaAdminDeClubes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'HomeScreen.js'), 'utf8');
  assert.match(src, /etiquetaAdminDeClubes\(/);
  assert.ok(!/\(misMembresias \|\| \[\]\)\.length \|\| misClubIds\.length/.test(src), 'vuelve a contar todas las membresías');
});
