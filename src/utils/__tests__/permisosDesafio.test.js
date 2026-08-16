/**
 * Pruebas de quién puede responder un desafío recibido.
 *
 * QUÉ SE ARREGLA ACÁ. Dos pantallas decidían lo mismo de dos maneras
 * distintas, y las dos se equivocaban con una cuenta que administra VARIOS
 * clubes:
 *
 *   · «Avisos» comparaba `getMyClub()` —el PRIMER club por `joined_at`—
 *     contra `clubRetadoId`. Con la cuenta de prueba real, el primer club
 *     es `chatgpt2` (13 de agosto) y el retado era P51-B (14 de agosto):
 *     el aviso nuevo salía sin botones y uno viejo, dirigido justamente al
 *     primer club, sí los tenía. Ese contraste es el que delató el fallo.
 *   · «Desafíos» miraba `listMembers(clubId)` y coercía a «no soy admin»
 *     tanto el caso real como cualquier fallo de carga o sesión: el
 *     `error` del servicio se descartaba y un usuario nulo daba el mismo
 *     resultado que un jugador sin rol.
 *
 * Ahora las dos preguntan lo mismo a la misma función pura, y «no se pudo
 * averiguar» (`null`) deja de confundirse con «no eres admin» (`[]`).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  COLUMNAS_MEMBRESIA_ADMIN,
  buildMisClubesAdminQuery,
  clubesAdminDeMisClubes,
  puedeResponderDesafio,
  puedeCancelarDesafio,
} = require('../permisosDesafio.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/**
 * El archivo SIN comentarios. La comprobación es sobre el código que corre,
 * no sobre lo que explica: estos mismos archivos documentan en prosa el
 * `getMyClub()` que ya no usan, y esa mención no debe hacer fallar nada.
 */
const soloCodigo = (rel) =>
  leer(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// Los tres clubes reales de la cuenta que encontró el fallo, en el orden en
// que los devuelve `getMyClubs()` (por `joined_at` ascendente).
const CHATGPT2 = 'bacfe1c2-c802-4043-86bf-ecdb1409ca21';
const P51_B = '685b64eb-b8a1-4990-8d2a-e1fe075d2a2e';
const P51_C = '81a720ca-cfe1-49d1-97e8-b33a6d5dd18c';

/** La forma REAL de `getMyClubs()`: `{ club, miRol, totalMiembros }`. */
const MIS_CLUBES = [
  { club: { id: CHATGPT2, nombre: 'chatgpt2' }, miRol: 'admin', totalMiembros: 1 },
  { club: { id: P51_B, nombre: 'P51-B' }, miRol: 'admin', totalMiembros: 1 },
  { club: { id: P51_C, nombre: 'P51-C' }, miRol: 'admin', totalMiembros: 1 },
];

/**
 * Cliente falso encadenable, del mismo estilo que `rivalClubsQuery.test.js`:
 * aplica los filtros sobre filas en memoria y además registra qué se pidió,
 * así se comprueba el resultado y la consulta.
 */
function createFakeClient(rows) {
  let result = rows;
  const calls = [];
  const q = {
    calls,
    select(cols) {
      calls.push(['select', cols]);
      return q;
    },
    eq(col, val) {
      calls.push(['eq', col, val]);
      result = result.filter((r) => r[col] === val);
      return q;
    },
    then(resolve) {
      return Promise.resolve({ data: result, error: null }).then(resolve);
    },
  };
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      return q;
    },
  };
}

// ---------------------------------------------------------------------------
// La consulta
// ---------------------------------------------------------------------------

