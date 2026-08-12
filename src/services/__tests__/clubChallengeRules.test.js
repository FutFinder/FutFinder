/**
 * Pruebas de las reglas del ciclo de desafíos entre clubes.
 *
 * Este módulo es la única fuente de los números y las transiciones del ciclo
 * (plazos, cupos, sanciones, estados). Su espejo en PostgreSQL es la función
 * `desafio_reglas()` de la migración 41: si un valor cambia acá, cambia allá.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../clubChallengeRules.js');

// ─────────────────────────────────────────────── constantes del ciclo

test('los plazos del ciclo son los del enunciado y no otros', () => {
  assert.equal(R.NEGOCIACION_HORAS, 72);
  assert.equal(R.PRORROGA_HORAS, 24);
  assert.equal(R.CAMBIO_LIMITE_HORAS, 2);
  assert.equal(R.CANCELACION_SANCION_HORAS, 2);
  assert.equal(R.SANCION_DIAS, 14);
  assert.equal(R.EXPIRACION_PENDIENTE_DIAS, 7);
});

test('los cupos por club van de 4 a 15', () => {
  // El mínimo lo fija el enunciado; el máximo lo fija `matches.cupos_totales <= 30`
  // de supabase/schema.sql, porque el total es el doble de los cupos por club.
  assert.equal(R.CUPOS_POR_CLUB.min, 4);
  assert.equal(R.CUPOS_POR_CLUB.max, 15);
  assert.equal(R.CUPOS_POR_CLUB.max * 2, 30);
});

test('hay exactamente dos métodos de inscripción, con texto en español', () => {
  const valores = R.METODOS_INSCRIPCION.map((m) => m.value);
  assert.deepEqual(valores, ['orden_llegada', 'seleccion_admin']);
  for (const m of R.METODOS_INSCRIPCION) {
    assert.ok(m.label.length > 0, 'cada método necesita etiqueta');
    assert.ok(m.desc.length > 0, 'cada método necesita descripción');
  }
});

// ─────────────────────────────────────────────── máquina de estados

test('la máquina cubre los trece estados del ciclo más el legado', () => {
  const esperados = [
    'pendiente',
    'negociacion',
    'esperando_aprobacion',
    'publicado',
    'en_juego',
    'esperando_resultado',
    'finalizado',
    'rechazado',
    'sin_acuerdo',
    'cancelado',
    'resultado_en_disputa',
    'bloqueado_sancion',
    'expirado',
    'aceptado',
  ];
  assert.deepEqual(Object.values(R.ESTADOS).sort(), [...esperados].sort());
});

test('las transiciones de la línea principal están permitidas', () => {
  assert.ok(R.puedeTransicionar('pendiente', 'negociacion'));
  assert.ok(R.puedeTransicionar('negociacion', 'esperando_aprobacion'));
  assert.ok(R.puedeTransicionar('esperando_aprobacion', 'publicado'));
  assert.ok(R.puedeTransicionar('publicado', 'en_juego'));
  assert.ok(R.puedeTransicionar('en_juego', 'esperando_resultado'));
  assert.ok(R.puedeTransicionar('esperando_resultado', 'finalizado'));
});

test('rechazar una propuesta devuelve el desafío a negociación', () => {
  assert.ok(R.puedeTransicionar('esperando_aprobacion', 'negociacion'));
});

test('los saltos que se saltan pasos están prohibidos', () => {
  assert.equal(R.puedeTransicionar('pendiente', 'publicado'), false);
  assert.equal(R.puedeTransicionar('negociacion', 'finalizado'), false);
  assert.equal(R.puedeTransicionar('pendiente', 'esperando_resultado'), false);
});

test('un estado terminal no transiciona a ninguna parte', () => {
  for (const terminal of ['finalizado', 'rechazado', 'sin_acuerdo', 'cancelado', 'expirado']) {
    assert.deepEqual(
      R.TRANSICIONES[terminal],
      [],
      `${terminal} debería ser terminal`
    );
  }
});

test('una sanción alcanza a cualquier estado activo y es reversible', () => {
  for (const activo of ['pendiente', 'negociacion', 'esperando_aprobacion', 'publicado']) {
    assert.ok(
      R.puedeTransicionar(activo, 'bloqueado_sancion'),
      `${activo} debería poder bloquearse por sanción`
    );
  }
  // Retirar la sanción devuelve el desafío a donde estaba (C2 del plan).
  assert.ok(R.puedeTransicionar('bloqueado_sancion', 'negociacion'));
  assert.ok(R.puedeTransicionar('bloqueado_sancion', 'publicado'));
});

test('un resultado en disputa no puede cerrarse solo', () => {
  assert.equal(R.puedeTransicionar('resultado_en_disputa', 'finalizado'), false);
});

test('una transición con estado desconocido no revienta, devuelve false', () => {
  assert.equal(R.puedeTransicionar('inventado', 'negociacion'), false);
  assert.equal(R.puedeTransicionar('pendiente', 'inventado'), false);
  assert.equal(R.puedeTransicionar(null, undefined), false);
});

test('el chat sólo está abierto en los estados activos', () => {
  assert.ok(R.esEstadoActivo('negociacion'));
  assert.ok(R.esEstadoActivo('esperando_aprobacion'));
  assert.ok(R.esEstadoActivo('publicado'));
  assert.ok(R.esEstadoActivo('esperando_resultado'));
  assert.equal(R.esEstadoActivo('sin_acuerdo'), false);
  assert.equal(R.esEstadoActivo('cancelado'), false);
  assert.equal(R.esEstadoActivo('finalizado'), false);
});

test('cada estado tiene etiqueta en español, sin dejar el valor crudo a la vista', () => {
  for (const estado of Object.values(R.ESTADOS)) {
    const label = R.estadoLabel(estado);
    assert.ok(label.length > 0, `falta etiqueta para ${estado}`);
    assert.ok(!label.includes('_'), `la etiqueta de ${estado} expone el valor crudo`);
  }
  assert.equal(R.estadoLabel('esperando_aprobacion'), 'Propuesta oficial enviada');
  assert.equal(R.estadoLabel('sin_acuerdo'), 'Sin acuerdo');
  assert.equal(R.estadoLabel('bloqueado_sancion'), 'Club sancionado');
});

// ─────────────────────────────────────────────── propuesta preliminar

function preliminarValida(extra = {}) {
  return {
    retadorClubId: 'club-a',
    rivalClubId: 'club-b',
    modalidad: 'futbol7',
    fechaDesde: '2026-09-01T21:00:00.000Z',
    fechaHasta: '2026-09-07T21:00:00.000Z',
    zona: 'Ñuñoa',
    cuposPorClub: 7,
    metodoInscripcion: 'orden_llegada',
    mensaje: 'Nos acomoda el fin de semana.',
    ...extra,
  };
}

test('una propuesta preliminar completa es válida', () => {
  const r = R.validarPropuestaPreliminar(preliminarValida());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
});

test('un club no puede desafiarse a sí mismo', () => {
  const r = R.validarPropuestaPreliminar(preliminarValida({ rivalClubId: 'club-a' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.rivalClubId);
});

test('faltar el club rival o el retador invalida la propuesta', () => {
  assert.ok(R.validarPropuestaPreliminar(preliminarValida({ rivalClubId: null })).errors.rivalClubId);
  assert.ok(R.validarPropuestaPreliminar(preliminarValida({ retadorClubId: '' })).errors.retadorClubId);
});

test('los cupos por club por debajo de 4 o por encima de 15 se rechazan', () => {
  for (const malo of [0, 3, 16, 30]) {
    const r = R.validarPropuestaPreliminar(preliminarValida({ cuposPorClub: malo }));
    assert.equal(r.ok, false, `${malo} cupos debería rechazarse`);
    assert.ok(r.errors.cuposPorClub);
  }
  for (const bueno of [4, 7, 15]) {
    const r = R.validarPropuestaPreliminar(preliminarValida({ cuposPorClub: bueno }));
    assert.equal(r.ok, true, `${bueno} cupos debería aceptarse`);
  }
});

test('los cupos deben ser un entero, no un decimal ni un texto', () => {
  assert.ok(R.validarPropuestaPreliminar(preliminarValida({ cuposPorClub: 7.5 })).errors.cuposPorClub);
  assert.ok(R.validarPropuestaPreliminar(preliminarValida({ cuposPorClub: 'siete' })).errors.cuposPorClub);
});

test('el rango de fechas no puede terminar antes de empezar', () => {
  const r = R.validarPropuestaPreliminar(
    preliminarValida({
      fechaDesde: '2026-09-07T21:00:00.000Z',
      fechaHasta: '2026-09-01T21:00:00.000Z',
    })
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.fechaHasta);
});

test('el rango de fechas puede omitir el final: es una fecha tentativa', () => {
  const r = R.validarPropuestaPreliminar(preliminarValida({ fechaHasta: null }));
  assert.equal(r.ok, true);
});

test('un método de inscripción inventado se rechaza', () => {
  const r = R.validarPropuestaPreliminar(preliminarValida({ metodoInscripcion: 'sorteo' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.metodoInscripcion);
});

test('el mensaje opcional respeta el largo máximo de la columna', () => {
  const r = R.validarPropuestaPreliminar(
    preliminarValida({ mensaje: 'x'.repeat(R.MENSAJE_MAX + 1) })
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.mensaje);
  assert.equal(R.validarPropuestaPreliminar(preliminarValida({ mensaje: null })).ok, true);
});

// ─────────────────────────────────────────────── propuesta oficial

function oficialValida(extra = {}) {
  return {
    fecha: '2026-09-05T21:00:00.000Z',
    duracionMin: 90,
    direccion: 'Av. Grecia 3401',
    canchaNombre: 'Complejo Deportivo Ñuñoa',
    comuna: 'Ñuñoa',
    region: 'Región Metropolitana de Santiago',
    modalidad: 'futbol7',
    cuposPorClub: 7,
    metodoInscripcion: 'seleccion_admin',
    cuotaPorPersona: 4000,
    instrucciones: 'Llegar 15 minutos antes. Camiseta clara el club local.',
    ...extra,
  };
}

const AHORA = new Date('2026-08-10T12:00:00.000Z');

test('una propuesta oficial completa es válida', () => {
  const r = R.validarPropuestaOficial(oficialValida(), AHORA);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
});

test('la propuesta oficial exige dirección exacta, cancha, comuna y región', () => {
  for (const campo of ['direccion', 'canchaNombre', 'comuna', 'region']) {
    const r = R.validarPropuestaOficial(oficialValida({ [campo]: '   ' }), AHORA);
    assert.equal(r.ok, false, `${campo} vacío debería invalidar`);
    assert.ok(r.errors[campo], `falta el error de ${campo}`);
  }
});

test('la propuesta oficial no puede fijarse en el pasado', () => {
  const r = R.validarPropuestaOficial(
    oficialValida({ fecha: '2026-08-09T21:00:00.000Z' }),
    AHORA
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.fecha);
});

test('la cuota por persona es un entero no negativo, y cero es válido', () => {
  assert.equal(R.validarPropuestaOficial(oficialValida({ cuotaPorPersona: 0 }), AHORA).ok, true);
  assert.ok(R.validarPropuestaOficial(oficialValida({ cuotaPorPersona: -1 }), AHORA).errors.cuotaPorPersona);
  assert.ok(R.validarPropuestaOficial(oficialValida({ cuotaPorPersona: 1500.5 }), AHORA).errors.cuotaPorPersona);
});

test('la propuesta oficial hereda el mismo rango de cupos por club', () => {
  assert.ok(R.validarPropuestaOficial(oficialValida({ cuposPorClub: 3 }), AHORA).errors.cuposPorClub);
  assert.ok(R.validarPropuestaOficial(oficialValida({ cuposPorClub: 16 }), AHORA).errors.cuposPorClub);
});

test('la duración se limita a las que ofrece el módulo Partidos', () => {
  for (const buena of [60, 90, 120]) {
    assert.equal(R.validarPropuestaOficial(oficialValida({ duracionMin: buena }), AHORA).ok, true);
  }
  assert.ok(R.validarPropuestaOficial(oficialValida({ duracionMin: 45 }), AHORA).errors.duracionMin);
});

// ─────────────────────────────────────────────── plazos

test('el plazo restante se calcula contra la hora del servidor que se le pase', () => {
  const vence = '2026-08-10T14:30:00.000Z';
  const p = R.plazoRestante(vence, AHORA);
  assert.equal(p.vencido, false);
  assert.equal(p.ms, 2.5 * 3600 * 1000);
  assert.equal(p.label, '2 h 30');
});

test('un plazo ya cumplido se marca vencido y no devuelve tiempo negativo', () => {
  const p = R.plazoRestante('2026-08-10T11:00:00.000Z', AHORA);
  assert.equal(p.vencido, true);
  assert.equal(p.ms, 0);
  assert.equal(p.label, 'vencido');
});

test('un plazo ausente no se muestra como vencido: simplemente no hay plazo', () => {
  const p = R.plazoRestante(null, AHORA);
  assert.equal(p.vencido, false);
  assert.equal(p.label, '');
});

test('los plazos largos se cuentan en días', () => {
  assert.equal(R.plazoRestante('2026-08-13T12:00:00.000Z', AHORA).label, '3 días');
  assert.equal(R.plazoRestante('2026-08-11T12:00:00.000Z', AHORA).label, '1 día');
});

test('se puede proponer un cambio hasta 2 horas antes del inicio', () => {
  const inicio = '2026-08-10T15:00:00.000Z'; // faltan 3 h
  assert.equal(R.puedeProponerCambio(inicio, AHORA), true);
  const justo = '2026-08-10T14:00:00.000Z'; // faltan exactamente 2 h
  assert.equal(R.puedeProponerCambio(justo, AHORA), false);
  const tarde = '2026-08-10T13:00:00.000Z'; // falta 1 h
  assert.equal(R.puedeProponerCambio(tarde, AHORA), false);
});

test('cancelar bajo las 2 horas sanciona; por encima, no', () => {
  assert.equal(R.cancelacionSanciona('2026-08-10T13:00:00.000Z', AHORA), true);
  assert.equal(R.cancelacionSanciona('2026-08-10T15:00:00.000Z', AHORA), false);
});

test('la sanción dura 14 días desde que se aplica', () => {
  const fin = R.finDeSancion(AHORA);
  assert.equal(fin.toISOString(), '2026-08-24T12:00:00.000Z');
});

// ─────────────────────────────────────────────── CTA y bloqueos

function ctx(extra = {}) {
  return {
    challenge: { estado: 'pendiente', club_retador_id: 'club-a', club_retado_id: 'club-b' },
    myClubId: 'club-b',
    soyAdmin: true,
    propuesta: null,
    online: true,
    sancion: null,
    ...extra,
  };
}

test('sin conexión, todo queda bloqueado antes de mirar el estado', () => {
  const b = R.getChallengeBlockReason(ctx({ online: false }));
  assert.equal(b.code, 'sin_conexion');
  assert.equal(R.getChallengeCta(ctx({ online: false })).disabled, true);
});

test('un miembro sin rol de administrador sólo mira', () => {
  const b = R.getChallengeBlockReason(ctx({ soyAdmin: false }));
  assert.equal(b.code, 'no_admin');
  assert.equal(R.getChallengeCta(ctx({ soyAdmin: false })).kind, 'solo_lectura');
});

test('un club sancionado no puede operar y ve hasta cuándo dura', () => {
  const b = R.getChallengeBlockReason(
    ctx({ sancion: { motivo: 'Cancelación tardía', fin_at: '2026-08-24T12:00:00.000Z' } })
  );
  assert.equal(b.code, 'club_sancionado');
  assert.ok(b.detail.includes('Cancelación tardía'));
});

test('el club retado responde el desafío; el retador espera', () => {
  assert.equal(R.getChallengeCta(ctx({ myClubId: 'club-b' })).kind, 'responder');
  assert.equal(R.getChallengeCta(ctx({ myClubId: 'club-a' })).kind, 'esperar_respuesta');
});

test('en negociación cualquiera de los dos clubes puede crear la propuesta oficial', () => {
  const base = { challenge: { estado: 'negociacion', club_retador_id: 'club-a', club_retado_id: 'club-b' } };
  assert.equal(R.getChallengeCta(ctx({ ...base, myClubId: 'club-a' })).kind, 'crear_propuesta');
  assert.equal(R.getChallengeCta(ctx({ ...base, myClubId: 'club-b' })).kind, 'crear_propuesta');
});

test('con la prórroga abierta, el club que no ha respondido debe responder', () => {
  const c = ctx({
    challenge: {
      estado: 'negociacion',
      club_retador_id: 'club-a',
      club_retado_id: 'club-b',
      prorroga_abierta_at: '2026-08-10T10:00:00.000Z',
      prorroga_vence_at: '2026-08-11T10:00:00.000Z',
    },
    myClubId: 'club-b',
    miRespuestaProrroga: null,
  });
  assert.equal(R.getChallengeCta(c).kind, 'responder_prorroga');
  // Si ya respondí, dejo de ver el botón y paso a esperar al otro club.
  assert.equal(R.getChallengeCta({ ...c, miRespuestaProrroga: true }).kind, 'esperar_prorroga');
});

test('sólo el club contrario al proponente aprueba la propuesta oficial', () => {
  const base = {
    challenge: { estado: 'esperando_aprobacion', club_retador_id: 'club-a', club_retado_id: 'club-b' },
    propuesta: { id: 'p1', club_proponente_id: 'club-a', estado: 'pendiente' },
  };
  assert.equal(R.getChallengeCta(ctx({ ...base, myClubId: 'club-b' })).kind, 'aprobar_propuesta');
  assert.equal(R.getChallengeCta(ctx({ ...base, myClubId: 'club-a' })).kind, 'esperar_aprobacion');
});

test('publicado y en juego llevan al partido', () => {
  for (const estado of ['publicado', 'en_juego']) {
    const c = ctx({ challenge: { estado, club_retador_id: 'club-a', club_retado_id: 'club-b' } });
    assert.equal(R.getChallengeCta(c).kind, 'ver_partido');
  }
});

test('el resultado lo propone uno y lo confirma el otro, nunca el mismo', () => {
  const base = {
    challenge: { estado: 'esperando_resultado', club_retador_id: 'club-a', club_retado_id: 'club-b' },
  };
  assert.equal(R.getChallengeCta(ctx({ ...base, resultado: null })).kind, 'proponer_resultado');
  const propuestoPorA = { ...base, resultado: { club_proponente_id: 'club-a', estado: 'propuesto' } };
  assert.equal(R.getChallengeCta(ctx({ ...propuestoPorA, myClubId: 'club-b' })).kind, 'confirmar_resultado');
  assert.equal(
    R.getChallengeCta(ctx({ ...propuestoPorA, myClubId: 'club-a' })).kind,
    'esperar_confirmacion'
  );
});

test('los estados cerrados no ofrecen ninguna acción', () => {
  for (const estado of ['finalizado', 'rechazado', 'sin_acuerdo', 'cancelado', 'expirado']) {
    const c = ctx({ challenge: { estado, club_retador_id: 'club-a', club_retado_id: 'club-b' } });
    const cta = R.getChallengeCta(c);
    assert.equal(cta.kind, 'cerrado', `${estado} no debería ofrecer acción`);
    assert.equal(cta.disabled, true);
  }
});

test('un resultado en disputa se distingue de un desafío cerrado', () => {
  const c = ctx({
    challenge: { estado: 'resultado_en_disputa', club_retador_id: 'club-a', club_retado_id: 'club-b' },
  });
  assert.equal(R.getChallengeCta(c).kind, 'en_disputa');
});

test('toda etiqueta de CTA está en español y no queda vacía', () => {
  const estados = Object.values(R.ESTADOS);
  for (const estado of estados) {
    for (const myClubId of ['club-a', 'club-b']) {
      const cta = R.getChallengeCta(
        ctx({ challenge: { estado, club_retador_id: 'club-a', club_retado_id: 'club-b' }, myClubId })
      );
      assert.ok(cta.label && cta.label.length > 0, `CTA sin etiqueta en ${estado}`);
      assert.ok(cta.kind, `CTA sin tipo en ${estado}`);
    }
  }
});

// ─────────────────────────────────────────────── payload de la propuesta

// `crear_propuesta_oficial()` lee el jsonb por nombre de columna. Un campo
// mal nombrado no da error: llega nulo y la RPC lo rechaza con un mensaje
// que no dice cuál era. Estas pruebas fijan los nombres.

const borrador = {
  fecha: '2026-09-01T21:30:00.000Z',
  duracionMin: 90,
  direccion: '  Av. Siempre Viva 742  ',
  canchaNombre: 'Complejo Municipal',
  comuna: 'Ñuñoa',
  region: 'Metropolitana',
  latitud: -33.45,
  longitud: -70.62,
  modalidad: 'futbol7',
  cuposPorClub: 7,
  metodoInscripcion: 'orden_llegada',
  cuotaPorPersona: 4000,
  instrucciones: 'Llegar 20 minutos antes.',
};

test('el payload usa los nombres de columna que espera la RPC', () => {
  const p = R.propuestaOficialPayload(borrador);
  assert.deepEqual(Object.keys(p).sort(), [
    'cancha_nombre', 'comuna', 'cuota_por_persona', 'cupos_por_club',
    'direccion', 'duracion_min', 'fecha', 'instrucciones', 'latitud',
    'longitud', 'metodo_inscripcion', 'modalidad', 'region',
  ]);
  assert.equal(p.duracion_min, 90);
  assert.equal(p.cupos_por_club, 7);
  assert.equal(p.metodo_inscripcion, 'orden_llegada');
  assert.equal(p.cuota_por_persona, 4000);
});

test('la fecha viaja en ISO, no como la escribió el teléfono', () => {
  const p = R.propuestaOficialPayload({ ...borrador, fecha: new Date('2026-09-01T21:30:00Z') });
  assert.equal(p.fecha, '2026-09-01T21:30:00.000Z');
});

test('los textos van recortados y lo vacío viaja como null', () => {
  const p = R.propuestaOficialPayload({ ...borrador, instrucciones: '   ' });
  assert.equal(p.direccion, 'Av. Siempre Viva 742');
  assert.equal(p.instrucciones, null);
});

test('sin cuota, se propone gratis y no null: la columna es NOT NULL', () => {
  const { cuotaPorPersona, ...sinCuota } = borrador;
  assert.equal(R.propuestaOficialPayload(sinCuota).cuota_por_persona, 0);
});

test('un borrador vacío no revienta ni inventa valores', () => {
  const p = R.propuestaOficialPayload({});
  assert.equal(p.fecha, null);
  assert.equal(p.direccion, null);
  assert.equal(p.cupos_por_club, null);
});
