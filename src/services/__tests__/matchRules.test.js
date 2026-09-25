const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../matchRules.js');

/**
 * REGRESIÓN — «Publicar partido abierto» debe partir siempre del paso 1.
 *
 * `PublishMatchScreen` reutiliza la misma ruta (`CreateMatch`) para cada
 * publicación nueva. `isFreshPublishEntry` es el guard que decide si, al
 * recuperar el foco, hay que resetear el wizard al paso 1 con un borrador
 * limpio. El bug real era que nada garantizaba ese reseteo: si la pantalla
 * no se remontaba entre una publicación y la siguiente, el paso (y los
 * datos) de la vez anterior quedaban pegados.
 */

test('sin params (Publicar un partido / botón central) es una entrada nueva', () => {
  assert.equal(R.isFreshPublishEntry(undefined), true);
  assert.equal(R.isFreshPublishEntry(null), true);
  assert.equal(R.isFreshPublishEntry({}), true);
});

test('un partido de clubes prefijado sigue siendo una entrada nueva (parte en paso 1)', () => {
  assert.equal(R.isFreshPublishEntry({ clubChallengeId: 'ch-1' }), true);
  assert.equal(R.isFreshPublishEntry({ clubId: 'club-1' }), true);
});

test('la ruta antigua con matchId (→ edición) no cuenta como entrada nueva', () => {
  assert.equal(R.isFreshPublishEntry({ matchId: 'm-1' }), false);
});

test('un borrador guardado con draftStep válido (1-3) continúa donde quedó', () => {
  assert.equal(R.isFreshPublishEntry({ draftStep: 1 }), false);
  assert.equal(R.isFreshPublishEntry({ draftStep: 2 }), false);
  assert.equal(R.isFreshPublishEntry({ draftStep: 3 }), false);
});

test('un draftStep fuera de rango o inválido no cuenta como borrador guardado', () => {
  assert.equal(R.isFreshPublishEntry({ draftStep: 0 }), true);
  assert.equal(R.isFreshPublishEntry({ draftStep: 4 }), true);
  assert.equal(R.isFreshPublishEntry({ draftStep: '3' }), true);
  assert.equal(R.isFreshPublishEntry({ draftStep: null }), true);
});

/**
 * El filtro «Fin de semana», con el reloj fijado.
 *
 * Auditoría del 15 de septiembre de 2026, hallazgo 19: un domingo a mediodía
 * el partido de esa misma tarde quedaba fuera y aparecía el del sábado
 * siguiente, porque el cálculo buscaba siempre el PRÓXIMO sábado.
 */

const enFinde = (ahora, hora) => {
  const { desde, hasta } = R.ventanaDeFinDeSemana(ahora);
  return hora >= desde && hora < hasta;
};

test('HALLAZGO 19: el domingo al mediodía, el partido de esa tarde SÍ es del fin de semana', () => {
  const domingoMediodia = new Date(2026, 8, 20, 12, 0); // domingo 20 de septiembre
  assert.equal(enFinde(domingoMediodia, new Date(2026, 8, 20, 18, 0)), true, 'esa tarde');
  assert.equal(enFinde(domingoMediodia, new Date(2026, 8, 21, 18, 0)), false, 'el lunes ya no');
  assert.equal(
    enFinde(domingoMediodia, new Date(2026, 8, 26, 18, 0)),
    false,
    'el sábado siguiente es otro fin de semana'
  );
});

test('el domingo no ofrece partidos que ya empezaron esa mañana', () => {
  const domingoMediodia = new Date(2026, 8, 20, 12, 0);
  assert.equal(enFinde(domingoMediodia, new Date(2026, 8, 20, 9, 0)), false);
});

