/**
 * Los rivales de la portada llegan con distancia.
 *
 * POR QUÉ ESTA PRUEBA LEE ARCHIVOS. El defecto no estaba dentro de ninguna
 * función: `ClubsScreen` LEÍA `rival.distanciaKm` para componer la meta de la
 * tarjeta, y nadie lo escribía. `ClubDetailScreen` sí lo calculaba, así que la
 * pantalla que el rediseño puso como entrada del módulo mostraba «Distancia
 * N.A.» en todas las tarjetas mientras el detalle mostraba kilómetros reales.
 * Un campo que se lee y no se escribe no lo ve ninguna prueba de lógica pura.
 *
 * El repo ya prueba cableado leyendo el fuente en `sesionCableado.test.js` y
 * `rutasPrivadas.test.js`.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const CONTEXTO = leer('contexts/ClubsHomeContext.js');
const PORTADA = leer('screens/ClubsScreen.js');

test('el contexto enriquece los rivales antes de exponerlos', () => {
  assert.match(CONTEXTO, /rivalesPorCercania/);
  assert.doesNotMatch(
    CONTEXTO,
    /suggestedRivals: rivalesData\b/,
    'el contexto volvió a exponer la lista cruda del servicio'
  );
});

test('el cálculo real viaja inyectado desde el contexto', () => {
  // La función pura no puede importar `clubMeta.js`: arrastra
  // `services/matches` y con él `./supabase`, que no carga bajo `node --test`.
  assert.match(CONTEXTO, /distanciaEntreClubesKm/);
});

test('la portada sigue leyendo el campo que ahora sí existe', () => {
  // Si alguien renombra el campo en un lado y no en el otro, vuelve el
  // «Distancia N.A.» silencioso.
  assert.match(PORTADA, /distanciaKm: rival\.distanciaKm/);
});
