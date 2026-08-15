/**
 * Pruebas de la incomparecencia y de la revisión de sanciones
 * (migración 47c).
 *
 * QUÉ SE FIJA ACÁ. Lo que se puede probar sin abrir Supabase y que, cuando se
 * rompe, se rompe en silencio:
 *
 *   · NADIE INFORMA UNA INCOMPARECENCIA ANTES DE LA HORA. El servidor lo
 *     vuelve a comprobar con su propio reloj, pero el botón no puede ofrecerse
 *     antes: ofrecerlo y que falle es peor que no ofrecerlo.
 *   · «SOLICITAR REVISIÓN» APARECE ANTE CUALQUIER CANCELACIÓN O SANCIÓN, y no
 *     aparece cuando no hay ninguna medida que revisar.
 *   · Los NOMBRES de los argumentos de las tres RPC, contrastados contra la
 *     firma real de la migración. PostgREST no contesta «te faltó `p_motivo`»:
 *     contesta 404 «function not found».
 *   · Los NOMBRES de las columnas que pide la interfaz, contrastados contra el
 *     `create table`. Una sola columna inexistente hace que PostgREST rechace
 *     la consulta entera con 400.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MOTIVO_INCOMPARECENCIA_MAX,
  MOTIVO_REVISION_MAX,
  COLUMNAS_INCOMPARECENCIA,
  COLUMNAS_REVISION,
  validarMotivoIncomparecencia,
  validarMotivoRevision,
  accionesDeIncomparecencia,
  accionesDeRevision,
  argumentosReportarIncomparecencia,
  argumentosSolicitarRevision,
  comoResultadoRevision,
  textoIncomparecenciaReportada,
  textoRevisionSolicitada,
  textoRevisionResuelta,
} = require('../revisionSancion.js');

const { INCOMPARECENCIA_HORAS } = require('../../services/clubChallengeRules.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const MIGRACION = fs.readFileSync(
  path.join(RAIZ, 'supabase', 'migrations', '47c_incomparecencia_y_revisiones.sql'),
  'utf8'
);

/** Los nombres de argumento que declara una función en la migración. */
function argumentosDe(nombre) {
  const inicio = MIGRACION.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nombre}\\s*\\(`, 'i')
  );
  assert.notEqual(inicio, -1, `la migración 47c debería declarar ${nombre}`);
  const desde = MIGRACION.indexOf('(', inicio);
  const hasta = MIGRACION.indexOf(')', desde);
  return MIGRACION.slice(desde + 1, hasta)
    .split(',')
    .map((linea) => linea.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** Las columnas que declara un `create table` de la migración. */
function columnasDe(tabla) {
  const inicio = MIGRACION.search(
    new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${tabla}\\s*\\(`, 'i')
  );
  assert.notEqual(inicio, -1, `la migración 47c debería crear ${tabla}`);
  const desde = MIGRACION.indexOf('(', inicio);
  const hasta = MIGRACION.indexOf('\n);', desde);
  return MIGRACION.slice(desde + 1, hasta)
    .split('\n')
    .map((linea) => linea.replace(/--.*$/, '').trim())
    .filter((linea) => linea && !/^(constraint|check|unique|primary|foreign)/i.test(linea))
    .map((linea) => linea.split(/\s+/)[0])
    .filter(Boolean);
}

const AHORA = new Date('2026-08-14T20:00:00.000Z');
const MI_CLUB = 'club-a';
const RIVAL = 'club-b';

const DESAFIO = {
  id: 'ch-1',
  club_retador_id: MI_CLUB,
  club_retado_id: RIVAL,
  estado: 'publicado',
};

/** El partido empezó hace dos horas: dentro de la ventana de 24 h. */
const PARTIDO_PASADO = {
  id: 'm-1',
  challenge_proposal_id: 'prop-1',
  estado: 'abierto',
  hora: '2026-08-14T18:00:00.000Z',
};

const PARTIDO_FUTURO = { ...PARTIDO_PASADO, hora: '2026-08-14T23:00:00.000Z' };

