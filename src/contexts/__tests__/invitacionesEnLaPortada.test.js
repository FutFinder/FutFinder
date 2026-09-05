/**
 * Las invitaciones recibidas llegan a «Pendiente para ti» y al badge.
 *
 * POR QUÉ ESTA PRUEBA LEE ARCHIVOS. El defecto no estaba dentro de ninguna
 * función: `<Invitaciones>` se dibujaba en `SinClub` y en
 * `SolicitudEnRevision`, y en `Portada` no. Nadie estaba «mal»; faltaba un
 * camino. Y el contexto sólo calculaba tareas cuando había club activo, así
 * que a quien no tenía ninguno el badge le decía 0 teniendo una invitación
 * encima. Ninguna prueba de lógica pura ve eso.
 *
 * Mismo patrón que `rutasPrivadas.test.js`, `sesionCableado.test.js` y
 * `badgeDeClubes.test.js`.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/**
 * El fuente sin comentarios.
 *
 * Hace falta: un comentario que EXPLICA el defecto suele citar el código que
 * lo causaba —«antes esto forzaba `badgeCount: 0`»— y una prueba que busque
 * ese texto se dispararía con la explicación en vez de con el defecto.
 */
const soloCodigo = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CONTEXTO = leer('contexts/ClubsHomeContext.js');
const PANTALLA = leer('screens/ClubsScreen.js');
const SERVICIO = leer('services/clubs.js');

/** El cuerpo de una función `function Nombre(...) { … }` de nivel superior. */
function cuerpoDe(fuente, nombre) {
  const i = fuente.indexOf(`function ${nombre}(`);
  assert.notEqual(i, -1, `no encontré la función ${nombre}`);
  const j = fuente.indexOf('\nfunction ', i + 1);
  return fuente.slice(i, j === -1 ? undefined : j);
}

test('el contexto entrega las invitaciones a normalizarTareas', () => {
  assert.match(CONTEXTO, /invitaciones:/, 'las invitaciones no viajan como fuente de tareas');
});

test('el badge cuenta las invitaciones también SIN club activo', () => {
  // La rama de «sin club» devolvía ESTADO_INICIAL, con tasks: [] y
  // badgeCount: 0. Con una invitación pendiente eso es mentira: la barra
  // decía 0 y había algo que responder.
  const i = CONTEXTO.indexOf('if (!activeId)');
  assert.notEqual(i, -1, 'ya no existe la rama de «sin club activo»');
  const rama = soloCodigo(CONTEXTO.slice(i, i + 1400));
  assert.match(rama, /normalizarTareas|tareasDeInvitaciones/,
    'la rama sin club activo no calcula tareas, así que el badge no las cuenta');
  assert.doesNotMatch(rama, /badgeCount: 0/,
    'la rama sin club activo sigue forzando el badge a 0');
});

test('la portada dibuja las invitaciones como tarea, no como bloque aparte', () => {
  // Si `Portada` volviera a montar <Invitaciones>, la misma invitación
  // saldría dos veces: una como tarjeta de tarea y otra como fila suelta.
  const portada = cuerpoDe(PANTALLA, 'Portada');
  assert.doesNotMatch(portada, /<Invitaciones/,
    'Portada monta <Invitaciones> y duplicaría lo que ya sale como tarea');
  assert.match(portada, /PendingTaskCard/);
});

test('los estados sin club conservan su bloque de invitaciones', () => {
  // Ahí NO hay lista de tareas que las muestre, así que quitarlo las
  // volvería invisibles otra vez, que es justo el defecto que se arregla.
  assert.match(cuerpoDe(PANTALLA, 'SinClub'), /<Invitaciones/);
  assert.match(cuerpoDe(PANTALLA, 'SolicitudEnRevision'), /<Invitaciones/);
});

test('la portada sabe responder aceptar y rechazar desde la tarjeta', () => {
  assert.match(PANTALLA, /onAccionTarea|onResponderInvitacion/,
    'no hay manejador para las dos acciones de la tarjeta de invitación');
  assert.match(PANTALLA, /respondToRequest/);
});

test('listMyInvitations cuenta los integrantes de cada club', () => {
  // La tarjeta del explorador decía «0 integrantes» para un club con dos:
  // `listMyInvitations` nunca traía `total_miembros` y `ClubExplorerCard`
  // cae a 0. El mismo dato lo necesita la tarea de la portada.
  const i = SERVICIO.indexOf('export async function listMyInvitations');
  assert.notEqual(i, -1);
  const fn = SERVICIO.slice(i, SERVICIO.indexOf('\nexport ', i + 1));
  assert.match(fn, /total_miembros/,
    'listMyInvitations no cuenta miembros: la tarjeta dirá «0 integrantes»');
  assert.match(fn, /club_members/);
});

test('el destino de una tarea usa SU club, no el activo', () => {
  // Trampa latente: la tarea de invitación apunta a `ClubDetail`, y el mapa
  // de parámetros mandaba siempre `clubId: activeClubId`. Hoy no se dispara
  // —la tarjeta con acciones no navega— pero cualquiera que le devuelva el
  // `onPress` llevaría al club equivocado, y en el estado sin club activo
  // `activeClubId` es `null`.
  assert.match(PANTALLA, /ClubDetail: \{ clubId: tarea\.clubId \|\| activeClubId \}/,
    'onTarea sigue mandando siempre el club activo');
});
