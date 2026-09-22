/**
 * Las reglas de amistad que no son puras, pero sí comprobables.
 *
 * POR QUÉ ESTA PRUEBA LEE ARCHIVOS. Los tres fallos que cubre no están dentro
 * de ninguna función pura: son la FORMA en que el servicio habla con la base
 * y con la pantalla.
 *
 *   · «Agregar amigo» decía «Solicitud enviada» sin enviar nada, porque
 *     bastaba con que existiera una fila —en cualquier estado— para devolver
 *     `existed: true` sin error. La interfaz trata 'rejected' y 'blocked'
 *     como «sin relación», así que el botón se seguía ofreciendo.
 *   · Un fallo de red se veía igual que «no tienes amigos»: las tres listas
 *     devolvían un arreglo pelado y se tragaban el error, y por eso el
 *     `catch` de `FriendsScreen` era inalcanzable.
 *   · Aceptar o rechazar actualizaba por `id` sin mirar el estado, así que
 *     una tarjeta vieja podía revivir algo ya resuelto.
 *
 * Mismo patrón que `contexts/__tests__/badgeDeDesafios.test.js`.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/** El fuente sin comentarios: un comentario que explica el defecto lo cita. */
const soloCodigo = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SERVICIO = soloCodigo(leer('services/friends.js'));
const PANTALLA = soloCodigo(leer('screens/FriendsScreen.js'));
const BLOQUEADOS = soloCodigo(leer('screens/BlockedUsersScreen.js'));

/** El cuerpo de una función exportada del servicio. */
function cuerpoDe(fuente, nombre) {
  const i = fuente.indexOf(`export async function ${nombre}(`);
  assert.notEqual(i, -1, `no existe ${nombre}`);
  const siguiente = fuente.indexOf('\nexport ', i + 1);
  return fuente.slice(i, siguiente === -1 ? undefined : siguiente);
}

// ── Enviar una solicitud ────────────────────────────────────────────

test('un rechazo previo NO cuenta como «ya existe»', () => {
  const fn = cuerpoDe(SERVICIO, 'sendFriendRequest');
  // La condición tiene que nombrar los dos estados que de verdad bloquean.
  assert.match(
    fn,
    /existing\.status === 'pending' \|\| existing\.status === 'accepted'/,
    'volvió a cortar ante cualquier fila existente'
  );
  assert.doesNotMatch(
    fn,
    /if \(existing\) \{\s*return \{ data: existing/,
    'volvió a devolver existed: true sin mirar el estado'
  );
});

test('un rechazo se reintenta borrando la fila, que es lo único que la RLS permite', () => {
  // Sólo el addressee puede hacer UPDATE (`friendships_update_addressee`),
  // así que revivir la fila no es opción para quien la envió; borrar sí.
  const fn = cuerpoDe(SERVICIO, 'sendFriendRequest');
  assert.match(fn, /\.from\('friendships'\)\s*\.delete\(\)\s*\.eq\('id', existing\.id\)/);
});

test('un bloqueo no se borra, y su mensaje es el mismo que el de privacidad', () => {
  const fn = cuerpoDe(SERVICIO, 'sendFriendRequest');
  assert.match(fn, /existing\.status === 'blocked'/);
  // Dos textos distintos dejarían distinguir «me bloqueó» de «no acepta
  // solicitudes», que es justo lo que el bloqueo no debe revelar.
  assert.match(fn, /PRIVACY_BLOCKED_MESSAGE/);
});

// ── Aceptar y rechazar ──────────────────────────────────────────────

test('aceptar y rechazar sólo actúan sobre una solicitud pendiente', () => {
  for (const nombre of ['acceptFriendRequest', 'rejectFriendRequest']) {
    assert.match(
      cuerpoDe(SERVICIO, nombre),
      /\.eq\('status', 'pending'\)/,
      `${nombre} puede revivir una solicitud ya resuelta`
    );
  }
});

// ── Un error no es una lista vacía ──────────────────────────────────

test('las tres listas devuelven { data, error }, no un arreglo pelado', () => {
  for (const nombre of ['listMyFriends', 'listIncomingRequests', 'listOutgoingRequests']) {
    const fn = cuerpoDe(SERVICIO, nombre);
    assert.match(fn, /return \{ data: \[\], error \}/, `${nombre} se traga el error`);
    assert.doesNotMatch(
      fn,
      /if \(error \|\| !data\) return \[\]/,
      `${nombre} volvió a confundir un fallo con un vacío`
    );
  }
});

test('la pantalla de Amigos pinta ese error en vez del vacío feliz', () => {
  assert.match(PANTALLA, /setError\(Boolean\(inc\.error \|\| out\.error \|\| frs\.error\)\)/);
  assert.match(PANTALLA, /setIncoming\(inc\.data \|\| \[\]\)/);
});

// ── Lo que se acaba de responder no desaparece ──────────────────────

test('una solicitud respondida sigue en pantalla después de la recarga', () => {
  // `load()` sólo devuelve las PENDIENTES, así que sin conservar la copia la
  // fila resuelta —y su atajo «Abrir chat»— se borraba de un parpadeo.
  assert.match(PANTALLA, /const recibidas = useMemo/);
  assert.match(PANTALLA, /solicitud: request/);
  assert.match(
    PANTALLA,
    /if \(recibidas\.length === 0\)/,
    'el estado vacío volvió a mirar sólo las pendientes'
  );
});

// ── Desbloquear no falla en silencio ────────────────────────────────

test('un fallo al desbloquear se le dice a la persona', () => {
  const i = BLOQUEADOS.indexOf('const handleUnblock');
  assert.notEqual(i, -1);
  const fn = BLOQUEADOS.slice(i, BLOQUEADOS.indexOf('\n  };', i));
  assert.match(fn, /notify\(/, 'desbloquear volvió a fallar en silencio');
  assert.doesNotMatch(fn, /if \(err\) return;/);
});