test('la consulta pide sólo las membresías administrativas del usuario', async () => {
  const cliente = createFakeClient([
    { club_id: CHATGPT2, user_id: 'yo', rol: 'admin' },
    { club_id: P51_B, user_id: 'yo', rol: 'admin' },
    { club_id: 'club-ajeno', user_id: 'otro', rol: 'admin' },
    { club_id: 'club-donde-juego', user_id: 'yo', rol: 'jugador' },
  ]);

  const { data } = await buildMisClubesAdminQuery(cliente, 'yo');

  assert.deepEqual(cliente.calls[0], ['from', 'club_members']);
  assert.deepEqual(cliente.calls[1], ['select', COLUMNAS_MEMBRESIA_ADMIN]);
  // El rol se filtra EN LA CONSULTA, no después: traer todas las membresías
  // para descartarlas en JavaScript es lo que hacía cara la comprobación y
  // lo que empujó a la pantalla a preguntar por un club a la vez.
  assert.ok(cliente.calls.some((c) => c[0] === 'eq' && c[1] === 'user_id' && c[2] === 'yo'));
  assert.ok(cliente.calls.some((c) => c[0] === 'eq' && c[1] === 'rol' && c[2] === 'admin'));
  assert.deepEqual(data.map((r) => r.club_id), [CHATGPT2, P51_B]);
});

// ---------------------------------------------------------------------------
// La forma de getMyClubs()
// ---------------------------------------------------------------------------

test('los ids de admin salen de la forma real de getMyClubs()', () => {
  assert.deepEqual(clubesAdminDeMisClubes(MIS_CLUBES), [CHATGPT2, P51_B, P51_C]);
});

test('un club donde sólo juego no cuenta como administrado', () => {
  const mezcla = [
    { club: { id: CHATGPT2 }, miRol: 'jugador', totalMiembros: 3 },
    { club: { id: P51_B }, miRol: 'admin', totalMiembros: 1 },
  ];
  assert.deepEqual(clubesAdminDeMisClubes(mezcla), [P51_B]);
});

test('una lista vacía o ilegible no inventa permisos', () => {
  assert.deepEqual(clubesAdminDeMisClubes([]), []);
  assert.deepEqual(clubesAdminDeMisClubes(null), []);
  assert.deepEqual(clubesAdminDeMisClubes([{ miRol: 'admin' }]), []);
});

// ---------------------------------------------------------------------------
// La regla, que ahora es UNA
// ---------------------------------------------------------------------------

test('el reto al SEGUNDO club de quien administra varios se puede responder', () => {
  // Es exactamente el caso que bloqueó la Fase 3: el retado no es el primer
  // club de la cuenta.
  const clubesAdmin = clubesAdminDeMisClubes(MIS_CLUBES);
  assert.equal(
    puedeResponderDesafio({ clubesAdmin, clubRetadoId: P51_B, estado: 'pendiente' }),
    true
  );
});

test('también el reto al primer club y al tercero', () => {
  const clubesAdmin = clubesAdminDeMisClubes(MIS_CLUBES);
  for (const id of [CHATGPT2, P51_B, P51_C]) {
    assert.equal(
      puedeResponderDesafio({ clubesAdmin, clubRetadoId: id, estado: 'pendiente' }),
      true,
      `debería poder responder el reto dirigido a ${id}`
    );
  }
});

test('un jugador sin rol administrativo no puede responder', () => {
  const clubesAdmin = clubesAdminDeMisClubes([
    { club: { id: P51_B }, miRol: 'jugador', totalMiembros: 2 },
  ]);
  assert.equal(
    puedeResponderDesafio({ clubesAdmin, clubRetadoId: P51_B, estado: 'pendiente' }),
    false
  );
});

test('el administrador de OTRO club tampoco', () => {
  const clubesAdmin = clubesAdminDeMisClubes([
    { club: { id: CHATGPT2 }, miRol: 'admin', totalMiembros: 1 },
  ]);
  assert.equal(
    puedeResponderDesafio({ clubesAdmin, clubRetadoId: P51_B, estado: 'pendiente' }),
    false
  );
});

test('un desafío que ya no está pendiente no ofrece respuesta', () => {
  const clubesAdmin = clubesAdminDeMisClubes(MIS_CLUBES);
  for (const estado of ['negociacion', 'rechazado', 'expirado', 'cancelado', 'publicado']) {
    assert.equal(
      puedeResponderDesafio({ clubesAdmin, clubRetadoId: P51_B, estado }),
      false,
      `«${estado}» no debería ofrecer aceptar ni rechazar`
    );
  }
});

