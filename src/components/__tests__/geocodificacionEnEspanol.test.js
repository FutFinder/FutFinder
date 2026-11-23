/**
 * Toda consulta a los geocodificadores pide los resultados en español.
 *
 * El 2026-11-18 un partido publicado en la web quedó con la dirección
 * «Estadio Nacional, Ñuñoa, Santiago Metropolitan Region, Chile»: la
 * sugerencia se pedía en español, pero el `retrieve` de Mapbox (el que trae
 * la dirección completa que se guarda) no, y Mapbox la devolvía en inglés.
 * Esta prueba lee el fuente porque las URLs se arman dentro del componente.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fuente = fs.readFileSync(path.join(__dirname, '..', 'LocationAutocomplete.js'), 'utf8');

test('cada llamada a Mapbox Search Box pide language=es', () => {
  const llamadas = [...fuente.matchAll(/api\.mapbox\.com\/search\/searchbox\/v1\/(\w+)/g)].map((m) => m[1]);
  assert.ok(llamadas.length >= 3, `sólo encontré ${llamadas.length} llamadas a Mapbox`);
  for (const tipo of ['suggest', 'retrieve', 'reverse']) {
    const i = fuente.indexOf(`searchbox/v1/${tipo}`);
    assert.notEqual(i, -1, `falta la llamada ${tipo}`);
    // La URL se arma en las líneas que siguen a la ruta (o en el arreglo de
    // parámetros justo antes, en el caso de suggest).
    const cerca = fuente.slice(Math.max(0, i - 600), i + 400);
    assert.match(cerca, /language=es/, `la llamada ${tipo} no pide language=es`);
  }
});

test('cada llamada a Nominatim pide accept-language=es', () => {
  const llamadas = fuente.split('nominatim.openstreetmap.org').slice(1);
  assert.ok(llamadas.length >= 2);
  for (const resto of llamadas) assert.match(resto.slice(0, 300), /accept-language=es/);
});