// ---------------------------------------------------------------------------
// El motivo
// ---------------------------------------------------------------------------

test('la incomparecencia exige un motivo: vacío, en blanco o larguísimo se rechazan', () => {
  assert.equal(validarMotivoIncomparecencia('').ok, false);
  assert.equal(validarMotivoIncomparecencia('   ').ok, false);
  assert.equal(validarMotivoIncomparecencia(null).ok, false);
  assert.equal(validarMotivoIncomparecencia('x'.repeat(MOTIVO_INCOMPARECENCIA_MAX + 1)).ok, false);

  const bueno = validarMotivoIncomparecencia('  No llegó nadie del club rival  ');
  assert.equal(bueno.ok, true);
  assert.equal(bueno.motivo, 'No llegó nadie del club rival');
  assert.equal(bueno.error, null);
});

test('el motivo de la revisión admite más texto que el de la incomparecencia', () => {
  assert.ok(MOTIVO_REVISION_MAX > MOTIVO_INCOMPARECENCIA_MAX);
  assert.equal(validarMotivoRevision('x'.repeat(MOTIVO_REVISION_MAX)).ok, true);
  assert.equal(validarMotivoRevision('x'.repeat(MOTIVO_REVISION_MAX + 1)).ok, false);
  assert.equal(validarMotivoRevision('  ').ok, false);
});

// ---------------------------------------------------------------------------
// Informar la incomparecencia
// ---------------------------------------------------------------------------

test('antes de la hora del partido no se puede informar una incomparecencia', () => {
  const a = accionesDeIncomparecencia({
    challenge: DESAFIO,
    partido: PARTIDO_FUTURO,
    clubesAdmin: [MI_CLUB],
    ahora: AHORA,
  });

  assert.equal(a.puedeInformar, false);
  assert.match(a.bloqueo, /hora del partido/i);
});

test('pasada la hora, el administrador informa contra el club rival', () => {
  const a = accionesDeIncomparecencia({
    challenge: DESAFIO,
    partido: PARTIDO_PASADO,
    clubesAdmin: [MI_CLUB],
    ahora: AHORA,
  });

  assert.equal(a.puedeInformar, true);
  assert.equal(a.bloqueo, null);
  assert.equal(a.miClubId, MI_CLUB);
  assert.equal(a.clubReportadoId, RIVAL);
});

test('pasadas las 24 horas ya no se puede informar', () => {
  // El borde que cierra la denuncia tardía. El servidor lo vuelve a
  // comprobar con su propio reloj: acá sólo se deja de ofrecer el botón.
  const a = accionesDeIncomparecencia({
    challenge: DESAFIO,
    partido: { ...PARTIDO_PASADO, hora: '2026-08-13T19:00:00.000Z' }, // 25 h antes
    clubesAdmin: [MI_CLUB],
    ahora: AHORA,
  });

  assert.equal(a.puedeInformar, false);
  assert.match(a.bloqueo, /plazo|24/i);
});

test('justo dentro de las 24 horas todavía se puede', () => {
  const a = accionesDeIncomparecencia({
    challenge: DESAFIO,
    partido: { ...PARTIDO_PASADO, hora: '2026-08-13T20:30:00.000Z' }, // 23,5 h antes
    clubesAdmin: [MI_CLUB],
    ahora: AHORA,
  });

  assert.equal(a.puedeInformar, true);
});

test('el plazo del cliente es el mismo que el del servidor', () => {
  // Espejo de `desafio_reglas() ->> 'incomparecencia_horas'`. Si algún día
  // cambian por separado, el botón se ofrece cuando el servidor ya no acepta.
  assert.equal(INCOMPARECENCIA_HORAS, 24);
  assert.match(MIGRACION, /'incomparecencia_horas',\s*24/);
});

test('un informe mío ya presentado cierra la puerta y lo dice', () => {
  const a = accionesDeIncomparecencia({
    challenge: DESAFIO,
    partido: PARTIDO_PASADO,
    clubesAdmin: [MI_CLUB],
    reportes: [{ id: 'rep-1', club_reportante_id: MI_CLUB, club_reportado_id: RIVAL }],
    ahora: AHORA,
  });

  assert.equal(a.puedeInformar, false);
  assert.equal(a.yaInformada, true);
  assert.match(a.bloqueo, /ya (se )?informas?te|ya se informó/i);
});