test('el sábado cubre sábado y domingo, y cierra el lunes a las 00:00', () => {
  const sabadoMañana = new Date(2026, 8, 19, 9, 0);
  assert.equal(enFinde(sabadoMañana, new Date(2026, 8, 19, 20, 0)), true, 'esa noche');
  assert.equal(enFinde(sabadoMañana, new Date(2026, 8, 20, 20, 0)), true, 'el domingo');
  assert.equal(enFinde(sabadoMañana, new Date(2026, 8, 21, 0, 0)), false, 'el lunes a las 00:00');
});

test('entre semana apunta al sábado que viene, completo', () => {
  const miercoles = new Date(2026, 8, 16, 15, 0);
  assert.equal(enFinde(miercoles, new Date(2026, 8, 16, 20, 0)), false, 'hoy no');
  assert.equal(enFinde(miercoles, new Date(2026, 8, 19, 10, 0)), true, 'el sábado');
  assert.equal(enFinde(miercoles, new Date(2026, 8, 20, 23, 0)), true, 'el domingo');
  assert.equal(enFinde(miercoles, new Date(2026, 8, 21, 1, 0)), false, 'el lunes ya no');
});

test('el fin de semana que cruza de mes no se rompe', () => {
  // Miércoles 28 de octubre de 2026 → sábado 31 y domingo 1 de noviembre.
  const miercoles = new Date(2026, 9, 28, 12, 0);
  const { desde, hasta } = R.ventanaDeFinDeSemana(miercoles);
  assert.equal(desde.getDate(), 31);
  assert.equal(desde.getMonth(), 9, 'octubre');
  assert.equal(hasta.getDate(), 2, 'cierra el lunes 2 de noviembre');
  assert.equal(hasta.getMonth(), 10, 'noviembre');
  assert.equal(enFinde(miercoles, new Date(2026, 10, 1, 18, 0)), true, 'el domingo 1 de noviembre');
});

test('un domingo de fin de mes también cuenta ese mismo día', () => {
  const domingo = new Date(2026, 10, 1, 12, 0); // domingo 1 de noviembre
  assert.equal(enFinde(domingo, new Date(2026, 10, 1, 19, 0)), true);
  assert.equal(enFinde(domingo, new Date(2026, 10, 2, 0, 0)), false);
});

/**
 * Hallazgo 18: «Ver partidos sin mínimo» mandaba al buscador general sin
 * activar ningún filtro, así que el jugador volvía a ver los mismos partidos
 * que acababan de rechazarlo. Ahora navega con `sinMinimoTrust` puesto y el
 * buscador lo aplica con esta regla.
 */
test('acepta a cualquiera el partido sin mínimo de Trust Score', () => {
  assert.equal(R.aceptaACualquiera({ min_trust_score: 0 }), true);
  assert.equal(R.aceptaACualquiera({ min_trust_score: null }), true, 'sin dato = sin mínimo');
  assert.equal(R.aceptaACualquiera({}), true);
  assert.equal(R.aceptaACualquiera({ min_trust_score: 50 }), false);
  assert.equal(R.aceptaACualquiera({ min_trust_score: 1 }), false);
});

// ── el turno de la lista de espera (hallazgo 11) ──────────────

const partidoAbierto = {
  id: 'm-1',
  id_organizador: 'org',
  estado: 'abierto',
  hora: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
  cupos_totales: 10,
  cupos_disponibles: 1,
  aprobacion: 'inmediata',
  min_trust_score: 0,
};

test('turnoDeLaLista solo cuenta el plazo que sigue vigente', () => {
  const ahora = new Date('2026-09-15T20:00:00Z');
  assert.equal(R.turnoDeLaLista({}, ahora), null, 'sin plazo no hay turno');
  assert.equal(R.turnoDeLaLista({ confirmar_antes_de: null }, ahora), null);
  assert.equal(
    R.turnoDeLaLista({ confirmar_antes_de: '2026-09-15T19:59:00Z' }, ahora),
    null,
    'un plazo vencido no es un turno'
  );
  const turno = R.turnoDeLaLista({ confirmar_antes_de: '2026-09-15T20:18:30Z' }, ahora);
  assert.equal(turno.minutos, 19, 'redondea hacia arriba: quedan 18 min y medio');
});

