const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Cambiar de club tiene que sentirse inmediato, y tiene que valer para toda
 * la app.
 *
 * Lo que se reportó: «no se puede cambiar entre clubes fácilmente». Eran dos
 * cosas distintas y las dos se comprueban acá, porque las dos son fáciles de
 * deshacer sin darse cuenta en una refactorización.
 *
 * Son aserciones sobre el código fuente, como las de `SplashScreen.test.js`:
 * el proyecto no monta React en las pruebas. No demuestran que la pantalla se
 * pinte, demuestran que la decisión sigue tomada.
 */

const leer = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

test('el chip se enciende ANTES de la ronda de consultas, no después', () => {
  const src = leer('../ClubsHomeContext.js');
  const cuerpo = src.slice(
    src.indexOf('const setActiveClub = useCallback'),
    src.indexOf('useEffect(() => {\n    let vivo = true;')
  );

  assert.match(
    cuerpo,
    /activeClubId: id/,
    'setActiveClub tiene que apuntar al club nuevo en el mismo gesto'
  );
  assert.ok(
    cuerpo.indexOf('activeClubId: id') < cuerpo.indexOf('await guardarClubActivo'),
    'el estado se actualiza antes de esperar a nada: con el await primero, tocar otro club no hace NADA visible durante la recarga'
  );
  assert.match(
    cuerpo,
    /cambiandoClub: true/,
    'mientras llegan los datos del club nuevo hay que poder esconder los del anterior'
  );
});

test('lo que cambia al instante es la IDENTIDAD; lo derivado se vacía, no se hereda', () => {
  const src = leer('../ClubsHomeContext.js');
  const cuerpo = src.slice(
    src.indexOf('const setActiveClub = useCallback'),
    src.indexOf('useEffect(() => {')
  );

  // Nombre, escudo, rol y tema del club nuevo ya vienen en `clubs`
  // (`getMyClubs()`): cambiarlos no cuesta ninguna consulta.
  for (const clave of ['club:', 'role:', 'can:']) {
    assert.ok(cuerpo.includes(clave), `la identidad del club nuevo tiene que viajar ya: falta ${clave}`);
  }
  // Y lo que SÍ depende de una consulta no puede quedarse del club anterior.
  for (const clave of ['tasks: []', 'badgeCount: 0', 'nextMatch: null', 'activity: []', 'suggestedRivals: []']) {
    assert.ok(
      cuerpo.includes(clave),
      `bajo el nombre del club nuevo no puede quedar ${clave.split(':')[0]} del anterior`
    );
  }
});

test('«Pendiente para ti» no dice «Todo al día» mientras llegan las tareas del club nuevo', () => {
  const src = leer('../../screens/ClubsScreen.js');
  const seccion = src.slice(src.indexOf('Pendiente para ti'), src.indexOf('<AllClearBanner'));
  assert.match(
    seccion,
    /cambiandoClub \?/,
    'con las tareas vacías y sin esta rama, el club nuevo dice «Sin desafíos ni cambios por responder» un segundo antes de enseñar tres'
  );
});

test('el selector y el carrusel siguen en pantalla durante el cambio', () => {
  const src = leer('../../screens/ClubsScreen.js');
  const portada = src.slice(src.indexOf('function Portada({'));
  // Ninguno de los dos puede quedar detrás de un gate por `cambiandoClub`:
  // los dos SON la manera de cambiar de club, y esconderlos deja sin salida a
  // quien se equivocó — al carrusel, además, bajo el dedo que lo desliza.
  assert.doesNotMatch(
    portada,
    /cambiandoClub \? <SkeletonHome/,
    'el esqueleto de carga se lleva por delante los dos selectores'
  );
  assert.match(portada, /<ClubSwitcher/);
  assert.match(portada, /<ClubSummaryCarousel/);
});

test('Inicio muestra el club ACTIVO, no la membresía más antigua', () => {
  const src = leer('../../screens/HomeScreen.js');

  assert.doesNotMatch(
    src,
    /import \{[^}]*\bgetMyClub\b[^}]*\} from '\.\.\/services\/clubs'/,
    'getMyClub() devuelve la membresía más antigua: con tres clubes, Inicio enseñaba uno distinto del que marca el selector'
  );
  assert.match(src, /useClubsHome\(\)/, 'el club activo sale del contexto compartido');
  assert.match(
    src,
    /<ClubSwitcher/,
    'y se puede cambiar desde Inicio, sin ir a la pestaña Clubes y volver'
  );
});
