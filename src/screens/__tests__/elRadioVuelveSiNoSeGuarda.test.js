/**
 * A01 (pendientes de calidad del 2026-09-23): al fallar el guardado del
 * radio de búsqueda, `radiusKm` se quedaba con el valor nuevo mientras el
 * perfil y la base conservaban el anterior. Ajustes decía «25 km» y la app
 * buscaba en 10.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'SettingsScreen.js'), 'utf8');

function cuerpo() {
  const ini = SRC.indexOf('const handleRadiusRelease = async (km) => {');
  assert.ok(ini > 0, 'no se encontró handleRadiusRelease');
  return SRC.slice(ini, SRC.indexOf('\n  };\n', ini));
}

test('A01: si el guardado falla, el radio vuelve al que estaba guardado', () => {
  const c = cuerpo();
  assert.match(c, /const anterior = profile\?\.search_radius_km \?\? 10;/);
  assert.match(c, /if \(error\) \{[\s\S]*setRadiusKm\(anterior\);/, 'un fallo deja el radio nuevo en pantalla');
});

test('A01: un guardado viejo que vuelve tarde no deshace uno nuevo', () => {
  const c = cuerpo();
  assert.match(c, /const turno = secuenciaRadio\.abrir\(\);/);
  assert.match(c, /if \(!secuenciaRadio\.vigente\(turno\)\) return;/);
});