test('HALLAZGO 11: con el turno vigente, el CTA ofrece tomar el cupo', () => {
  const ahora = new Date();
  const cta = R.getCtaState({
    match: partidoAbierto,
    myId: 'yo',
    myWaitlist: {
      posicion: 1,
      confirmar_antes_de: new Date(ahora.getTime() + 12 * 60000).toISOString(),
    },
    online: true,
    ahora,
  });
  assert.equal(cta.kind, 'tomar_cupo');
  assert.match(cta.hint, /12 minutos/);
});

test('sin turno vigente sigue siendo «en lista de espera»', () => {
  const ahora = new Date();
  const cta = R.getCtaState({
    match: partidoAbierto,
    myId: 'yo',
    myWaitlist: { posicion: 3, confirmar_antes_de: null },
    online: true,
    ahora,
  });
  assert.equal(cta.kind, 'en_espera');
  assert.match(cta.label, /N° 3/);
});

test('el turno recién vencido vuelve a «en lista de espera» sin recargar', () => {
  const ahora = new Date();
  const entrada = {
    posicion: 1,
    confirmar_antes_de: new Date(ahora.getTime() - 1000).toISOString(),
  };
  assert.equal(R.getCtaState({ match: partidoAbierto, myId: 'yo', myWaitlist: entrada, ahora }).kind, 'en_espera');
});

// ── el partido caído manda (hallazgo 14) ──────────────────────

test('HALLAZGO 14: un inscrito en un partido cancelado NO ve «Cupo confirmado»', () => {
  const cta = R.getCtaState({
    match: { ...partidoAbierto, estado: 'cancelado', motivo_cancelacion: 'Llueve' },
    myId: 'yo',
    myAttendee: { estado: 'inscrito' },
    online: true,
  });
  assert.equal(cta.kind, 'bloqueado');
  assert.match(cta.label, /cancelado/i);
});

test('un inscrito en un partido terminado tampoco', () => {
  const cta = R.getCtaState({
    match: {
      ...partidoAbierto,
      estado: 'finalizado',
      hora: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    },
    myId: 'yo',
    myAttendee: { estado: 'confirmado_gps' },
    online: true,
  });
  assert.equal(cta.kind, 'bloqueado');
});

test('en un partido vivo el inscrito sigue viendo su cupo', () => {
  const cta = R.getCtaState({
    match: partidoAbierto,
    myId: 'yo',
    myAttendee: { estado: 'inscrito' },
    online: true,
  });
  assert.equal(cta.kind, 'confirmado');
});

// ── la ventana del GPS (hallazgo 15) ──────────────────────────

test('HALLAZGO 15: se puede confirmar por GPS 15 minutos ANTES de empezar', () => {
  const hora = new Date('2026-09-15T22:00:00Z');
  const partido = { hora: hora.toISOString(), duracion_min: 90 };
  assert.equal(R.enVentanaGps(partido, new Date('2026-09-15T21:45:00Z')), true, '15 min antes');
  assert.equal(R.enVentanaGps(partido, new Date('2026-09-15T21:30:00Z')), true, 'justo a los 30 min');
  assert.equal(R.enVentanaGps(partido, new Date('2026-09-15T21:29:00Z')), false, 'antes de eso no');
});

test('la ventana cierra 30 minutos después del término, no al pitazo final', () => {
  const partido = { hora: '2026-09-15T22:00:00Z', duracion_min: 90 };
  assert.equal(R.enVentanaGps(partido, new Date('2026-09-15T23:45:00Z')), true, 'durante');
  assert.equal(R.enVentanaGps(partido, new Date('2026-09-16T00:00:00Z')), true, 'a los 30 min del final');
  assert.equal(R.enVentanaGps(partido, new Date('2026-09-16T00:01:00Z')), false, 'pasada la ventana');
});

