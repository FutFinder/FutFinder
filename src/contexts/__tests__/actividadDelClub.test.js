/**
 * «Actividad reciente» de la portada de Clubes pedía los 50 avisos más
 * recientes de TODA la cuenta y después se quedaba con los del club activo.
 * Con 50 avisos de partidos o de otro club encima, la actividad del club
 * salía vacía aunque la tuviera: la misma falla que C06 en la bandeja.
 *
 * Ahora pide al servidor sólo los del club, ya filtrados y en el número que
 * muestra (`clubId` en `listNotifications`, ver utils/consultaDeAvisos.js,
 * cuya prueba demuestra el caso del puesto 51 y que el filtro del servidor
 * reconoce lo mismo que `avisoDelClub`).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'ClubsHomeContext.js'), 'utf8');

test('la actividad del club se pide filtrada por club en el servidor', () => {
  assert.ok(!/listNotifications\(\{ limit: 50 \}\)/.test(SRC), 'vuelve a pedir 50 avisos de toda la cuenta');
  assert.match(SRC, /listNotifications\(\{ limit: TOPE_ACTIVIDAD, clubId: activeId \}\)/);
});
