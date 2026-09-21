/**
 * Pruebas de C07 y C09 de la revisión de Clubes del 21 de septiembre de 2026.
 *
 * C07. El servidor autoriza registrar y confirmar el resultado de un desafío
 * por el permiso `results` (migración 119), que un administrador puede
 * delegar en un capitán o en un jugador. El hilo del chat, en cambio, armaba
 * su contexto con «los clubes donde soy administrador» y `getChallengeCta`
 * devolvía «Solo lectura» ANTES de mirar el estado: al delegado no le
 * aparecía la acción que sí podía ejecutar, y la entrada a la pantalla de
 * resultados cuelga de esa acción.
 *
 * C09. El JSON de la alineación sobrevive a la nómina: expulsar al arquero
 * dejaba su `member_id` dentro. El tablero lo dibujaba vacío —el render busca
 * al integrante— pero el contador y la búsqueda de puestos libres sólo
 * miraban la clave, así que decía «7/7» con un puesto vacío y «No queda banca
 * disponible» con gente disponible.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { challengeCtaContext } = require('../challengeThread.js');
const { getChallengeCta } = require('../../services/clubChallengeRules.js');
const { asignacionesVigentes } = require('../formacionClub.js');

const RETADOR = 'club-retador';
const RETADO = 'club-retado';

function desafio(estado) {
  return { id: 'ch-1', estado, club_retador_id: RETADOR, club_retado_id: RETADO };
}

// ---------------------------------------------------------------------------
// C07 — el permiso delegado de resultados
// ---------------------------------------------------------------------------

test('LA REGRESIÓN DE C07: con `results` delegado ya no dice «Solo lectura»', () => {
  const cta = getChallengeCta(
    challengeCtaContext({
      challenge: desafio('esperando_resultado'),
      misClubIds: [], // no soy administrador de ninguno
      misClubIdsTodos: [RETADOR],
      misClubIdsResultados: [RETADOR],
    })
  );
  assert.equal(cta.kind, 'proponer_resultado');
  assert.equal(cta.label, 'Registrar resultado');
});

test('y puede CONFIRMAR el resultado que propuso el rival', () => {
  const cta = getChallengeCta(
    challengeCtaContext({
      challenge: desafio('esperando_resultado'),
      misClubIds: [],
      misClubIdsTodos: [RETADO],
      misClubIdsResultados: [RETADO],
      resultado: { estado: 'propuesto', club_proponente_id: RETADOR },
    })
  );
  assert.equal(cta.kind, 'confirmar_resultado');
});

test('si el resultado lo propuso SU club, espera al rival y no lo confirma solo', () => {
  // Esto es lo que se perdería si `myClubId` siguiera saliendo únicamente de
  // los clubes que administro: sin él, el delegado no se distingue del rival.
  const cta = getChallengeCta(
    challengeCtaContext({
      challenge: desafio('esperando_resultado'),
      misClubIds: [],
      misClubIdsTodos: [RETADOR],
      misClubIdsResultados: [RETADOR],
      resultado: { estado: 'propuesto', club_proponente_id: RETADOR },
    })
  );
  assert.equal(cta.kind, 'esperar_confirmacion');
});

test('el permiso de resultados NO abre el resto del ciclo del desafío', () => {
  // Aceptar un desafío o responder una prórroga son otros permisos: acá el
  // delegado de resultados tiene que seguir viendo «Solo lectura».
  for (const estado of ['pendiente', 'aceptado', 'prorroga_pedida', 'propuesta_enviada']) {
    const cta = getChallengeCta(
      challengeCtaContext({
        challenge: desafio(estado),
        misClubIds: [],
        misClubIdsTodos: [RETADO],
        misClubIdsResultados: [RETADO],
      })
    );
    assert.equal(cta.kind, 'solo_lectura', `estado ${estado}`);
  }
});

test('sin ningún permiso sigue siendo solo lectura, también en los resultados', () => {
  const cta = getChallengeCta(
    challengeCtaContext({
      challenge: desafio('esperando_resultado'),
      misClubIds: [],
      misClubIdsTodos: [RETADOR],
      misClubIdsResultados: [],
    })
  );
  assert.equal(cta.kind, 'solo_lectura');
});

test('el administrador no pierde nada: sigue actuando en todo el ciclo', () => {
  const cta = getChallengeCta(
    challengeCtaContext({
      challenge: desafio('esperando_resultado'),
      misClubIds: [RETADOR],
      misClubIdsTodos: [RETADOR],
    })
  );
  assert.equal(cta.kind, 'proponer_resultado');
});

test('un permiso en el club equivocado no sirve para este desafío', () => {
  const cta = getChallengeCta(
    challengeCtaContext({
      challenge: desafio('esperando_resultado'),
      misClubIds: [],
      misClubIdsTodos: ['otro-club'],
      misClubIdsResultados: ['otro-club'],
    })
  );
  assert.equal(cta.kind, 'solo_lectura');
});

// ---------------------------------------------------------------------------
// C09 — la alineación y los integrantes que ya no están
// ---------------------------------------------------------------------------

const PLANTEL = [{ member_id: 'm1' }, { member_id: 'm2' }, { member_id: 'm3' }];

test('LA REGRESIÓN DE C09: el puesto del expulsado deja de contar como ocupado', () => {
  const guardadas = { POR: 'expulsado', DC: 'm1', MC: 'm2' };
  const vivas = asignacionesVigentes(guardadas, PLANTEL);

  assert.deepEqual(vivas, { DC: 'm1', MC: 'm2' });
  assert.equal(Object.keys(vivas).length, 2, 'el contador ya no dice 3');
  assert.equal(vivas.POR, undefined, 'y el puesto del arquero queda libre para autocompletar');
});

test('la banca recupera a quien no está en un puesto vigente', () => {
  const vivas = asignacionesVigentes({ POR: 'expulsado', DC: 'm1' }, PLANTEL);
  const ocupados = new Set(Object.values(vivas));
  const banca = PLANTEL.filter((m) => !ocupados.has(m.member_id));
  assert.deepEqual(banca.map((m) => m.member_id), ['m2', 'm3']);
});

test('sin nadie fuera, devuelve el MISMO objeto (no dispara renders de más)', () => {
  const guardadas = { POR: 'm1', DC: 'm2' };
  assert.equal(asignacionesVigentes(guardadas, PLANTEL), guardadas);
});

test('no revienta con entradas ausentes', () => {
  assert.deepEqual(asignacionesVigentes(undefined, undefined), {});
  assert.deepEqual(asignacionesVigentes({ POR: 'm1' }, []), {});
  assert.deepEqual(asignacionesVigentes({}, PLANTEL), {});
});

test('un integrante sin `member_id` no valida a nadie', () => {
  assert.deepEqual(asignacionesVigentes({ POR: undefined, DC: 'm1' }, [{ member_id: null }, { member_id: 'm1' }]),
    { DC: 'm1' });
});

// ---------------------------------------------------------------------------
// C08 — publicar y responder son dos permisos, no uno
// ---------------------------------------------------------------------------

/**
 * Estas tres leen el archivo, como `historialClub.test.js` lee las
 * migraciones, porque la pantalla importa React Native y no se puede montar
 * acá. Lo que fijan es justo lo que se rompió: que los dos permisos vuelvan a
 * juntarse en un solo booleano. El servidor nunca se dejó —`pubChallenge`
 * publica y `answerChallenge` responde, migración 119— pero el tablero
 * ofrecía formularios que el usuario no podía terminar.
 */
