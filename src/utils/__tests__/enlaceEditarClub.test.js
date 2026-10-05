/**
 * «Editar club» tiene que sobrevivir a una recarga y a un enlace compartido.
 *
 * EL FALLO, EN DOS MITADES, y cada una sola no explica nada:
 *
 *   1. `EditClub` no estaba en `linking.config.screens`, así que en web la
 *      pantalla no tenía URL propia: la barra de direcciones seguía marcando
 *      la pantalla anterior y recargar devolvía a la raíz.
 *   2. `ClubDetailScreen` navegaba con el CLUB ENTERO —`navigate('EditClub',
 *      { club })`— y el formulario se llenaba de `route.params.club`. Aunque
 *      hubiera URL, un objeto no cabe en una ruta: al volver por el enlace
 *      los campos llegaban vacíos y «guardar» habría borrado la descripción,
 *      la región y la comuna del club.
 *
 * Arreglar sólo la primera deja una pantalla accesible por URL que pierde los
 * datos, que es PEOR que no tener URL. Por eso las dos pruebas van juntas.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getEditClubStatus, clubIdDeRuta } = require('../clubEdit.js');

const RAIZ = path.resolve(__dirname, '../..');
const navegador = fs.readFileSync(path.join(RAIZ, 'navigation', 'AppNavigator.js'), 'utf8');
const detalle = fs.readFileSync(path.join(RAIZ, 'screens', 'ClubDetailScreen.js'), 'utf8');

// ─── 1. La URL existe ────────────────────────────────────────────────

test('EditClub y ClubDetail tienen URL propia en linking', () => {
  // Se lee el archivo, no se importa: `AppNavigator` arrastra la app entera.
  assert.match(navegador, /EditClub:\s*'clubes\/:clubId\/editar'/,
    'falta la ruta de EditClub en `linking.config.screens`');
  assert.match(navegador, /ClubDetail:\s*'clubes\/:clubId'/,
    'falta la ruta de ClubDetail: sin ella, «volver» desde el editor no tiene a dónde');
});

test('la ruta del club no choca con la pestaña de clubes', () => {
  // `ClubsTab: 'clubes'` ya existe. Si alguien escribiera `ClubDetail:
  // 'clubes'` las dos competirían por el mismo camino.
  const rutas = [...navegador.matchAll(/^\s*\w+:\s*'(clubes[^']*)'/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(rutas)].sort(),
    ['clubes', 'clubes/:clubId', 'clubes/:clubId/editar'],
    'las rutas de clubes dejaron de ser tres caminos distintos');
});

// ─── 2. La pantalla sabe rehidratarse ────────────────────────────────

test('ClubDetail manda el id Y NADA MÁS', () => {
  // Esto lo encontró el navegador, no una prueba: mandar también el club
  // entero deja la URL en `…/editar?club=%5Bobject%20Object%5D`, porque React
  // Navigation serializa los parámetros sobrantes en la query. Compartir ESA
  // dirección resucitaba el fallo entero —`route.params.club` llegaba como la
  // CADENA `'[object Object]'`, que es verdadera, así que la pantalla creía
  // tener el club y no lo pedía— y el formulario se abría vacío.
  assert.match(detalle, /navigate\('EditClub',\s*\{\s*clubId:\s*club\.id\s*\}\)/,
    'ClubDetailScreen tiene que navegar con el id y sólo con el id');
  assert.doesNotMatch(detalle, /navigate\('EditClub',\s*\{[^}]*\bclub\b\s*[,}]/,
    'volvió a viajar el club entero: eso ensucia la URL y vacía el formulario');
});

test('un `club` que no es un objeto se trata como ausente', () => {
  // La defensa para los enlaces que ya se compartieron con la query sucia.
  const pantalla = fs.readFileSync(path.join(RAIZ, 'screens', 'EditClubScreen.js'), 'utf8');
  assert.match(pantalla, /typeof route\.params\.club === 'object'/,
    'EditClubScreen acepta cualquier `club` de la ruta, incluida la cadena "[object Object]"');
});

test('clubIdDeRuta acepta las dos formas, y prefiere el id explícito', () => {
  assert.equal(clubIdDeRuta({ clubId: 'c1' }), 'c1');
  assert.equal(clubIdDeRuta({ club: { id: 'c2' } }), 'c2');
  // Las dos a la vez es el caso normal desde dentro de la app.
  assert.equal(clubIdDeRuta({ clubId: 'c3', club: { id: 'c3' } }), 'c3');
  // Si discrepan manda la ruta: es lo que la persona pidió al abrir la URL.
  assert.equal(clubIdDeRuta({ clubId: 'c4', club: { id: 'viejo' } }), 'c4');
});

test('clubIdDeRuta no inventa un id cuando no lo hay', () => {
  // Un `undefined` que pase por aquí termina en `clubesAdmin.includes(undefined)`,
  // que es `false`: el permiso se niega, que es lo seguro.
  assert.equal(clubIdDeRuta(), null);
  assert.equal(clubIdDeRuta({}), null);
  assert.equal(clubIdDeRuta({ club: null }), null);
  assert.equal(clubIdDeRuta({ clubId: '' }), null);
});

// ─── 3. El estado de la pantalla, con el club cargándose ─────────────

test('mientras se trae el club por la URL, la pantalla espera', () => {
  assert.equal(
    getEditClubStatus({ loading: false, clubesAdmin: ['c1'], clubId: 'c1', cargandoClub: true }),
    'loading'
  );
});

test('el permiso se decide por el id, nunca por si el club se pudo leer', () => {
  // Importa el ORDEN: quien no administra el club recibe 'denied' aunque el
  // club no exista. Decidirlo al revés contaría, por la diferencia entre
  // 'denied' y 'error', qué identificadores de club son reales.
  assert.equal(
    getEditClubStatus({ loading: false, clubesAdmin: ['otro'], clubId: 'inventado', club: null }),
    'denied'
  );
  assert.equal(
    getEditClubStatus({ loading: false, clubesAdmin: [], clubId: 'inventado', club: null }),
    'denied'
  );
});

test('administro el club pero no se pudo leer: eso es un error, no un formulario vacío', () => {
  // Es el caso de la recarga con la red caída. Abrir el formulario en blanco
  // y dejar guardar habría borrado la descripción, la región y la comuna.
  assert.equal(
    getEditClubStatus({ loading: false, clubesAdmin: ['c1'], clubId: 'c1', club: null }),
    'error'
  );
  assert.equal(
    getEditClubStatus({ loading: false, clubesAdmin: ['c1'], clubId: 'c1', club: { id: 'c1' } }),
    'ready'
  );
});

test('la forma antigua, sin club ni cargandoClub, se sigue comportando igual', () => {
  // `getEditClubStatus` la llaman otras pruebas y no se le cambia el contrato:
  // sin noticia del club se asume que lo trajo quien navegó.
  assert.equal(getEditClubStatus({ loading: true, clubesAdmin: null }), 'loading');
  assert.equal(getEditClubStatus({ loading: false, clubesAdmin: null, clubId: 'c1' }), 'error');
  assert.equal(getEditClubStatus({ loading: false, clubesAdmin: [], clubId: 'c1' }), 'denied');
  assert.equal(getEditClubStatus({ loading: false, clubesAdmin: ['c1'], clubId: 'c1' }), 'ready');
});
