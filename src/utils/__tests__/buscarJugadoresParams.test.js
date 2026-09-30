/**
 * Pruebas de buildBuscarJugadoresParams() y del cableado de
 * searchPlayers() con la RPC `buscar_jugadores` (migración 142).
 *
 * LO QUE ESTAS PRUEBAS CUIDAN, y es lo que se rompió antes: que el
 * filtro de «Visible en búsquedas» NO vuelva al cliente. Mientras
 * vivió acá —un `.eq('privacy_visible_in_search', true)` sobre una
 * tabla que se lee con `using (true)`— cualquiera lo omitía. Que la
 * regla se cumpla lo prueba el arnés SQL
 * `142_la_busqueda_de_jugadores_la_filtra_el_servidor_test.sql`; lo que
 * se prueba acá es que la app pasa por esa puerta y por ninguna otra.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildBuscarJugadoresParams } = require('../buscarJugadoresParams.js');

test('un texto vacío o con espacios viaja como null, no como cadena vacía', () => {
  assert.equal(buildBuscarJugadoresParams('').p_texto, null);
  assert.equal(buildBuscarJugadoresParams('   ').p_texto, null);
  assert.equal(buildBuscarJugadoresParams(undefined).p_texto, null);
  assert.equal(buildBuscarJugadoresParams('  juan  ').p_texto, 'juan');
});

test('los filtros de ubicación y posición viajan tal cual, o null', () => {
  const p = buildBuscarJugadoresParams('ana', {
    region: 'Metropolitana',
    comuna: 'Ñuñoa',
    posicion: 'arquero',
  });
  assert.equal(p.p_region, 'Metropolitana');
  assert.equal(p.p_comuna, 'Ñuñoa');
  assert.equal(p.p_posicion, 'arquero');

  const vacio = buildBuscarJugadoresParams('ana', {});
  assert.equal(vacio.p_region, null);
  assert.equal(vacio.p_comuna, null);
  assert.equal(vacio.p_posicion, null);
});

test('un flanco que el servidor no reconoce viaja como null', () => {
  assert.equal(buildBuscarJugadoresParams('', { flanco: 'derecho' }).p_flanco, 'derecho');
  assert.equal(buildBuscarJugadoresParams('', { flanco: 'izquierdo' }).p_flanco, 'izquierdo');
  assert.equal(buildBuscarJugadoresParams('', { flanco: 'ambos' }).p_flanco, 'ambos');
  assert.equal(buildBuscarJugadoresParams('', { flanco: 'zurdo' }).p_flanco, null);
  assert.equal(buildBuscarJugadoresParams('', { flanco: '' }).p_flanco, null);
});

test('una edad no numérica no viaja como NaN', () => {
  const p = buildBuscarJugadoresParams('', { edadMin: 'veinte', edadMax: 40 });
  assert.equal(p.p_edad_min, null);
  assert.equal(p.p_edad_max, 40);

  const cero = buildBuscarJugadoresParams('', { edadMin: 0 });
  assert.equal(cero.p_edad_min, 0, 'cero es un valor, no un vacío');
});

test('sin límite explícito se piden 30', () => {
  assert.equal(buildBuscarJugadoresParams('').p_limite, 30);
  assert.equal(buildBuscarJugadoresParams('', {}, 25).p_limite, 25);
});

test('filters nulo no revienta', () => {
  const p = buildBuscarJugadoresParams('ana', null, 10);
  assert.equal(p.p_texto, 'ana');
  assert.equal(p.p_region, null);
  assert.equal(p.p_limite, 10);
});

// ── El cableado: la regla ya no puede volver al cliente ──────────────

const profileSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'services', 'profile.js'),
  'utf8'
);

test('searchPlayers llama a la RPC del servidor', () => {
  assert.match(
    profileSrc,
    /supabase\.rpc\(\s*'buscar_jugadores'/,
    'la búsqueda tiene que pasar por buscar_jugadores()'
  );
});

test('el cliente ya no menciona privacy_visible_in_search al buscar', () => {
  // La columna sigue apareciendo en la lista de campos que Ajustes
  // puede guardar, y eso está bien. Lo que no puede volver es un filtro
  // de búsqueda escrito de este lado.
  assert.doesNotMatch(
    profileSrc,
    /\.eq\(\s*'privacy_visible_in_search'/,
    'el filtro de visibilidad no puede vivir en el cliente: se omite y deja de servir'
  );
});

test('no quedó nadie usando el constructor de consulta retirado', () => {
  const utils = path.join(__dirname, '..');
  assert.equal(
    fs.existsSync(path.join(utils, 'searchPlayersQuery.js')),
    false,
    'searchPlayersQuery.js se retiró con la migración 142'
  );
  assert.doesNotMatch(profileSrc, /buildSearchPlayersQuery/);
});