const fs = require('node:fs');
const path = require('node:path');

const PANTALLA = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'screens', 'ClubChallengesScreen.js'),
  'utf8'
);

test('C08: el tablero pregunta por los dos permisos POR SEPARADO', () => {
  assert.match(PANTALLA, /getMisClubesConPermiso\(\['pubChallenge'\]\)/);
  assert.match(PANTALLA, /getMisClubesConPermiso\(\['answerChallenge'\]\)/);
  assert.doesNotMatch(
    PANTALLA,
    /getMisClubesConPermiso\(\[\s*'pubChallenge',\s*'answerChallenge'\s*\]\)/,
    'los dos permisos juntos en una consulta vuelven a producir un solo booleano'
  );
});

test('C08: ya no queda un `soyAdmin` que habilite acciones distintas', () => {
  assert.doesNotMatch(PANTALLA, /soyAdmin/,
    'ese booleano era el que mezclaba publicar con responder');
  assert.match(PANTALLA, /const puedoPublicar =/);
  assert.match(PANTALLA, /const puedoResponder =/);
});

test('C08: cada acción cuelga del permiso que la autoriza en el servidor', () => {
  // Publicar y editar: `pubChallenge`.
  assert.match(PANTALLA, /puedoPublicar=\{puedoPublicar\}/);
  assert.match(PANTALLA, /\{puedoPublicar \? \(\s*<Pressable onPress=\{\(\) => onEditar\(pub\)\}/);
  // Responder y elegir respuestas: `answerChallenge`.
  assert.match(PANTALLA, /puedoResponder=\{puedoResponder\}/);
  assert.match(PANTALLA, /\{puedoResponder && r\.estado === 'pendiente' \?/);
});