test('que me hayan acusado a mí no me impide informar al rival', () => {
  // Un informe por partido y por club acusado: el informe del rival contra
  // mi club no es el mío, y esconder el botón por eso dejaría al acusado sin
  // poder contar su versión por la misma vía.
  const a = accionesDeIncomparecencia({
    challenge: DESAFIO,
    partido: PARTIDO_PASADO,
    clubesAdmin: [MI_CLUB],
    reportes: [{ id: 'rep-1', club_reportante_id: RIVAL, club_reportado_id: MI_CLUB }],
    ahora: AHORA,
  });

  assert.equal(a.puedeInformar, true);
  assert.equal(a.yaInformada, false);
  assert.equal(a.reporteContraMiClub.id, 'rep-1');
});

test('quien administra los dos clubes no informa contra ninguno', () => {
  const a = accionesDeIncomparecencia({
    challenge: DESAFIO,
    partido: PARTIDO_PASADO,
    clubesAdmin: [MI_CLUB, RIVAL],
    ahora: AHORA,
  });

  assert.equal(a.puedeInformar, false);
  assert.equal(a.administroLosDos, true);
  assert.match(a.bloqueo, /los dos clubes/i);
});

test('quien no administra ninguno de los dos clubes tampoco informa', () => {
  const a = accionesDeIncomparecencia({
    challenge: DESAFIO,
    partido: PARTIDO_PASADO,
    clubesAdmin: ['club-ajeno'],
    ahora: AHORA,
  });

  assert.equal(a.puedeInformar, false);
  assert.match(a.bloqueo, /administrador/i);
});

test('un encuentro cancelado no admite incomparecencia', () => {
  const a = accionesDeIncomparecencia({
    challenge: { ...DESAFIO, estado: 'cancelado' },
    partido: { ...PARTIDO_PASADO, estado: 'cancelado' },
    clubesAdmin: [MI_CLUB],
    ahora: AHORA,
  });

  assert.equal(a.puedeInformar, false);
  assert.match(a.bloqueo, /cancel/i);
});

test('sin partido de clubes la barra no se dibuja y no explica nada', () => {
  const a = accionesDeIncomparecencia({
    challenge: DESAFIO,
    partido: null,
    clubesAdmin: [MI_CLUB],
    ahora: AHORA,
  });

  assert.equal(a.esDeClubes, false);
  assert.equal(a.puedeInformar, false);
  assert.equal(a.bloqueo, null);
});

// ---------------------------------------------------------------------------
// Pedir la revisión
// ---------------------------------------------------------------------------

const SANCION_PROVISIONAL = {
  id: 'san-1',
  club_id: MI_CLUB,
  challenge_id: 'ch-1',
  tipo: 'incomparecencia',
  estado: 'provisional',
  motivo: 'No se presentó al encuentro: no llegaron',
  inicio_at: '2026-08-14T19:00:00.000Z',
  fin_at: '2026-08-28T19:00:00.000Z',
};

test('con una sanción de mi club encima, la revisión se puede pedir', () => {
  const a = accionesDeRevision({
    challenge: { ...DESAFIO, estado: 'bloqueado_sancion' },
    partido: PARTIDO_PASADO,
    clubesAdmin: [MI_CLUB],
    sanciones: [SANCION_PROVISIONAL],
    ahora: AHORA,
  });

  assert.equal(a.puedeSolicitar, true);
  assert.equal(a.tipo, 'sancion');
  assert.equal(a.sancionId, 'san-1');
  assert.equal(a.bloqueo, null);
});

test('una cancelación sin sanción también se puede revisar', () => {
  const a = accionesDeRevision({
    challenge: { ...DESAFIO, estado: 'cancelado' },
    partido: { ...PARTIDO_PASADO, estado: 'cancelado' },
    clubesAdmin: [RIVAL],
    sanciones: [],
    ahora: AHORA,
  });

  assert.equal(a.puedeSolicitar, true);
  assert.equal(a.tipo, 'cancelacion');
  assert.equal(a.sancionId, null);
});

