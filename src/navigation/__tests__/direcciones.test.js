/**
 * Toda pantalla con sesión se abre por su dirección, y al abrirla directo
 * «volver» tiene a dónde ir.
 *
 * EL FALLO (2026-11-27): unas cincuenta pantallas no tenían dirección. La
 * web les inventaba una (`/ClubMembers?clubId=…`) que después no reconocía:
 * recargar devolvía al inicio. Lo vimos primero en «Armar reserva», con el
 * capitán a mitad de sus 15 minutos para pagar.
 *
 * No se prueba leyendo el texto: cada dirección pasa por las mismas
 * funciones de React Navigation que usa la app, ida y vuelta.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../..');
const NUCLEO = path.resolve(RAIZ, '../node_modules/@react-navigation/core/lib/module');
const { getStateFromPath } = require(path.join(NUCLEO, 'getStateFromPath.js'));
const { getPathFromState } = require(path.join(NUCLEO, 'getPathFromState.js'));
const { DIRECCIONES, DEBAJO, SIN_SESION, conPantallaDeAbajo } = require('../direcciones.js');

const navegador = fs.readFileSync(path.join(RAIZ, 'navigation', 'AppNavigator.js'), 'utf8');
const pestanas = fs.readFileSync(path.join(RAIZ, 'navigation', 'MainTabs.js'), 'utf8');
const config = { screens: DIRECCIONES };

/** Las pantallas que pasan por `withAuthGuard` (las que piden sesión). */
const CON_SESION = [...navegador.matchAll(/withAuthGuard\(\s*\w+\s*,\s*'(\w+)'\s*\)/g)].map((m) => m[1]);

/**
 * Cómo llega cada pantalla, con los parámetros que de verdad le mandan
 * quienes la abren (objetos incluidos). Si agregas una pantalla con sesión,
 * agrégala aquí: la primera prueba lo exige.
 */
const ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const LLEGADAS = {
  ChatThread: { threadKey: `challenge:${ID}` },
  ChatDetails: { threadKey: `club:${ID}`, title: 'SixSiete', fotoUrl: 'https://x.test/f.jpg' },
  UserProfile: { userId: ID },
  EditProfile: {},
  TrustScoreHistory: {},
  Settings: {},
  VerificarTelefono: {},
  BlockedUsers: {},
  MfaSetup: {},
  ReportarProblema: {},
  Moderacion: {},
  Friends: {},
  Notifications: {},
  Saldo: {},
  CreateClub: {},
  ExploreClubs: { modoRival: true, retadorClubId: ID },
  ClubDetail: { clubId: ID },
  EditClub: { clubId: ID },
  ClubMembers: { clubId: ID },
  ClubInvite: { clubId: ID, clubNombre: 'SixSiete' },
  ClubLineup: { clubId: ID },
  ClubGallery: { clubId: ID },
  ClubHistory: { clubId: ID, clubNombre: 'SixSiete' },
  ClubMatchCalendar: { clubId: ID, clubNombre: 'SixSiete' },
  ClubChallenges: { clubId: ID, prefillFecha: '2026-12-05' },
  PermisosClub: { clubId: ID, club: { id: ID, nombre: 'SixSiete' } },
  ClubChallenge: { rivalClubId: ID, rivalNombre: 'Los Papi', rivalFotoUrl: 'https://x.test/f.jpg' },
  ClubProposal: { challengeId: ID, modo: 'revisar', proposalId: ID },
  ClubResult: { challengeId: ID, matchId: ID },
  MatchDetail: { matchId: ID },
  ManageMatch: { matchId: ID },
  MatchSpot: { matchId: ID },
  MatchRequestStatus: { matchId: ID },
  EditMatch: { matchId: ID },
  ClubMatchRoster: { matchId: ID },
  ClubMatchChange: { matchId: ID, challengeId: ID },
  RateMatch: { matchId: ID },
  CreateMatch: {},
  ComplejoDetail: { complejoId: ID },
  ElegirCancha: { complejoId: ID },
  FechaHora: { complejoId: ID, canchaId: ID, fecha: '2026-11-28', cercaDe: '20:00' },
  Resumen: { complejoId: ID, canchaId: ID, fecha: '2026-11-28', fechaLabel: 'sáb 28 nov', horaInicio: '20:00', horaFin: '21:00', precioBloque: 28000 },
  MisReservas: {},
  ArmarReserva: { reservaId: ID },
  PagoReserva: { reservaId: ID, monto: 28000, resumen: { recinto: 'X', cancha: 'Y', cuando: 'Z' } },
  InvitarJugadores: { reservaId: ID, faltan: 2, yaEstan: [ID], modalidad: 'jugadores' },
  MisRecintos: {},
  CrearRecinto: {},
  SolicitudRecinto: { corregir: { id: ID, nombre: 'Recinto', fotos: [] } },
  ReservaRecinto: { reservaId: ID },
  PanelRecinto: { complejoId: ID, nombre: 'Recinto' },
  AgendaRecinto: { complejoId: ID, nombre: 'Recinto' },
  CalendarioCancha: { complejoId: ID, canchaId: ID, nombre: 'Recinto' },
  OcuparHorario: { complejoId: ID, canchaId: ID, canchaNombre: 'Cancha 2', fecha: '2026-11-28', desde: '20:00', slots: [{ hora_inicio: '20:00' }] },
  Canchas: { complejoId: ID, nombre: 'Recinto', modo: 'horarios' },
  Cancha: { complejoId: ID, canchaId: ID, complejoNombre: 'Recinto' },
  Horarios: { complejoId: ID, canchaId: ID, canchaNombre: 'Cancha 2', duracionSlotMin: 60 },
  Tarifas: { complejoId: ID, canchaId: ID },
  Cobros: { complejoId: ID, nombre: 'Recinto' },
  FichaRecinto: { complejoId: ID },
  Administradores: { complejoId: ID, nombre: 'Recinto' },
};

