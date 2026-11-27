/**
 * «Armar reserva» (el grupo de una reserva dividida) tiene que abrirse por su
 * dirección.
 *
 * EL FALLO (encontrado probando un desafío real, 2026-11-27): `ArmarReserva`
 * no estaba en `linking.config.screens`. En web React Navigation le inventaba
 * la dirección `/ArmarReserva?reservaId=…`, pero esa dirección no la
 * reconocía al abrirla: recargar la pantalla, o abrir el enlace en otra
 * pestaña, dejaba al capitán en el inicio, justo mientras le corren sus 15
 * minutos para pagar.
 *
 * Se lee el archivo, no se importa: `AppNavigator` arrastra la app entera.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../..');
const navegador = fs.readFileSync(path.join(RAIZ, 'navigation', 'AppNavigator.js'), 'utf8');

test('ArmarReserva tiene dirección propia, con el id de la reserva', () => {
  assert.match(navegador, /ArmarReserva:\s*'reserva\/:reservaId'/,
    'falta la ruta de ArmarReserva en `linking.config.screens`');
});

test('ninguna otra pantalla usa el mismo camino', () => {
  const rutas = [...navegador.matchAll(/^\s*\w+:\s*'(reserva[^']*)'/gm)].map((m) => m[1]);
  assert.deepEqual(rutas, ['reserva/:reservaId'],
    'hay más de una pantalla compitiendo por el camino de la reserva');
});

test('quien llega a ArmarReserva manda el id y nada más', () => {
  // Un objeto en los parámetros terminaría en la URL como «[object Object]»
  // (lo que pasó con «Editar club»). La pantalla se arma sola con el id.
  for (const archivo of ['MisReservasScreen.js', 'MatchDetailScreen.js', 'ChatThreadScreen.js', 'ResumenReservaScreen.js']) {
    const fuente = fs.readFileSync(path.join(RAIZ, 'screens', archivo), 'utf8');
    for (const m of fuente.matchAll(/navigate\('ArmarReserva',\s*\{([^}]*)\}/g)) {
      assert.match(m[1].trim(), /^reservaId:\s*[\w.]+$/, `${archivo} manda algo más que el id: ${m[1].trim()}`);
    }
  }
});

test('abierta directo, «volver» tiene a dónde ir', () => {
  // Sin pantalla anterior `goBack()` no hace nada y el capitán queda
  // atrapado en el grupo.
  const pantalla = fs.readFileSync(path.join(RAIZ, 'screens', 'ArmarReservaScreen.js'), 'utf8');
  assert.match(pantalla, /if \(navigation\.canGoBack\(\)\) navigation\.goBack\(\);\s*else navigation\.navigate\('MisReservas'\)/,
    'ArmarReservaScreen tiene que caer en Mis reservas cuando no hay a dónde volver');
  assert.equal((pantalla.match(/navigation\.goBack\(\)/g) || []).length, 1,
    'queda un goBack() suelto que no pasa por volver()');
});
