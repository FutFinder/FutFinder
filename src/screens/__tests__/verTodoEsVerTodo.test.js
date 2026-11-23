/**
 * P03 (pendientes de calidad del 2026-09-23): «Ver todo» en Últimas
 * participaciones navegaba a Buscar partidos. Prometía un historial y abría
 * otra cosa; en el perfil ajeno, además, mandaba a buscar partidos a quien
 * sólo estaba mirando a otro jugador.
 *
 * Ahora despliega en el sitio el historial que ya está cargado, y sólo se
 * ofrece cuando hay más de lo que se muestra.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'ProfileScreen.js'), 'utf8');

function cabecera() {
  const ini = SRC.indexOf('title="Últimas participaciones"');
  assert.ok(ini > 0);
  return SRC.slice(ini, SRC.indexOf('/>', ini));
}

test('P03: «Ver todo» ya no navega a Buscar partidos', () => {
  const c = cabecera();
  assert.ok(!/navigate\('SearchTab'\)/.test(c), '«Ver todo» vuelve a abrir Buscar partidos');
  assert.match(c, /setVerTodasLasParticipaciones/);
});

test('P03: sólo se ofrece si hay más participaciones que las visibles', () => {
  const c = cabecera();
  assert.match(c, /hayMasParticipaciones/);
  assert.match(SRC, /const hayMasParticipaciones = conPartido\.length > MAX_PARTICIPACIONES;/);
});
