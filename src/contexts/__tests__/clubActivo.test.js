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
  assert.doesNotMatch(
    src,
    /<ClubSwitcher/,
    'la fila de chips salió de Inicio: cambiar de club es el botón de la cabecera, y tenerlo dos veces en la misma pantalla es repetir el mismo control a dos alturas'
  );
});

/* ── El selector en la cabecera de todas las pestañas ──────────────── */

const CABECERAS = {
  Inicio: '../../components/home/TacticalHeader.js',
  Partidos: '../../screens/PartidosScreen.js',
  Clubes: '../../components/club/ClubsHeader.js',
  Reservas: '../../screens/ReservasScreen.js',
  Chat: '../../components/chat/ChatInboxHeader.js',
};

test('las cinco cabeceras de marca llevan el selector de club', () => {
  for (const [pestana, ruta] of Object.entries(CABECERAS)) {
    const src = leer(ruta);
    assert.match(
      src,
      /<ClubHeaderButton/,
      `la cabecera de ${pestana} se quedó sin selector: cambiar de club vuelve a depender de ir a la pestaña Clubes`
    );
    assert.match(src, /import ClubHeaderButton from/, `${pestana} lo usa sin importarlo`);
  }
});

test('la barra del perfil NO lo lleva: medido, no estimado, no le cabe', () => {
  // A 375 px sus cinco controles dejan 63 px de título y «Mi perfil» pide 66:
  // ya estaba a tres píxeles de recortarse. Con un sexto control de 40 px el
  // título quedaba en «M…». Además es la barra de un detalle, compartida con
  // el perfil de otro jugador, donde «cambiar de club» no significa nada.
  const src = leer('../../components/player/PlayerProfileTopBar.js');
  assert.doesNotMatch(
    src,
    /<ClubHeaderButton/,
    'volver a meterlo acá deja el título en «M…»: antes hay que darle dos filas a esta barra'
  );
});

test('con un solo club el botón no se dibuja, en ninguna cabecera', () => {
  const src = leer('../../components/club/ClubHeaderButton.js');
  assert.match(
    src,
    /lista\.length < 2\) return null/,
    'sin un segundo club no hay nada que elegir, y son seis cabeceras a la vez'
  );
});

test('el botón de la cabecera usa el MISMO setActiveClub que los chips y el carrusel', () => {
  const src = leer('../../components/club/ClubHeaderButton.js');
  assert.match(src, /useClubsHome\(\)/);
  assert.match(
    src,
    /setActiveClub\(/,
    'un tercer selector con su propio estado se desincroniza de los otros dos'
  );
});

/* ── El tope de tres clubes ────────────────────────────────────────── */

test('la hoja no ofrece sumar un cuarto club a quien ya tiene tres', () => {
  const src = leer('../../components/club/ClubHeaderButton.js');
  assert.match(
    src,
    /enElTope \? \(/,
    'ofrecer «Explorar clubes» sabiendo que el trigger lo va a rechazar es peor que no ofrecerlo'
  );
  assert.ok(
    src.indexOf('enElTope ? (') < src.indexOf("navigation.navigate('ExploreClubs')"),
    'el tope tiene que decidirse ANTES de dibujar el acceso a explorar'
  );
});

test('la lista nunca enseña más de tres clubes', () => {
  const src = leer('../../components/club/ClubHeaderButton.js');
  assert.match(
    src,
    /\.slice\(0, MAX_CLUBES_POR_JUGADOR\)/,
    'una cuarta membresía sólo puede venir de datos rotos, y la hoja no la presenta como algo entre lo que elegir'
  );
});

test('el tope es UN número con nombre, no un 3 suelto en cada pantalla', () => {
  const clubs = leer('../../services/clubs.js');
  assert.match(clubs, /export const MAX_CLUBES_POR_JUGADOR = 3;/);
  // Donde el propio servicio corta, ya no queda el literal: si el tope
  // cambia, el mensaje al usuario cambia con él en vez de mentir.
  assert.doesNotMatch(
    clubs,
    /\(myClubCount \|\| 0\) >= 3/,
    'el chequeo tiene que usar la constante, no el literal'
  );
  assert.doesNotMatch(clubs, /'Ya perteneces al máximo de 3 clubes permitidos'/);
});
