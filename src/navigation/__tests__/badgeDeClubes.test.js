/**
 * El badge de Clubes se rotula en un solo sitio.
 *
 * POR QUÉ ESTA PRUEBA LEE ARCHIVOS. El defecto que fija no está dentro de una
 * función: está en que DOS archivos escribían la misma regla por separado y
 * dejaron de coincidir. `MainTabs.js` cortaba en `'9+'` y `ClubsScreen.js`
 * pintaba `{badgeCount}` a secas, así que con doce pendientes la barra decía
 * «9+» y «Pendiente para ti» decía «12» — el mismo número contado una sola
 * vez, con dos rótulos distintos. Ninguna prueba de lógica pura puede ver
 * eso, porque ninguna de las dos funciones está mal.
 *
 * El repo ya prueba cableado leyendo el fuente en `rutasPrivadas.test.js` y
 * `sesionCableado.test.js`; esto es lo mismo.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const MAIN_TABS = leer('navigation/MainTabs.js');
const CLUBS_SCREEN = leer('screens/ClubsScreen.js');

/** La regla escrita a mano que este arreglo saca de la circulación. */
const A_MANO = /> ?9 ?\?/;

test('la barra inferior rotula su badge con etiquetaBadge', () => {
  assert.match(MAIN_TABS, /etiquetaBadge/);
  assert.doesNotMatch(MAIN_TABS, A_MANO, 'MainTabs volvió a cortar el número a mano');
});

test('la portada rotula el suyo con la MISMA función', () => {
  assert.match(CLUBS_SCREEN, /etiquetaBadge/);
  assert.doesNotMatch(CLUBS_SCREEN, A_MANO, 'ClubsScreen empezó a cortar el número a mano');
});

test('las dos la importan del mismo módulo', () => {
  // Si mañana alguien copia la función en vez de importarla, vuelven a poder
  // divergir sin que nada se entere.
  const desdeTareas = /etiquetaBadge[\s\S]{0,200}?from '\.[./]*utils\/clubsHomeTasks\.js'/;
  assert.match(MAIN_TABS, desdeTareas);
  assert.match(CLUBS_SCREEN, desdeTareas);
});

test('ninguno de los dos define su propia versión', () => {
  assert.doesNotMatch(MAIN_TABS, /function etiquetaBadge/);
  assert.doesNotMatch(CLUBS_SCREEN, /function etiquetaBadge/);
});