test('sin cancelación ni sanción no hay nada que revisar', () => {
  const a = accionesDeRevision({
    challenge: DESAFIO,
    partido: PARTIDO_PASADO,
    clubesAdmin: [MI_CLUB],
    sanciones: [],
    ahora: AHORA,
  });

  assert.equal(a.puedeSolicitar, false);
  assert.equal(a.tipo, null);
  assert.match(a.bloqueo, /revisar/i);
});

test('una sanción de OTRO club no habilita la revisión propia', () => {
  const a = accionesDeRevision({
    challenge: DESAFIO,
    partido: PARTIDO_PASADO,
    clubesAdmin: [MI_CLUB],
    sanciones: [{ ...SANCION_PROVISIONAL, club_id: RIVAL }],
    ahora: AHORA,
  });

  assert.equal(a.puedeSolicitar, false);
});

test('una revisión pendiente se muestra en vez de ofrecer otra', () => {
  const revision = {
    id: 'rev-1',
    club_id: MI_CLUB,
    challenge_id: 'ch-1',
    sancion_id: 'san-1',
    estado: 'pendiente',
  };
  const a = accionesDeRevision({
    challenge: { ...DESAFIO, estado: 'bloqueado_sancion' },
    partido: PARTIDO_PASADO,
    clubesAdmin: [MI_CLUB],
    sanciones: [SANCION_PROVISIONAL],
    revisiones: [revision],
    ahora: AHORA,
  });

  assert.equal(a.puedeSolicitar, false);
  assert.equal(a.revision.id, 'rev-1');
  assert.match(a.bloqueo, /en cola|pendiente|revisando/i);
});

test('una medida ya revisada no se vuelve a revisar', () => {
  const a = accionesDeRevision({
    challenge: { ...DESAFIO, estado: 'bloqueado_sancion' },
    partido: PARTIDO_PASADO,
    clubesAdmin: [MI_CLUB],
    sanciones: [SANCION_PROVISIONAL],
    revisiones: [{
      id: 'rev-1',
      club_id: MI_CLUB,
      challenge_id: 'ch-1',
      sancion_id: 'san-1',
      estado: 'resuelta',
      decision: 'mantenida',
    }],
    ahora: AHORA,
  });

  assert.equal(a.puedeSolicitar, false);
  assert.match(a.bloqueo, /ya se revisó|ya fue revisada/i);
});

test('quien administra los dos clubes no pide la revisión de ninguno', () => {
  const a = accionesDeRevision({
    challenge: { ...DESAFIO, estado: 'cancelado' },
    partido: { ...PARTIDO_PASADO, estado: 'cancelado' },
    clubesAdmin: [MI_CLUB, RIVAL],
    sanciones: [],
    ahora: AHORA,
  });

  assert.equal(a.puedeSolicitar, false);
  assert.match(a.bloqueo, /los dos clubes/i);
});

// ---------------------------------------------------------------------------
// Las RPC
// ---------------------------------------------------------------------------

test('los argumentos de reportar_incomparecencia son los de la migración', () => {
  const args = argumentosReportarIncomparecencia('ch-1', '  no llegaron  ');
  assert.deepEqual(Object.keys(args).sort(), argumentosDe('reportar_incomparecencia').sort());
  assert.equal(args.p_challenge_id, 'ch-1');
  assert.equal(args.p_motivo, 'no llegaron');
});

test('los argumentos de solicitar_revision_sancion son los de la migración', () => {
  const args = argumentosSolicitarRevision('ch-1', ' revísenlo ', 'san-1');
  assert.deepEqual(Object.keys(args).sort(), argumentosDe('solicitar_revision_sancion').sort());
  assert.equal(args.p_challenge_id, 'ch-1');
  assert.equal(args.p_motivo, 'revísenlo');
  assert.equal(args.p_sancion_id, 'san-1');
});

