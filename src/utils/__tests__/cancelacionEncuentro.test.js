/**
 * Pruebas de la cancelación del encuentro y de la sanción del club
 * (migración 47).
 *
 * QUÉ SE FIJA ACÁ. Lo que se puede probar sin abrir Supabase y que, cuando se
 * rompe, se rompe en silencio:
 *
 *   · El motivo es OBLIGATORIO. Tres espacios no son un motivo.
 *   · El corte de las 2 horas lo mira el servidor, pero la advertencia que se
 *     lee ANTES de pulsar sale de acá: cancelar a 1 h del encuentro tiene que
 *     avisar que sanciona, y a 3 h tiene que decir que no.
 *   · Los NOMBRES de los argumentos de la RPC, contrastados contra la firma
 *     real de la migración. PostgREST no contesta «te faltó `p_motivo`»:
 *     contesta 404 «function not found».
 *   · La sanción es DEL CLUB: se lee de `club_sanctions`, y ninguna de estas
 *     funciones toca ni menciona el Trust Score de nadie.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MOTIVO_MAX,
  COLUMNAS_SANCION,
  validarMotivoCancelacion,
  accionesDeCancelacion,
  avisoDeCancelacion,
  argumentosCancelarEncuentro,
  comoResultadoCancelacion,
  textoEncuentroCancelado,
  textoSancionAplicada,
  sancionVigente,
  textoDeSancion,
} = require('../cancelacionEncuentro.js');

const {
  CANCELACION_SANCION_HORAS,
  SANCION_DIAS,
  getChallengeCta,
} = require('../../services/clubChallengeRules.js');

const { challengeCtaContext } = require('../challengeThread.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const MIGRACION = fs.readFileSync(
  path.join(RAIZ, 'supabase', 'migrations', '47_sanciones_y_revisiones.sql'),
  'utf8'
);

/** Los nombres de argumento que declara una función en la migración. */
function argumentosDe(nombre) {
  const inicio = MIGRACION.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nombre}\\s*\\(`, 'i')
  );
  assert.notEqual(inicio, -1, `la migración 47 debería declarar ${nombre}`);
  const desde = MIGRACION.indexOf('(', inicio);
  const hasta = MIGRACION.indexOf(')', desde);
  return MIGRACION.slice(desde + 1, hasta)
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** El bloque `create table public.club_sanctions (...)` de la migración. */
function columnasDeLaTabla() {
  const inicio = MIGRACION.indexOf('create table if not exists public.club_sanctions');
  assert.notEqual(inicio, -1, 'la migración 47 debería crear public.club_sanctions');
  const desde = MIGRACION.indexOf('(', inicio);
  const hasta = MIGRACION.indexOf('\n);', desde);
  return MIGRACION.slice(desde + 1, hasta)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--'))
    .map((l) => l.split(/\s+/)[0]);
}

test('la consulta de sanciones pide columnas que existen en la migración', () => {
  // Mismo guardián que `nominaQuery.test.js`: PostgREST rechaza la consulta
  // ENTERA con 400 y 42703 si una sola columna no existe, y la pantalla se
  // queda sin saber si su club está sancionado.
  const declaradas = columnasDeLaTabla();
  for (const col of COLUMNAS_SANCION.split(',').map((c) => c.trim())) {
    assert.ok(
      declaradas.includes(col),
      `club_sanctions no declara «${col}» — declaradas: ${declaradas.join(', ')}`
    );
  }
});

const AHORA = new Date('2026-08-14T12:00:00.000Z');
const CLUB_A = 'club-a';
const CLUB_B = 'club-b';

function partidoDeClubes(extra = {}) {
  return {
    id: 'match-1',
    estado: 'abierto',
    hora: new Date('2026-08-16T22:00:00.000Z').toISOString(),
    club_local_id: CLUB_A,
    club_visitante_id: CLUB_B,
    challenge_proposal_id: 'prop-1',
    ...extra,
  };
}

function desafioPublicado(extra = {}) {
  return {
    id: 'ch-1',
    estado: 'publicado',
    club_retador_id: CLUB_A,
    club_retado_id: CLUB_B,
    match_id: 'match-1',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// El motivo es obligatorio
// ---------------------------------------------------------------------------

test('sin motivo no se cancela', () => {
  for (const vacio of [null, undefined, '', '   ', '\n\t ']) {
    const r = validarMotivoCancelacion(vacio);
    assert.equal(r.ok, false, `«${String(vacio)}» no debería pasar como motivo`);
    assert.equal(r.motivo, null);
    assert.match(r.error, /motivo/i);
  }
});

test('el motivo viaja recortado, no con los espacios que se escribieron', () => {
  const r = validarMotivoCancelacion('  se nos inundó la cancha  ');
  assert.equal(r.ok, true);
  assert.equal(r.motivo, 'se nos inundó la cancha');
  assert.equal(r.error, null);
});

test('un motivo más largo que el máximo se rechaza en vez de recortarse', () => {
  // Recortarlo dejaría en el historial una explicación cortada a la mitad, y
  // ese texto es justamente el que se conserva para siempre.
  const r = validarMotivoCancelacion('x'.repeat(MOTIVO_MAX + 1));
  assert.equal(r.ok, false);
  assert.match(r.error, new RegExp(String(MOTIVO_MAX)));
});

test('un motivo justo en el máximo sí pasa', () => {
  const r = validarMotivoCancelacion('x'.repeat(MOTIVO_MAX));
  assert.equal(r.ok, true);
  assert.equal(r.motivo.length, MOTIVO_MAX);
});

// ---------------------------------------------------------------------------
// Quién puede cancelar
// ---------------------------------------------------------------------------

test('un administrador de uno de los dos clubes puede cancelar', () => {
  const a = accionesDeCancelacion({
    challenge: desafioPublicado(),
    partido: partidoDeClubes(),
    clubesAdmin: [CLUB_A],
    ahora: AHORA,
  });
  assert.equal(a.esDeClubes, true);
  assert.equal(a.soyAdmin, true);
  assert.equal(a.miClubId, CLUB_A);
  assert.equal(a.puedeCancelar, true);
  assert.equal(a.bloqueo, null);
});

test('quien no es administrador no cancela, y se le dice por qué', () => {
  const a = accionesDeCancelacion({
    challenge: desafioPublicado(),
    partido: partidoDeClubes(),
    clubesAdmin: [],
    ahora: AHORA,
  });
  assert.equal(a.puedeCancelar, false);
  assert.match(a.bloqueo, /administrador/i);
});

test('quien administra los dos clubes no cancela en nombre de uno solo', () => {
  // Mismo conflicto de doble pertenencia que cierra `proponer_cambio_partido`:
  // la sanción es de UN club, y no hay forma de decidir de cuál.
  const a = accionesDeCancelacion({
    challenge: desafioPublicado(),
    partido: partidoDeClubes(),
    clubesAdmin: [CLUB_A, CLUB_B],
    ahora: AHORA,
  });
  assert.equal(a.administroLosDos, true);
  assert.equal(a.puedeCancelar, false);
  assert.match(a.bloqueo, /los dos clubes/i);
});

test('un encuentro ya cancelado no se vuelve a cancelar', () => {
  const a = accionesDeCancelacion({
    challenge: desafioPublicado({ estado: 'cancelado' }),
    partido: partidoDeClubes({ estado: 'cancelado' }),
    clubesAdmin: [CLUB_A],
    ahora: AHORA,
  });
  assert.equal(a.puedeCancelar, false);
  assert.match(a.bloqueo, /ya está cancelado/i);
});

test('un encuentro en juego todavía se puede cancelar', () => {
  const a = accionesDeCancelacion({
    challenge: desafioPublicado({ estado: 'en_juego' }),
    partido: partidoDeClubes({ estado: 'lleno' }),
    clubesAdmin: [CLUB_B],
    ahora: AHORA,
  });
  assert.equal(a.puedeCancelar, true);
  assert.equal(a.miClubId, CLUB_B);
});

test('con el resultado ya en juego de espera, cancelar deja de tener sentido', () => {
  const a = accionesDeCancelacion({
    challenge: desafioPublicado({ estado: 'esperando_resultado' }),
    partido: partidoDeClubes(),
    clubesAdmin: [CLUB_A],
    ahora: AHORA,
  });
  assert.equal(a.puedeCancelar, false);
  assert.match(a.bloqueo, /ya no se puede cancelar/i);
});

test('un partido que no es de clubes no entra por acá', () => {
  const a = accionesDeCancelacion({
    challenge: null,
    partido: partidoDeClubes({ challenge_proposal_id: null }),
    clubesAdmin: [CLUB_A],
    ahora: AHORA,
  });
  assert.equal(a.esDeClubes, false);
  assert.equal(a.puedeCancelar, false);
  assert.equal(a.bloqueo, null);
});

test('sin partido publicado no hay encuentro que cancelar', () => {
  const a = accionesDeCancelacion({
    challenge: desafioPublicado({ estado: 'negociacion', match_id: null }),
    partido: null,
    clubesAdmin: [CLUB_A],
    ahora: AHORA,
  });
  assert.equal(a.esDeClubes, false);
  assert.equal(a.puedeCancelar, false);
});

test('no revienta con entradas ausentes', () => {
  const a = accionesDeCancelacion();
  assert.equal(a.esDeClubes, false);
  assert.equal(a.puedeCancelar, false);
  assert.equal(a.miClubId, null);
});

// ---------------------------------------------------------------------------
// El corte de las 2 horas
// ---------------------------------------------------------------------------

test('a más de 2 horas del encuentro, cancelar no sanciona', () => {
  const partido = partidoDeClubes({
    hora: new Date(AHORA.getTime() + 3 * 3600 * 1000).toISOString(),
  });
  const a = accionesDeCancelacion({
    challenge: desafioPublicado(),
    partido,
    clubesAdmin: [CLUB_A],
    ahora: AHORA,
  });
  assert.equal(a.puedeCancelar, true);
  assert.equal(a.sanciona, false);
  assert.equal(a.finDeSancion, null);

  const aviso = avisoDeCancelacion({ partido, ahora: AHORA });
  assert.equal(aviso.sanciona, false);
  assert.match(aviso.detalle, /sin sanción|no hay sanción/i);
});

test('dentro de las 2 horas previas, cancelar sanciona 14 días', () => {
  const partido = partidoDeClubes({
    hora: new Date(AHORA.getTime() + 1 * 3600 * 1000).toISOString(),
  });
  const a = accionesDeCancelacion({
    challenge: desafioPublicado(),
    partido,
    clubesAdmin: [CLUB_A],
    ahora: AHORA,
  });
  assert.equal(a.puedeCancelar, true, 'sancionar no es lo mismo que impedir');
  assert.equal(a.sanciona, true);
  assert.equal(
    a.finDeSancion.getTime(),
    AHORA.getTime() + SANCION_DIAS * 24 * 3600 * 1000
  );

  const aviso = avisoDeCancelacion({ partido, ahora: AHORA });
  assert.equal(aviso.sanciona, true);
  assert.match(aviso.detalle, new RegExp(String(SANCION_DIAS)));
});

test('el borde exacto de las 2 horas sanciona, igual que en el servidor', () => {
  // El servidor compara con `<=`: a exactamente 2 horas ya se sanciona. Si el
  // cliente usara `<`, prometería «sin sanción» justo donde sí la hay.
  const partido = partidoDeClubes({
    hora: new Date(AHORA.getTime() + CANCELACION_SANCION_HORAS * 3600 * 1000).toISOString(),
  });
  const a = accionesDeCancelacion({
    challenge: desafioPublicado(),
    partido,
    clubesAdmin: [CLUB_A],
    ahora: AHORA,
  });
  assert.equal(a.sanciona, true);
});

test('un encuentro que ya empezó también sanciona al cancelarlo', () => {
  const partido = partidoDeClubes({
    hora: new Date(AHORA.getTime() - 30 * 60 * 1000).toISOString(),
  });
  const a = accionesDeCancelacion({
    challenge: desafioPublicado({ estado: 'en_juego' }),
    partido,
    clubesAdmin: [CLUB_A],
    ahora: AHORA,
  });
  assert.equal(a.sanciona, true);
});

test('sin hora legible se avisa de la sanción: la duda no se resuelve a favor', () => {
  const partido = partidoDeClubes({ hora: 'no es una fecha' });
  const aviso = avisoDeCancelacion({ partido, ahora: AHORA });
  assert.equal(aviso.sanciona, true);
});

// ---------------------------------------------------------------------------
// Los argumentos de la RPC
// ---------------------------------------------------------------------------

test('cancelar manda exactamente los argumentos que declara la migración', () => {
  const args = argumentosCancelarEncuentro('ch-1', '  se nos cayó la cancha ');
  assert.deepEqual(Object.keys(args).sort(), ['p_challenge_id', 'p_motivo']);
  assert.equal(args.p_challenge_id, 'ch-1');
  assert.equal(args.p_motivo, 'se nos cayó la cancha');

  const declarados = argumentosDe('cancelar_encuentro_club');
  assert.deepEqual(declarados.sort(), Object.keys(args).sort());
});

test('un motivo vacío viaja como cadena vacía, no como null', () => {
  // El servidor tiene que poder rechazarlo con su propio mensaje. Mandar
  // `null` haría que la RPC lo leyera como «no vino el argumento».
  const args = argumentosCancelarEncuentro('ch-1', '   ');
  assert.equal(args.p_motivo, '');
});

test('la respuesta {ok:false} se lee como error de negocio, no como caída', () => {
  const r = comoResultadoCancelacion(
    { ok: false, reason: 'Solo un administrador puede cancelar' },
    null
  );
  assert.equal(r.data, null);
  assert.equal(r.error.message, 'Solo un administrador puede cancelar');
});

test('la respuesta {ok:true} llega tal cual, con la sanción incluida', () => {
  const r = comoResultadoCancelacion({ ok: true, sanciona: true, sancionId: 's1' }, null);
  assert.equal(r.error, null);
  assert.equal(r.data.sanciona, true);
  assert.equal(r.data.sancionId, 's1');
});

test('una migración ausente se traduce en vez de mostrar «function does not exist»', () => {
  const r = comoResultadoCancelacion(null, { code: 'PGRST202', message: 'function does not exist' });
  assert.equal(r.data, null);
  assert.match(r.error.message, /migración/i);
});

// ---------------------------------------------------------------------------
// El texto del hilo
// ---------------------------------------------------------------------------

test('el evento de cancelación dice qué club canceló y por qué', () => {
  const texto = textoEncuentroCancelado({
    club_cancela_nombre: 'Deportivo',
    actor_username: 'vicente',
    motivo: 'se nos inundó la cancha',
  });
  assert.match(texto, /Deportivo/);
  assert.match(texto, /@vicente/);
  assert.match(texto, /se nos inundó la cancha/);
});

test('sin nombre de club el evento sigue siendo legible', () => {
  const texto = textoEncuentroCancelado({ motivo: 'lluvia' });
  assert.match(texto, /Un club/);
  assert.match(texto, /lluvia/);
});

test('el evento de sanción dice el club, los días y hasta cuándo', () => {
  const texto = textoSancionAplicada({
    club_nombre: 'Deportivo',
    dias: SANCION_DIAS,
    fin_at: '2026-08-28T12:00:00.000Z',
  });
  assert.match(texto, /Deportivo/);
  assert.match(texto, new RegExp(String(SANCION_DIAS)));
  assert.match(texto, /28 de agosto/);
});

test('una sanción provisional se lee como provisional, no como definitiva (47c)', () => {
  // Es la diferencia que decide si el club entiende que puede pedir una
  // revisión. Leer «quedó sancionado 14 días» a secas, cuando la sanción
  // todavía no la miró nadie, es lo que hace que nadie la pida.
  const texto = textoSancionAplicada({
    club_nombre: 'Deportivo',
    tipo: 'incomparecencia',
    estado: 'provisional',
    dias: SANCION_DIAS,
    fin_at: '2026-08-28T12:00:00.000Z',
  });
  assert.match(texto, /provisional/i);
  assert.match(texto, /revis/i);

  const definitiva = textoSancionAplicada({
    club_nombre: 'Deportivo',
    estado: 'vigente',
    dias: SANCION_DIAS,
    fin_at: '2026-08-28T12:00:00.000Z',
  });
  assert.doesNotMatch(definitiva, /provisional/i);
});

test('ningún texto del hilo menciona el Trust Score: la sanción es del club', () => {
  const textos = [
    textoEncuentroCancelado({ club_cancela_nombre: 'Deportivo', motivo: 'lluvia' }),
    textoSancionAplicada({ club_nombre: 'Deportivo', dias: SANCION_DIAS, fin_at: '2026-08-28T12:00:00.000Z' }),
    avisoDeCancelacion({ partido: partidoDeClubes({ hora: AHORA.toISOString() }), ahora: AHORA }).detalle,
  ];
  for (const texto of textos) {
    assert.doesNotMatch(texto, /trust/i, `«${texto}» no debería hablar del Trust Score`);
  }
});

// ---------------------------------------------------------------------------
// La sanción vigente
// ---------------------------------------------------------------------------

const SANCION = {
  id: 's1',
  club_id: CLUB_A,
  estado: 'vigente',
  motivo: 'Canceló el encuentro con menos de 2 horas de aviso',
  inicio_at: '2026-08-14T00:00:00.000Z',
  // Mediodía UTC y no medianoche: `fechaLarga` formatea en hora LOCAL, y una
  // medianoche UTC se lee como el día anterior en Chile. La prueba mediría el
  // huso horario de quien la corre en vez del texto.
  fin_at: '2026-08-28T12:00:00.000Z',
};

test('una sanción en curso es la vigente', () => {
  assert.equal(sancionVigente([SANCION], AHORA)?.id, 's1');
});

test('una sanción ya cumplida no bloquea nada', () => {
  const vieja = { ...SANCION, fin_at: '2026-08-01T00:00:00.000Z' };
  assert.equal(sancionVigente([vieja], AHORA), null);
});

test('una sanción retirada por la revisión deja de contar', () => {
  const retirada = { ...SANCION, estado: 'retirada' };
  assert.equal(sancionVigente([retirada], AHORA), null);
});

test('con dos sanciones encima manda la que termina más tarde', () => {
  const larga = { ...SANCION, id: 's2', fin_at: '2026-09-10T00:00:00.000Z' };
  assert.equal(sancionVigente([SANCION, larga], AHORA)?.id, 's2');
});

test('sin sanciones, o con basura, no hay sanción vigente', () => {
  assert.equal(sancionVigente([], AHORA), null);
  assert.equal(sancionVigente(null, AHORA), null);
  assert.equal(sancionVigente([null, {}], AHORA), null);
});

test('la sanción se explica con el motivo y la fecha de término', () => {
  const texto = textoDeSancion(SANCION);
  assert.match(texto, /28 de agosto/);
  assert.match(texto, /menos de 2 horas/);
});

// ---------------------------------------------------------------------------
// Regresión: el motivo del encuentro no se mezcla con el de la sanción
//
// Fallo real encontrado en la comprobación manual del 2026-08-14 (P51-A vs
// P51-B, partido e50c7303, desafío 4affb4d3). El encuentro se canceló CON
// anticipación y su motivo era «cancelación con anticipación», pero la barra
// de abajo del hilo mostraba «Canceló el encuentro con menos de 2 horas de
// aviso: … cancha no disponible», que es el motivo de una sanción ANTERIOR del
// mismo club, por otro encuentro.
//
// El servidor tenía el dato bien —el detalle del partido lo mostraba
// correcto—: lo que fallaba era el orden de `getChallengeCta`, que miraba la
// sanción del club ANTES que el estado del desafío. En un desafío ya cerrado
// no hay ninguna acción que bloquear, así que la sanción no pinta nada ahí.
//
// LAS PRUEBAS USAN LAS FUENTES REALES DEL CARGADOR, y ésa es la lección de
// U4.4: una prueba que fabrica su propia entrada no dice nada sobre de dónde
// sale esa entrada en la aplicación. Acá la sanción se obtiene con
// `sancionVigente()` sobre filas con la forma de `club_sanctions`, y el
// contexto con `challengeCtaContext()`, que es exactamente lo que arma
// `ChatThreadScreen`.
// ---------------------------------------------------------------------------

// Las marcas de tiempo son las REALES de la sanción de P51-A, así que el
// «ahora» de este bloque tiene que caer dentro de su ventana. Con el `AHORA`
// general —anterior al `inicio_at`— `sancionVigente()` devolvía null y estas
// pruebas pasaban sin que hubiera ninguna sanción que mezclar: verde por la
// razón equivocada, que es peor que rojo.
const AHORA_P51 = new Date('2026-08-15T12:00:00.000Z');

const MOTIVO_DEL_ENCUENTRO = 'Prueba manual P51: cancelación con anticipación';
const MOTIVO_DE_LA_SANCION =
  'Canceló el encuentro con menos de 2 horas de aviso: Prueba manual P51: cancha no disponible';

/** Fila de `club_sanctions` tal como la devuelve `listSancionesDeClubes`. */
const SANCION_DE_OTRO_ENCUENTRO = {
  id: 's-p51',
  club_id: CLUB_A,
  challenge_id: 'otro-desafio',
  match_id: 'otro-partido',
  tipo: 'cancelacion_tardia',
  motivo: MOTIVO_DE_LA_SANCION,
  inicio_at: '2026-08-14T22:29:59.184Z',
  fin_at: '2026-08-28T22:29:59.184Z',
  estado: 'vigente',
  created_at: '2026-08-14T22:29:59.184Z',
};

/** Fila de `club_challenges` del encuentro ya cancelado. */
const DESAFIO_CANCELADO = {
  id: '4affb4d3-b988-4570-9a06-9158f18d4753',
  estado: 'cancelado',
  motivo_cierre: MOTIVO_DEL_ENCUENTRO,
  club_retador_id: CLUB_A,
  club_retado_id: CLUB_B,
  match_id: 'e50c7303-82fe-41b5-aa3a-88cd94e2a76d',
};

/** Fila de `matches` del encuentro ya cancelado. */
const PARTIDO_CANCELADO = partidoDeClubes({
  id: 'e50c7303-82fe-41b5-aa3a-88cd94e2a76d',
  estado: 'cancelado',
  motivo_cancelacion: MOTIVO_DEL_ENCUENTRO,
});

/** El contexto tal como lo arma `ChatThreadScreen`, con el cargador real. */
function ctaDelHiloCancelado() {
  return getChallengeCta(
    challengeCtaContext({
      challenge: DESAFIO_CANCELADO,
      misClubIds: [CLUB_A],
      misClubIdsTodos: [CLUB_A],
      online: true,
      sancion: sancionVigente([SANCION_DE_OTRO_ENCUENTRO], AHORA_P51),
      propuesta: null,
      respuestasProrroga: [],
    })
  );
}

test('el hilo de un encuentro cancelado no muestra el motivo de otra sanción', () => {
  const cta = ctaDelHiloCancelado();
  const textos = [cta.label, cta.hint].filter(Boolean).join(' | ');

  assert.ok(
    !textos.includes(MOTIVO_DE_LA_SANCION),
    `la barra del hilo repite el motivo de la sanción: «${textos}»`
  );
  assert.ok(
    !textos.includes('menos de 2 horas'),
    `la barra dice «menos de 2 horas» en un encuentro cancelado CON anticipación: «${textos}»`
  );
});

test('el hilo de un encuentro cancelado muestra su propio estado', () => {
  const cta = ctaDelHiloCancelado();
  assert.equal(cta.kind, 'cerrado');
  assert.match(`${cta.label} ${cta.hint}`, /cancelad/i);
});

test('el motivo del encuentro sale del partido, no de la sanción del club', () => {
  // La sanción viva del club dice otra cosa; el motivo que se presenta tiene
  // que venir de la fila del PARTIDO que se está mirando.
  assert.equal(PARTIDO_CANCELADO.motivo_cancelacion, MOTIVO_DEL_ENCUENTRO);
  assert.notEqual(
    PARTIDO_CANCELADO.motivo_cancelacion,
    sancionVigente([SANCION_DE_OTRO_ENCUENTRO], AHORA_P51).motivo
  );

  const acciones = accionesDeCancelacion({
    challenge: DESAFIO_CANCELADO,
    partido: PARTIDO_CANCELADO,
    clubesAdmin: [CLUB_A],
    ahora: AHORA_P51,
  });
  assert.equal(acciones.puedeCancelar, false);
  assert.match(acciones.bloqueo, /ya está cancelado/i);
  assert.ok(!acciones.bloqueo.includes(MOTIVO_DE_LA_SANCION));
});

test('el evento del hilo sigue contando el motivo de ESTE encuentro', () => {
  // El payload es el que escribe `cancelar_encuentro_club`.
  const texto = textoEncuentroCancelado({
    club_cancela_nombre: 'P51-B',
    actor_username: 'chatgptpruebas54152',
    motivo: MOTIVO_DEL_ENCUENTRO,
    sanciona: false,
  });
  assert.match(texto, /cancelación con anticipación/);
  assert.ok(!texto.includes(MOTIVO_DE_LA_SANCION));
});

test('con el desafío todavía vivo, la sanción sí se anuncia y dice de quién es', () => {
  // La corrección no puede apagar la sanción donde SÍ bloquea algo: con el
  // desafío en negociación no hay estado cerrado que mostrar y el club tiene
  // que enterarse de que no puede operar.
  const cta = getChallengeCta(
    challengeCtaContext({
      challenge: { ...DESAFIO_CANCELADO, estado: 'negociacion', motivo_cierre: null },
      misClubIds: [CLUB_A],
      misClubIdsTodos: [CLUB_A],
      online: true,
      sancion: sancionVigente([SANCION_DE_OTRO_ENCUENTRO], AHORA_P51),
    })
  );
  assert.equal(cta.kind, 'sancionado');
  assert.match(cta.hint, /tu club/i, 'el aviso tiene que decir que la restricción es del club');
});

test('sin sanción, un encuentro cancelado se comporta igual', () => {
  // Fija que lo que arregla el orden es la sanción, no otra cosa: el hilo
  // cerrado ya se veía bien cuando el club no estaba sancionado.
  const cta = getChallengeCta(
    challengeCtaContext({
      challenge: DESAFIO_CANCELADO,
      misClubIds: [CLUB_A],
      misClubIdsTodos: [CLUB_A],
      online: true,
      sancion: sancionVigente([], AHORA_P51),
    })
  );
  assert.equal(cta.kind, 'cerrado');
});

test('el club sancionado conserva sus partidos ya publicados, y se dice', () => {
  const aviso = avisoDeCancelacion({
    partido: partidoDeClubes({ hora: AHORA.toISOString() }),
    ahora: AHORA,
  });
  assert.match(aviso.detalle, /ya publicó/i);
});