test('sin hora no hay ventana que ofrecer', () => {
  assert.equal(R.ventanaGps({}), null);
  assert.equal(R.enVentanaGps(null), false);
});

// ── lo que cuesta salirse (hallazgo 16) ───────────────────────

test('HALLAZGO 16: el texto de salida dice los puntos que de verdad se cobran', () => {
  const lejos = new Date(Date.now() + 10 * 3600 * 1000).toISOString();
  const texto = R.leaveRuleText(lejos);
  assert.doesNotMatch(texto, /sin sanción/i, 'prometía «sin sanción» y se descontaban 3');
  assert.match(texto, new RegExp(`${R.PENALTY.leaveEarly} puntos`));
  const cerca = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  assert.match(R.leaveRuleText(cerca), new RegExp(`${R.PENALTY.leaveLate} puntos`));
});

// ── «Mi cupo» (hallazgo 14) ───────────────────────────────────

const partidoDeHoy = {
  id: 'm-2',
  id_organizador: 'org',
  estado: 'abierto',
  hora: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
  duracion_min: 90,
  recordatorio_1h: true,
};

test('HALLAZGO 14: sin inscripción, «Mi cupo» no dice «Cupo confirmado»', () => {
  const e = R.estadoDeMiCupo({ match: partidoDeHoy, mine: null });
  assert.equal(e.code, 'sin_cupo');
  assert.doesNotMatch(e.titulo, /confirmado/i);
  assert.equal(e.puedeSalir, false, 'no puede «salir» de donde no está');
  assert.equal(e.puedeChat, false);
});

test('quien se salió tampoco conserva la pantalla de su cupo', () => {
  const e = R.estadoDeMiCupo({ match: partidoDeHoy, mine: { estado: 'cancelado' } });
  assert.equal(e.code, 'sin_cupo');
});

test('una solicitud pendiente es su propio estado, no un cupo', () => {
  const e = R.estadoDeMiCupo({ match: partidoDeHoy, mine: { estado: 'pendiente' } });
  assert.equal(e.code, 'pendiente');
  assert.equal(e.puedeChat, false, 'el chat se abre cuando el cupo está confirmado');
});

test('HALLAZGO 14: en un partido cancelado, el estado del partido manda', () => {
  const e = R.estadoDeMiCupo({
    match: { ...partidoDeHoy, estado: 'cancelado', motivo_cancelacion: 'Cancha inundada' },
    mine: { estado: 'inscrito' },
  });
  assert.equal(e.code, 'cancelado');
  assert.doesNotMatch(e.titulo, /confirmado/i);
  assert.match(e.texto, /Cancha inundada/);
  assert.equal(e.puedeSalir, false, 'no tiene sentido salirse de un partido que no se juega');
  assert.equal(e.puedeConfirmarGps, false, 'ni confirmar asistencia a algo que no ocurrió');
});

test('un inscrito en un partido vivo ve su cupo y puede salir', () => {
  const e = R.estadoDeMiCupo({ match: partidoDeHoy, mine: { estado: 'inscrito' } });
  assert.equal(e.code, 'confirmado');
  assert.equal(e.puedeSalir, true);
});

test('el GPS aparece en «Mi cupo» dentro de la ventana, no solo durante el partido', () => {
  const hora = new Date('2026-09-15T22:00:00Z');
  const match = { ...partidoDeHoy, hora: hora.toISOString() };
  const mine = { estado: 'inscrito' };
  const antes = R.estadoDeMiCupo({ match, mine, ahora: new Date('2026-09-15T21:45:00Z') });
  assert.equal(antes.puedeConfirmarGps, true, '15 minutos antes ya se puede');
  const lejos = R.estadoDeMiCupo({ match, mine, ahora: new Date('2026-09-15T18:00:00Z') });
  assert.equal(lejos.puedeConfirmarGps, false, 'cuatro horas antes no');
});