const ida = (name, params) => getPathFromState({ index: 0, routes: [{ name, params }] }, config);
const arriba = (estado) => estado.routes[estado.routes.length - 1];

test('si esto falla, el resto no prueba nada: se leen las pantallas con sesión', () => {
  assert.ok(CON_SESION.length >= 60, `se leyeron ${CON_SESION.length} pantallas con sesión`);
});

test('toda pantalla con sesión tiene dirección y está entre las probadas', () => {
  const sinDireccion = CON_SESION.filter((n) => n !== 'Main' && !DIRECCIONES[n]);
  assert.deepEqual(sinDireccion, [], `sin dirección: ${sinDireccion.join(', ')}`);
  const sinProbar = CON_SESION.filter((n) => n !== 'Main' && !(n in LLEGADAS));
  assert.deepEqual(sinProbar, [], `agrega a LLEGADAS: ${sinProbar.join(', ')}`);
});

test('toda pestaña de Main tiene dirección, salvo el botón de publicar', () => {
  const nombres = [...pestanas.matchAll(/<Tab\.Screen name="(\w+)"/g)].map((m) => m[1]);
  assert.ok(nombres.length >= 6);
  const faltan = nombres.filter((n) => n !== 'CreateTab' && !DIRECCIONES.Main.screens[n]);
  assert.deepEqual(faltan, []);
});

test('ida y vuelta: la dirección vuelve a abrir la misma pantalla con su id', () => {
  for (const [name, params] of Object.entries(LLEGADAS)) {
    const url = ida(name, params);
    assert.ok(!/^\/[A-Z]/.test(url), `${name} sale con un camino inventado: ${url}`);
    const estado = getStateFromPath(url, config);
    assert.ok(estado, `${name}: «${url}» no se reconoce`);
    const r = arriba(estado);
    assert.equal(r.name, name, `«${url}» abre ${r.name} y no ${name}`);
    for (const id of ['clubId', 'matchId', 'reservaId', 'complejoId', 'canchaId', 'challengeId', 'userId', 'threadKey', 'rivalClubId']) {
      if (params[id] !== undefined) assert.equal(r.params?.[id], params[id], `${name} pierde ${id} en «${url}»`);
    }
  }
});

