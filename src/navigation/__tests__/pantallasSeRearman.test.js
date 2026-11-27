/**
 * Las pantallas que ahora se abren por dirección tienen que poder armarse con
 * lo que trae la URL: sólo textos.
 *
 * Al tocar dentro de la app los parámetros llegan con su tipo (un número, una
 * lista, un objeto). Al recargar llegan como texto, y lo que `direcciones.js`
 * esconde (objetos, listas) no llega. Cada caso de aquí es una pantalla que
 * con eso se rompía en silencio:
 *
 *   - «Explorar clubes» en modo rival comparaba `=== true` y con «true»
 *     mostraba el catálogo entero.
 *   - El resumen de la reserva sumaba «28000» como texto.
 *   - «Invitar jugadores» y «Ocupar horario» quedaban sin la lista que les
 *     pasaba la pantalla anterior.
 *   - Corregir la solicitud de recinto se volvía una solicitud nueva.
 *   - «Horarios» no sabía de qué recinto era y su dirección no se podía
 *     escribir.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../..');
const leer = (archivo) => fs.readFileSync(path.join(RAIZ, 'screens', archivo), 'utf8');

test('«Explorar clubes» entiende el modo rival escrito en la URL', () => {
  assert.match(leer('ExploreClubsScreen.js'), /modoRival === true \|\| route\?\.params\?\.modoRival === 'true'/);
});

test('los montos que vuelven de la URL se suman como números', () => {
  assert.match(leer('ResumenReservaScreen.js'), /Number\(precioBloque\)/);
  assert.match(leer('PagoReservaScreen.js'), /Number\(monto\)/);
  assert.match(leer('InvitarJugadoresScreen.js'), /Number\(/);
});

test('«Invitar jugadores» vuelve a pedir quiénes ya están si no se los pasaron', () => {
  const p = leer('InvitarJugadoresScreen.js');
  assert.match(p, /detalleReserva\(reservaId\)/);
  assert.match(p, /Array\.isArray\(/);
});

test('«Ocupar horario» vuelve a pedir los bloques del día si no se los pasaron', () => {
  const p = leer('OcuparHorarioScreen.js');
  assert.match(p, /calendarioDeCancha\(canchaId, fecha\)/);
  assert.match(p, /Array\.isArray\(/);
});

test('corregir la solicitud de recinto sigue siendo corregir tras recargar', () => {
  assert.match(leer('SolicitudRecintoScreen.js'), /miSolicitudPendiente\(\)/);
});

test('quien abre «Horarios» manda el recinto', () => {
  for (const archivo of ['CanchasScreen.js', 'CanchaScreen.js']) {
    const fuente = leer(archivo);
    const llamadas = [...fuente.matchAll(/navigate\('Horarios',\s*\{([^}]*)\}/g)];
    assert.ok(llamadas.length > 0, `${archivo} ya no abre Horarios`);
    for (const m of llamadas) assert.match(m[1], /complejoId/, `${archivo} abre Horarios sin el recinto`);
  }
});

test('desafiar a un club nombra al rival aunque el nombre no venga en la URL', () => {
  assert.match(leer('ClubChallengeScreen.js'), /Se avisó a \$\{rival\?\.nombre \|\| rivalNombre/);
});

test('entrar directo no le quita a la guarda el destino que pidió la persona', () => {
  // Con Main debajo hay dos guardas montadas a la vez; si la de Main
  // escribiera al último, después de iniciar sesión se caía al inicio.
  const { elegirDestinoPendiente } = require('../../utils/routing.js');
  const grupo = { name: 'ArmarReserva', params: { reservaId: 'r1' } };
  assert.deepEqual(elegirDestinoPendiente(grupo, { name: 'Main' }), grupo);
  assert.deepEqual(elegirDestinoPendiente({ name: 'Main' }, grupo), grupo);
  assert.deepEqual(elegirDestinoPendiente(null, { name: 'Main' }), { name: 'Main' });
  const auth = fs.readFileSync(path.join(RAIZ, 'contexts', 'AuthContext.js'), 'utf8');
  assert.match(auth, /pendingRef\.current = elegirDestinoPendiente\(pendingRef\.current, destination\)/);
});

test('el resultado del encuentro se arma con sólo el desafío', () => {
  // `desafio/<id>/resultado` sin `?matchId=` (un enlace escrito a mano)
  // decía «Este encuentro ya no está disponible»: el partido sale del desafío.
  assert.match(leer('ClubResultScreen.js'), /matchId \|\| \(await refreshChallenge\(challengeId\)\)\.data\?\.match_id/);
});

test('«Administradores» abierta por un admin que no es dueño no ofrece cambiar nada', () => {
  // Desde el panel sólo el dueño llega (la fila se esconde al resto), pero
  // con dirección propia cualquier admin puede escribirla. El servidor ya
  // rechaza agregar, quitar y repartir permisos; la pantalla no puede
  // ofrecer botones que siempre fallan.
  const p = leer('AdministradoresScreen.js');
  assert.match(p, /const soyDueno = admins\.some\(\(a\) => a\.userId === yo && a\.rol === 'dueño'\)/);
  for (const accion of ['setQuitar\\(a\\)', 'abrirPermisos\\(a\\)', 'setHoja\\(true\\)']) {
    const i = p.search(new RegExp(accion));
    assert.ok(i > -1, `falta ${accion}`);
    assert.match(p.slice(Math.max(0, i - 400), i), /soyDueno/, `${accion} se ofrece sin preguntar si es el dueño`);
  }
});
