/**
 * P05 (pendientes de calidad del 2026-09-23): si fallaba la consulta de
 * valoraciones, `getUserRatingSummary` devolvía ceros como si la persona no
 * tuviera evaluaciones, y Perfil decía «Sin evaluaciones todavía» de alguien
 * que podía tener veinte.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ratingDisplay, pistaDeValoracion } = require('../playerMeta.js');

test('P05: un resumen que no llegó no se lee como cero evaluaciones', () => {
  const r = ratingDisplay({ count: 0, overall: 0, desconocido: true });
  assert.equal(r.desconocido, true);
  assert.equal(r.hasRatings, false);
  assert.equal(pistaDeValoracion(r), 'No pudimos cargar las evaluaciones');
});

test('P05: sin evaluaciones de verdad, lo de siempre', () => {
  assert.equal(pistaDeValoracion(ratingDisplay({ count: 0, overall: 0 })), 'Sin evaluaciones todavía');
  assert.equal(pistaDeValoracion(ratingDisplay({ count: 1, overall: 4.2 })), '1 evaluación');
  assert.equal(pistaDeValoracion(ratingDisplay({ count: 7, overall: 4.2 })), '7 evaluaciones');
});

test('P05: el servicio marca el fallo y la tarjeta usa la pista', () => {
  const svc = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'ratings.js'), 'utf8');
  const ini = svc.indexOf('export async function getUserRatingSummary(');
  const cuerpo = svc.slice(ini, svc.indexOf('\n}\n', ini));
  assert.match(cuerpo, /desconocido: true/, 'un fallo vuelve a leerse como «sin evaluaciones»');
  const card = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'player', 'ReputationCard.js'),
    'utf8'
  );
  assert.match(card, /pistaDeValoracion\(rating\)/);
});