test('sin sanción, el argumento viaja como null y no como cadena vacía', () => {
  // `''` no es un uuid: PostgREST lo rechazaría con 22P02 en vez de dejar que
  // el servidor busque la sanción por su cuenta.
  assert.equal(argumentosSolicitarRevision('ch-1', 'texto', undefined).p_sancion_id, null);
  assert.equal(argumentosSolicitarRevision('ch-1', 'texto', '').p_sancion_id, null);
});

test('el motivo vacío viaja como cadena vacía para que responda el servidor', () => {
  assert.equal(argumentosReportarIncomparecencia('ch-1', null).p_motivo, '');
  assert.equal(argumentosSolicitarRevision('ch-1', null, null).p_motivo, '');
});

test('las columnas que pide la interfaz existen en las tablas de la migración', () => {
  const reporte = columnasDe('club_match_noshow_reports');
  COLUMNAS_INCOMPARECENCIA.split(',').map((c) => c.trim()).forEach((col) => {
    assert.ok(reporte.includes(col), `club_match_noshow_reports no tiene ${col}`);
  });

  const revision = columnasDe('club_sanction_reviews');
  COLUMNAS_REVISION.split(',').map((c) => c.trim()).forEach((col) => {
    assert.ok(revision.includes(col), `club_sanction_reviews no tiene ${col}`);
  });
});

test('la interfaz no pide el expediente ni quién resolvió', () => {
  // `contexto` puede pesar decenas de kilobytes y no se muestra en ninguna
  // pantalla; `resuelta_por` es auditoría del servidor.
  assert.ok(!COLUMNAS_REVISION.includes('contexto'));
  assert.ok(!COLUMNAS_REVISION.includes('resuelta_por'));
});

test('la respuesta de la RPC se traduce al {data, error} de los servicios', () => {
  const ok = comoResultadoRevision({ ok: true, reviewId: 'rev-1' }, null);
  assert.equal(ok.error, null);
  assert.equal(ok.data.reviewId, 'rev-1');

  const rechazo = comoResultadoRevision({ ok: false, reason: 'Todavía no' }, null);
  assert.equal(rechazo.data, null);
  assert.equal(rechazo.error.message, 'Todavía no');

  const falta = comoResultadoRevision(null, {
    code: '42883',
    message: 'function public.reportar_incomparecencia(uuid, text) does not exist',
  });
  assert.equal(falta.data, null);
  assert.match(falta.error.message, /migración/i);
});

// ---------------------------------------------------------------------------
// Lo que se lee en el hilo
// ---------------------------------------------------------------------------

test('el evento de la incomparecencia nombra a los dos clubes y el motivo', () => {
  const texto = textoIncomparecenciaReportada({
    club_reportante_nombre: 'Deportivo',
    club_reportado_nombre: 'Los Xupa',
    motivo: 'no llegó nadie',
  });

  assert.match(texto, /Deportivo/);
  assert.match(texto, /Los Xupa/);
  assert.match(texto, /no llegó nadie/);
});

test('el evento de la solicitud no filtra lo que se le dijo a quien modera', () => {
  const texto = textoRevisionSolicitada({
    club_nombre: 'Deportivo',
    tipo: 'sancion',
    motivo: 'ESTO NO DEBERÍA SALIR',
  });

  assert.match(texto, /Deportivo/);
  assert.ok(!texto.includes('ESTO NO DEBERÍA SALIR'));
});

test('el evento de la resolución dice en qué terminó', () => {
  const retirada = textoRevisionResuelta({ club_nombre: 'Deportivo', decision: 'retirada' });
  assert.match(retirada, /retir/i);

  const mantenida = textoRevisionResuelta({ club_nombre: 'Deportivo', decision: 'mantenida' });
  assert.match(mantenida, /mantien|mantuvo|mantiene/i);
});

test('un evento sin datos no rompe la conversación', () => {
  assert.equal(typeof textoIncomparecenciaReportada(null), 'string');
  assert.equal(typeof textoRevisionSolicitada(undefined), 'string');
  assert.equal(typeof textoRevisionResuelta({}), 'string');
});