test('sin estado —el aviso no lo trae— se ofrece y responde el servidor', () => {
  // El payload de `club_challenge` no incluye el estado del desafío, así que
  // esconder el botón acá sería adivinar. `aceptar_desafio` contesta «este
  // desafío ya no está pendiente», que es justo lo que hizo el aviso viejo.
  const clubesAdmin = clubesAdminDeMisClubes(MIS_CLUBES);
  assert.equal(puedeResponderDesafio({ clubesAdmin, clubRetadoId: P51_B }), true);
  assert.equal(
    puedeResponderDesafio({ clubesAdmin, clubRetadoId: P51_B, estado: null }),
    true
  );
});

test('«no se pudo averiguar» NO es «no eres admin»', () => {
  // `null` es el fallo de carga o de sesión. Ofrecer los botones sería
  // prometer una acción que quizá no se puede hacer; esconderlos en silencio
  // fue lo que dejó la Fase 3 sin explicación. La regla dice que no, y la
  // pantalla tiene que CONTARLO.
  assert.equal(
    puedeResponderDesafio({ clubesAdmin: null, clubRetadoId: P51_B, estado: 'pendiente' }),
    false
  );
  assert.equal(
    puedeResponderDesafio({ clubesAdmin: undefined, clubRetadoId: P51_B, estado: 'pendiente' }),
    false
  );
});

test('sin club retado no hay nada que responder', () => {
  const clubesAdmin = clubesAdminDeMisClubes(MIS_CLUBES);
  assert.equal(puedeResponderDesafio({ clubesAdmin, clubRetadoId: null }), false);
  assert.equal(puedeResponderDesafio({ clubesAdmin, clubRetadoId: undefined }), false);
});

// ---------------------------------------------------------------------------
// La otra mitad de la bandeja: los desafíos ENVIADOS
// ---------------------------------------------------------------------------

test('el desafío enviado lo cancela el administrador del club que lo envió', () => {
  // La bandeja tiene dos secciones y NO se deciden igual: en «Recibidos»
  // mando yo si administro el club RETADO; en «Enviados», el RETADOR. Usar
  // la misma pregunta en las dos hace desaparecer el botón «Cancelar»,
  // porque en un desafío enviado el club retado es el del rival.
  const clubesAdmin = clubesAdminDeMisClubes(MIS_CLUBES);
  assert.equal(
    puedeCancelarDesafio({ clubesAdmin, clubRetadorId: P51_B, estado: 'pendiente' }),
    true
  );
  assert.equal(
    puedeCancelarDesafio({ clubesAdmin, clubRetadorId: 'club-del-rival', estado: 'pendiente' }),
    false
  );
});

test('un desafío enviado que ya no está pendiente no se cancela', () => {
  const clubesAdmin = clubesAdminDeMisClubes(MIS_CLUBES);
  assert.equal(
    puedeCancelarDesafio({ clubesAdmin, clubRetadorId: P51_B, estado: 'negociacion' }),
    false
  );
});

test('sin saber qué clubes administro tampoco se ofrece cancelar', () => {
  assert.equal(
    puedeCancelarDesafio({ clubesAdmin: null, clubRetadorId: P51_B, estado: 'pendiente' }),
    false
  );
});

// ---------------------------------------------------------------------------
// Que no vuelvan a ser dos reglas distintas
// ---------------------------------------------------------------------------

test('Avisos y Desafíos usan la misma regla y ninguna mira un solo club', () => {
  const avisos = soloCodigo('src/screens/NotificationsScreen.js');
  const desafios = soloCodigo('src/screens/ClubChallengesScreen.js');

  for (const [nombre, fuente] of [['NotificationsScreen', avisos], ['ClubChallengesScreen', desafios]]) {
    assert.match(fuente, /puedeResponderDesafio/, `${nombre} debería usar la regla compartida`);
    assert.doesNotMatch(
      fuente,
      /getMyClub\s*\(/,
      `${nombre} no debe volver a comparar contra el PRIMER club del usuario`
    );
  }

  // La bandeja tampoco debe volver a deducir el rol de la lista de
  // integrantes de un club suelto: ahí es donde un fallo de carga se
  // disfrazaba de «no eres admin».
  assert.doesNotMatch(desafios, /listMembers\s*\(/);
});
