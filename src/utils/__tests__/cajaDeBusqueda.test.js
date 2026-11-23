/**
 * I01 (pendientes de calidad del 2026-09-23): Inicio pedía los 20 partidos
 * abiertos más próximos de TODA la app y después aplicaba el radio. Veinte
 * partidos lejanos más tempranos tapaban al primero cercano.
 *
 * Ahora la consulta lleva una caja de latitud/longitud alrededor del
 * jugador antes del límite, y el radio exacto (haversine) se sigue
 * aplicando después, como antes.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { cajaDeBusqueda, dentroDeLaCaja } = require('../cajaDeBusqueda.js');

const SANTIAGO = { lat: -33.45, lng: -70.66 };

/** Distancia real en km (la misma fórmula que matches.js). */
function km(a, b) {
  const R = 6371;
  const r = (x) => (x * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.sin(r(b.lng - a.lng) / 2) ** 2 * Math.cos(r(a.lat)) * Math.cos(r(b.lat));
  return 2 * R * Math.asin(Math.sqrt(h));
}

test('I01: el partido cercano aparece aunque haya 20 lejanos más temprano', () => {
  const lejanos = Array.from({ length: 20 }, (_, i) => ({
    id: `lejos-${i}`, hora: `2026-11-06T1${i % 10}:00:00Z`, latitud: -36.82, longitud: -73.05, // Concepción
  }));
  const cercano = { id: 'cerca', hora: '2026-11-07T20:00:00Z', latitud: -33.44, longitud: -70.65 };
  const todos = [...lejanos, cercano];
  const porHora = (a, b) => (a.hora < b.hora ? -1 : 1);

  // Cómo era: 20 globales y el radio después.
  const antes = todos.sort(porHora).slice(0, 20).filter((m) => km(SANTIAGO, { lat: m.latitud, lng: m.longitud }) <= 10);
  assert.equal(antes.length, 0);

  // Cómo es: la caja va en la consulta, antes del límite.
  const caja = cajaDeBusqueda(SANTIAGO, 10);
  const ahora = todos.filter((m) => dentroDeLaCaja(m, caja)).sort(porHora).slice(0, 20);
  assert.deepEqual(ahora.map((m) => m.id), ['cerca']);
});

test('I01: la caja contiene todo el círculo del radio, también en diagonal', () => {
  const caja = cajaDeBusqueda(SANTIAGO, 10);
  for (let ang = 0; ang < 360; ang += 15) {
    const t = (ang * Math.PI) / 180;
    // Un punto a 9,99 km en cada dirección.
    const p = {
      latitud: SANTIAGO.lat + (9.99 / 111.32) * Math.cos(t),
      longitud: SANTIAGO.lng + (9.99 / (111.32 * Math.cos((SANTIAGO.lat * Math.PI) / 180))) * Math.sin(t),
    };
    assert.ok(km(SANTIAGO, { lat: p.latitud, lng: p.longitud }) < 10.05);
    assert.ok(dentroDeLaCaja(p, caja), `quedó fuera el punto a ${ang}°`);
  }
});

test('I01: sin coordenadas o sin radio no hay caja', () => {
  assert.equal(cajaDeBusqueda(null, 10), null);
  assert.equal(cajaDeBusqueda(SANTIAGO, null), null);
  assert.equal(cajaDeBusqueda({ lat: NaN, lng: 1 }, 10), null);
});

test('I01: Inicio pide los partidos con la caja del radio', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'HomeScreen.js'), 'utf8');
  assert.match(home, /listOpenMatches\(\{[^}]*cerca:/, 'Inicio vuelve a pedir partidos de todo el país');
  const svc = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'matches.js'), 'utf8');
  const ini = svc.indexOf('export async function listOpenMatches(');
  const cuerpo = svc.slice(ini, svc.indexOf('\n}\n', ini));
  assert.match(cuerpo, /cajaDeBusqueda\(/);
  assert.ok(cuerpo.indexOf("gte('latitud'") < cuerpo.indexOf('const { data, error } = await q'));
});
