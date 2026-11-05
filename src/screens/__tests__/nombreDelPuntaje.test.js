/**
 * El nombre del puntaje sale de un solo lugar: `nombrePuntajeDe(ts)` (o
 * `nombrePuntaje()`), que dice «TrueScore» con la fase 1 encendida y
 * «Trust Score» con ella apagada. Cuatro rótulos de partido seguían
 * escribiendo «Trust Score» a mano en la rama apagada; hoy dicen lo mismo,
 * pero el día que cambie el nombre se habrían quedado atrás.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PANTALLAS = ['MatchDetailScreen.js', 'MatchSpotScreen.js', 'ManageMatchScreen.js'];

/** El código sin comentarios: lo que se puede llegar a pintar. */
function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
}

for (const archivo of PANTALLAS) {
  test(`${archivo} no escribe «Trust Score» a mano`, () => {
    const src = sinComentarios(fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8'));
    const lineas = src.split('\n').filter((l) => /Trust Score/.test(l));
    assert.deepEqual(lineas, [], `rótulos fijos: usa nombreTS (nombrePuntajeDe)`);
  });
}