test('después de jugar todavía se alcanza a confirmar, media hora más', () => {
  const match = { ...partidoDeHoy, hora: '2026-09-15T22:00:00Z', duracion_min: 90 };
  const e = R.estadoDeMiCupo({
    match,
    mine: { estado: 'inscrito' },
    ahora: new Date('2026-09-15T23:50:00Z'),
  });
  assert.equal(e.code, 'finalizado');
  assert.equal(e.puedeConfirmarGps, true);
  assert.equal(e.puedeSalir, false);
});

// ── el chat del partido (hallazgo 17) ─────────────────────────

test('HALLAZGO 17: una solicitud pendiente no abre el chat', () => {
  const a = R.accesoAlChatDelPartido({ estado: 'pendiente' }, { estado: 'abierto' });
  assert.equal(a.canRead, false);
  assert.equal(a.canWrite, false, 'el compositor aparecía habilitado');
  assert.match(a.message, /cuando el organizador confirme tu cupo/);
});

test('HALLAZGO 17: en un partido cancelado el chat queda en solo lectura', () => {
  const a = R.accesoAlChatDelPartido({ estado: 'inscrito' }, { estado: 'cancelado' });
  assert.equal(a.canRead, true, 'lo conversado se puede seguir leyendo');
  assert.equal(a.canWrite, false);
  assert.match(a.title, /cancel/i);
});

test('quien no está inscrito no entra al chat', () => {
  assert.equal(R.accesoAlChatDelPartido(null, { estado: 'abierto' }).canRead, false);
  assert.equal(R.accesoAlChatDelPartido({ estado: 'cancelado' }, { estado: 'abierto' }).canRead, false);
});

test('un inscrito en un partido vivo escribe con normalidad', () => {
  const a = R.accesoAlChatDelPartido({ estado: 'inscrito' }, { estado: 'abierto' });
  assert.equal(a.canWrite, true);
  assert.equal(a.reason, null);
  assert.equal(R.accesoAlChatDelPartido({ estado: 'confirmado_gps' }, { estado: 'lleno' }).canWrite, true);
});

test('sin datos del partido no se bloquea a quien sí está inscrito', () => {
  assert.equal(R.accesoAlChatDelPartido({ estado: 'inscrito' }, null).canWrite, true);
});

/**
 * `rangoDeFecha` es la definición ÚNICA de cada ventana: la usa la consulta a
 * la base y el filtro en memoria. Cuando cada uno calculaba lo suyo, «Fin de
 * semana» significaba una cosa en la base y otra en la pantalla.
 */
test('rangoDeFecha: «hoy» va desde ahora hasta la medianoche', () => {
  const ahora = new Date(2026, 8, 16, 15, 30); // miércoles
  const { desde, hasta } = R.rangoDeFecha('hoy', ahora);
  assert.equal(desde.getTime(), ahora.getTime(), 'desde ahora: no ofrece lo que ya empezó');
  assert.equal(hasta.getDate(), 17);
  assert.equal(hasta.getHours(), 0);
});

test('rangoDeFecha: «mañana» es el día completo siguiente', () => {
  const { desde, hasta } = R.rangoDeFecha('manana', new Date(2026, 8, 16, 15, 30));
  assert.equal(desde.getDate(), 17);
  assert.equal(desde.getHours(), 0);
  assert.equal(hasta.getDate(), 18);
});

test('rangoDeFecha: «finde» delega en la ventana del fin de semana', () => {
  const domingo = new Date(2026, 8, 20, 12, 0);
  assert.deepEqual(R.rangoDeFecha('finde', domingo), R.ventanaDeFinDeSemana(domingo));
});

test('rangoDeFecha: sin ventana no acota nada', () => {
  assert.deepEqual(R.rangoDeFecha('todos'), { desde: null, hasta: null });
  assert.deepEqual(R.rangoDeFecha(undefined), { desde: null, hasta: null });
});