test('ningún objeto ni lista termina escrito en la URL', () => {
  for (const [name, params] of Object.entries(LLEGADAS)) {
    const url = ida(name, params);
    assert.ok(!url.includes('object'), `${name}: ${url}`);
    const consulta = url.split('?')[1] || '';
    assert.ok(!/fotoUrl|rivalFotoUrl|yaEstan|slots|resumen/i.test(consulta), `${name} escribe en la URL algo que no sirve: ${url}`);
  }
});

test('dos pantallas no comparten camino', () => {
  const vistos = new Map();
  for (const name of Object.keys(LLEGADAS)) {
    const url = ida(name, LLEGADAS[name]).split('?')[0];
    assert.ok(!vistos.has(url), `${name} y ${vistos.get(url)} comparten «${url}»`);
    vistos.set(url, name);
  }
});

test('abierta directo, toda pantalla con sesión queda sobre Main, con su cadena', () => {
  for (const [name, params] of Object.entries(LLEGADAS)) {
    const estado = conPantallaDeAbajo(getStateFromPath(ida(name, params), config));
    assert.equal(estado.routes[0].name, 'Main', `${name} no tiene Main debajo`);
    assert.equal(arriba(estado).name, name);
    assert.equal(estado.index, estado.routes.length - 1, `${name}: el foco no queda en la de arriba`);
    // Cada pantalla de abajo también tiene que poder abrirse sola.
    for (const r of estado.routes.slice(1, -1)) {
      const url = ida(r.name, r.params || {});
      assert.ok(!url.includes('undefined'), `${name} deja debajo ${r.name} sin su id: ${url}`);
      assert.equal(arriba(getStateFromPath(url, config)).name, r.name);
    }
  }
});

test('las cadenas que importan llevan a donde se llegaría tocando', () => {
  const cadena = (url) => conPantallaDeAbajo(getStateFromPath(url, config)).routes.map((r) => r.name);
  assert.deepEqual(cadena(`/reserva/${ID}/invitar`), ['Main', 'MisReservas', 'ArmarReserva', 'InvitarJugadores']);
  assert.deepEqual(cadena(`/clubes/${ID}/invitar`), ['Main', 'ClubDetail', 'ClubMembers', 'ClubInvite']);
  assert.deepEqual(cadena(`/desafio/${ID}/propuesta`), ['Main', 'ChatThread', 'ClubProposal']);
  assert.deepEqual(cadena(`/mis-recintos/${ID}/horarios/${ID}`), ['Main', 'MisRecintos', 'PanelRecinto', 'Canchas', 'Horarios']);
  assert.deepEqual(cadena('/perfil/ajustes/dos-pasos'), ['Main', 'Settings', 'MfaSetup']);
  // La propuesta vuelve a la conversación de ESE desafío.
  const chat = conPantallaDeAbajo(getStateFromPath(`/desafio/${ID}/propuesta`, config)).routes[1];
  assert.equal(chat.params.threadKey, `challenge:${ID}`);
  // Y Main abre en la pestaña de donde cuelga.
  const main = conPantallaDeAbajo(getStateFromPath('/perfil/ajustes', config)).routes[0];
  assert.equal(main.state.routes[0].name, 'ProfileTab');
});

test('las páginas sin sesión y las pestañas no cambian', () => {
  for (const url of ['/terminos', '/privacidad', '/cookies', '/eliminar-cuenta', '/inicio', '/perfil', '/reservas']) {
    const antes = getStateFromPath(url, config);
    assert.deepEqual(conPantallaDeAbajo(antes), antes, url);
  }
  assert.equal(conPantallaDeAbajo(undefined), undefined);
  for (const n of SIN_SESION) assert.ok(!CON_SESION.includes(n), `${n} pide sesión y está entre las sin sesión`);
});

test('toda regla de DEBAJO es de una pantalla que existe', () => {
  for (const n of Object.keys(DEBAJO)) assert.ok(DIRECCIONES[n], `DEBAJO nombra ${n}, que no tiene dirección`);
});

test('el navegador usa estas direcciones y les pone la pantalla de abajo', () => {
  assert.match(navegador, /import \{ DIRECCIONES, conPantallaDeAbajo \} from '\.\/direcciones'/);
  assert.match(navegador, /getStateFromPath: \(camino, opciones\) => conPantallaDeAbajo\(getStateFromPath\(camino, opciones\)\)/);
});
