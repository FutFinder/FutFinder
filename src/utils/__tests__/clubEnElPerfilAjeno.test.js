/**
 * Pruebas del club en el perfil de OTRA persona.
 *
 * EL FALLO ERA UNA AFIRMACIÓN SIN MIRAR. `ProfileScreen` calculaba
 * `clubActual = isOwnProfile ? misClubs[0]?.club?.nombre : null`, así que
 * en un perfil ajeno siempre valía `null` y la ficha imprimía «Sin club».
 * Se vio en vivo el 2026-10-01: el perfil público de una cuenta que
 * administra TRES clubes decía «Sin club».
 *
 * Y la guarda no era tonta: `misClubs` son MIS clubes —en un perfil ajeno
 * se cargan para «Invitar a mi club»— así que usarlos ahí habría mostrado
 * mi club en el perfil de otro, que es peor. Lo que faltaba era consultar
 * los suyos.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (...p) => path.join(__dirname, '..', '..', ...p);
const pantalla = fs.readFileSync(src('screens', 'ProfileScreen.js'), 'utf8');
const tarjeta = fs.readFileSync(src('components', 'player', 'PlayerHeroCard.js'), 'utf8');
const servicio = fs.readFileSync(src('services', 'clubs.js'), 'utf8');

test('el club de la ficha ya no depende de que el perfil sea el propio', () => {
  assert.doesNotMatch(
    pantalla,
    /clubActual\s*=\s*isOwnProfile\s*\?/,
    'ese condicional es el fallo: en un perfil ajeno devolvía null y la ficha decía «Sin club»'
  );
  assert.match(pantalla, /clubActual\s*=\s*clubsDelPerfil === null/);
});

test('los clubes de quien se mira se cargan aparte de los míos', () => {
  // Si volvieran a salir de `misClubs`, el perfil ajeno mostraría MI club.
  assert.match(pantalla, /getClubesDe\(viewUserId\)/);
  assert.match(pantalla, /setClubsDelPerfil/);
  assert.doesNotMatch(
    pantalla,
    /clubActual\s*=\s*misClubs\[0\]/,
    'misClubs son los míos: en un perfil ajeno mostrarían el club equivocado'
  );
});

test('un fallo al cargar los clubes no se disfraza de «sin club»', () => {
  // Es el mismo error que ya se corrigió en el perfil y en el estado de
  // cuenta: un hueco de datos no puede pasar por un dato.
  assert.match(pantalla, /setClubsDelPerfil\(suyos\.error \? null : suyos\.data \|\| \[\]\)/);
  assert.match(tarjeta, /clubDesconocido \? 'N\.A\.' : 'Sin club'/);
});

test('el servicio distingue «no pertenece a ninguno» de «no se pudo leer»', () => {
  const i = servicio.indexOf('export async function getClubesDe');
  assert.notEqual(i, -1, 'desapareció getClubesDe');
  const fn = servicio.slice(i, servicio.indexOf('\n}\n', i));
  assert.match(fn, /return \{ data: null, error \}/, 'un fallo viaja como error, no como lista vacía');
  assert.match(fn, /return \{ data: \[\], error: null \}/, 'sin membresías es una lista vacía SIN error');
});

test('el servicio pide sólo las columnas públicas del club', () => {
  const i = servicio.indexOf('export async function getClubesDe');
  const fn = servicio.slice(i, servicio.indexOf('\n}\n', i));
  assert.match(fn, /select\('id, nombre, foto_url, verificado'\)/);
  assert.doesNotMatch(fn, /select\('\*'\)/, 'no hace falta la fila entera del club para una ficha');
});

test('el club del perfil ajeno no lleva a mi pestaña de clubes', () => {
  // `onPressClub` navega a ClubsTab, que es MÍA. En un perfil ajeno eso
  // sería llevar a la persona a sus propios clubes desde la ficha de otro.
  assert.match(pantalla, /onPressClub=\{isOwnProfile && clubActual \?/);
});