/**
 * REGRESIÓN N10 — un partido cancelado no ofrece calificar a los jugadores.
 *
 * EL FALLO: dos jugadores confirmaban por GPS antes del inicio, el organizador
 * cancelaba el partido y, pasada la hora de término, el detalle mostraba
 * «Calificar a los jugadores». Cancelar NO borra las marcas de GPS, y la regla
 * sólo miraba «confirmé» y «ya terminó». Además se comprobó contra producción
 * que la política de `ratings` aceptaba guardar esas notas: por eso el arreglo
 * va en los dos lados, y acá queda el del cliente (migración 124 el otro).
 */

const TERMINADO = { hora: '2026-09-20T20:00:00.000Z', duracion_min: 90, estado: 'finalizado' };
const DESPUES = new Date('2026-09-20T23:00:00.000Z');
const CONFIRMADO = { estado: 'confirmado_gps' };

test('un partido jugado, con GPS confirmado y ya terminado, se puede calificar', () => {
  assert.equal(R.puedeCalificar(TERMINADO, CONFIRMADO, DESPUES), true);
});

test('un partido CANCELADO no se califica, aunque el GPS esté confirmado', () => {
  assert.equal(
    R.puedeCalificar({ ...TERMINADO, estado: 'cancelado' }, CONFIRMADO, DESPUES),
    false
  );
  assert.equal(R.partidoAdmiteEvaluaciones({ ...TERMINADO, estado: 'cancelado' }), false);
});

test('sin confirmar el GPS no se califica, y antes de que termine tampoco', () => {
  assert.equal(R.puedeCalificar(TERMINADO, { estado: 'inscrito' }, DESPUES), false);
  assert.equal(R.puedeCalificar(TERMINADO, null, DESPUES), false);
  assert.equal(
    R.puedeCalificar(TERMINADO, CONFIRMADO, new Date('2026-09-20T20:30:00.000Z')),
    false
  );
});

test('un partido «abierto» que ya pasó sí se califica: lo que manda es el reloj', () => {
  // `finalizado` lo escribe el organizador al registrar asistencia. Que no lo
  // haya hecho no puede dejar a los jugadores sin poder evaluarse.
  assert.equal(R.puedeCalificar({ ...TERMINADO, estado: 'abierto' }, CONFIRMADO, DESPUES), true);
});

// ── Rango de edad: una sola regla para publicar y para editar ────────
//
// EL FALLO: `EditMatchScreen` tenía su propia copia de la validación y sólo
// comparaba el mínimo contra el máximo. Sin los límites de
// `matches_edad_check` se podía guardar `edad_min = 5` y estrellarse contra
// la restricción con el error crudo de Postgres.

test('validarRangoEdad: los límites son los de matches_edad_check (12 a 99)', () => {
  assert.match(R.validarRangoEdad(5, 40), /entre 12 y 99/);
  assert.match(R.validarRangoEdad(20, 120), /entre 12 y 99/);
  assert.equal(R.validarRangoEdad(12, 99), null);
});

test('validarRangoEdad: el mínimo tiene que ser ESTRICTAMENTE menor', () => {
  // La base exige `edad_min < edad_max`, no `<=`.
  assert.match(R.validarRangoEdad(30, 30), /menor que la máxima/);
  assert.equal(R.validarRangoEdad(29, 30), null);
});

test('validarRangoEdad: sin rango no hay error', () => {
  assert.equal(R.validarRangoEdad('', ''), null);
  assert.equal(R.validarRangoEdad(null, null), null);
  assert.equal(R.validarRangoEdad(18, ''), null);
});

// ── Lo que se dice al confirmar por GPS ─────────────────────────────
//
// EL FALLO: se prometía «+1 Trust Score» mirando sólo que hubiera distancia.
// El servidor sube con `LEAST(trust_score + 1, 100)` y el puntaje NACE en
// 100: al revisarlo, 32 de 34 perfiles estaban en el tope, así que el caso
// común era prometer un punto que no se daba. La migración 132 devuelve
// `trust_delta` y esta función lo traduce.

test('textoConfirmacionGps: con el puntaje en el tope no promete el punto', () => {
  const t = R.textoConfirmacionGps({ ok: true, distance: 42, trust_delta: 0, trust_score: 100 });
  assert.doesNotMatch(t.detalle, /\+1/);
  assert.match(t.detalle, /al máximo/);
  assert.match(t.detalle, /42 m/);
});

test('textoConfirmacionGps: cuando el punto SÍ se dio, lo dice', () => {
  const t = R.textoConfirmacionGps({ ok: true, distance: 10, trust_delta: 1, trust_score: 81 });
  assert.match(t.detalle, /\+1 de Trust Score/);
});

test('textoConfirmacionGps: «ya estaba confirmado» no se anuncia como recién hecho', () => {
  const t = R.textoConfirmacionGps({ ok: true, already: true });
  assert.match(t.titulo, /ya estaba/i);
});

test('textoConfirmacionGps: sin la migración 132 no se inventa el punto', () => {
  // Una base vieja no manda `trust_delta`; entonces sólo se confirma el hecho.
  const t = R.textoConfirmacionGps({ ok: true, distance: 15 });
  assert.doesNotMatch(t.detalle, /Trust Score/);
  assert.match(t.detalle, /15 m/);
});

test('textoConfirmacionGps: un fallo no produce texto de éxito', () => {
  assert.equal(R.textoConfirmacionGps({ ok: false, reason: 'Estás demasiado lejos' }), null);
});

/**
 * T05 — una restricción no se le atribuye a TrueScore.
 *
 * `profiles` guarda `estado` y `suspended_until`, y nada más: el motivo de
 * una restricción NO está en ninguna columna. Decir «tu Trust Score llegó a
 * 0» era adivinarlo, y con TrueScore (fase 1) es además falso —
 * `tg_auto_suspend` devuelve `new` sin tocar nada cuando el flag está
 * activo, así que ninguna cuenta se suspende por puntaje bajo—. Una cuenta
 * restringida por un reporte leía que su culpa era el puntaje.
 */

const RESTRINGIDO = {
  match: { id: 'm-1', estado: 'abierto', hora: '2099-01-01T12:00:00Z', cupos_disponibles: 4 },
  myId: 'u-1',
  online: true,
};

test('T05: una cuenta restringida no lee que su Trust Score llegó a 0', () => {
  const block = R.getBlockReason({ ...RESTRINGIDO, myProfile: { suspended: true } });
  assert.equal(block.code, 'restringido');
  assert.doesNotMatch(block.detail, /Trust ?Score|TrueScore/i);
  assert.doesNotMatch(block.detail, /llegó a 0/i);
  assert.match(block.detail, /\S/);
});

test('T05: si hay fecha de reactivación, se conserva', () => {
  const block = R.getBlockReason({
    ...RESTRINGIDO,
    myProfile: { suspended: true, suspended_until: '2026-10-15T15:00:00Z' },
  });
  // El formato exacto lo pone `toLocaleDateString('es-CL')` y varía entre
  // motores («15-octubre» / «15 de octubre»); lo que se prueba es que la
  // fecha sigue ahí, no cómo la escribe el runtime.
  assert.match(block.detail, /15.*octubre/);
  assert.doesNotMatch(block.detail, /Trust ?Score|TrueScore/i);
});

test('T05: la restricción sigue bloqueando — el cambio es el texto, no la regla', () => {
  assert.equal(R.getBlockReason({ ...RESTRINGIDO, myProfile: { suspended: false } })?.code, undefined);
  assert.equal(R.getBlockReason({ ...RESTRINGIDO, myProfile: { suspended: true } }).code, 'restringido');
});
