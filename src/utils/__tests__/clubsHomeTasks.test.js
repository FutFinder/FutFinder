/**
 * Pruebas de la derivación de la portada de Clubes.
 *
 * LO QUE ESTAS PRUEBAS CUIDAN, en orden de importancia:
 *
 *   1. QUE EL BADGE NO MIENTA. El número de la sección «Pendiente para ti» y
 *      el de la barra inferior son EL MISMO, y cuentan solo tareas que el
 *      usuario puede accionar. Una tarea resuelta o vencida que siga sumando
 *      manda al usuario a buscar algo que ya no está.
 *   2. QUE EL «VER N MÁS» CUENTE TAREAS, NO TARJETAS. Con el tope de 4, lo
 *      oculto puede incluir cosas sin acción; prometer «4 pendientes más» y
 *      mostrar cuatro avisos muertos es el mismo error que el anterior.
 *   3. QUE UNA SOLICITUD PENDIENTE NO OCUPE CUPO. Contarla como integrante
 *      hace que un club con cupo diga que está lleno.
 *   4. QUE EL JUGADOR VEA TODO Y NO PUEDA NADA. Ve la información, su CTA es
 *      «Ver», y las solicitudes de ingreso no le aparecen.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const D = require('../clubsHomeTasks.js');

const AHORA = new Date('2026-08-28T12:00:00Z');

/** Fuentes vacías: cada prueba llena solo lo que le importa. */
function fuentes(extra = {}) {
  return {
    desafiosRecibidos: [],
    propuestas: [],
    cambiosDePartido: [],
    nomina: null,
    solicitudes: [],
    sancion: null,
    proximoPartido: null,
    ...extra,
  };
}

const DESAFIO = {
  id: 'des-1',
  estado: 'pendiente',
  otroClub: { id: 'c9', nombre: 'lagardere fcv' },
  created_at: '2026-08-27T12:00:00Z',
};

// ── El badge ────────────────────────────────────────────────────────

test('el badge cuenta solo las tareas que se pueden accionar', () => {
  const tareas = [
    { id: 'a', status: 'abierta' },
    { id: 'b', status: 'resuelta' },
    { id: 'c', status: 'vencida' },
    { id: 'd', status: 'abierta' },
  ];
  assert.equal(D.contarConAccion(tareas), 2);
});

test('una tarea resuelta deja de contar de inmediato', () => {
  const antes = [{ id: 'a', status: 'abierta' }];
  const despues = [{ id: 'a', status: 'resuelta' }];
  assert.equal(D.contarConAccion(antes), 1);
  assert.equal(D.contarConAccion(despues), 0);
});

test('sin tareas el badge es cero, no undefined', () => {
  assert.equal(D.contarConAccion([]), 0);
  assert.equal(D.contarConAccion(undefined), 0);
});

// ── El tope de 4 y el «ver más» ─────────────────────────────────────

test('se muestran cuatro tarjetas como máximo', () => {
  const tareas = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, status: 'abierta' }));
  const { visibles, ocultas } = D.repartirTareas(tareas);
  assert.equal(visibles.length, 4);
  assert.equal(ocultas.length, 3);
});

test('el «ver más» cuenta tareas con acción ocultas, no tarjetas ocultas', () => {
  // Cuatro visibles + tres ocultas, de las cuales solo una tiene acción.
  const tareas = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, status: 'abierta' })),
    { id: 'o1', status: 'abierta' },
    { id: 'o2', status: 'vencida' },
    { id: 'o3', status: 'resuelta' },
  ];
  const r = D.repartirTareas(tareas);
  assert.equal(r.ocultas.length, 3);
  assert.equal(r.ocultasConAccion, 1);
  assert.equal(r.etiquetaVerMas, 'Ver 1 pendiente más');
});

test('si lo oculto no tiene acción, el texto habla de avisos', () => {
  const tareas = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, status: 'abierta' })),
    { id: 'o1', status: 'vencida' },
    { id: 'o2', status: 'resuelta' },
  ];
  const r = D.repartirTareas(tareas);
  assert.equal(r.ocultasConAccion, 0);
  assert.equal(r.etiquetaVerMas, 'Ver 2 avisos más');
});

test('con cuatro o menos no hay botón de «ver más»', () => {
  const tareas = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, status: 'abierta' }));
  assert.equal(D.repartirTareas(tareas).etiquetaVerMas, null);
});

test('el plural se respeta: una sola pendiente no dice «pendientes»', () => {
  const tareas = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, status: 'abierta' })),
    { id: 'o1', status: 'abierta' },
  ];
  assert.equal(D.repartirTareas(tareas).etiquetaVerMas, 'Ver 1 pendiente más');
});

// ── Cupos del plan ──────────────────────────────────────────────────

test('las solicitudes pendientes NO ocupan cupo de integrante', () => {
  const cupos = D.cuposDelPlan({ plan: 'estandar', miembrosActivos: 11, admins: 1 });
  assert.equal(cupos.members.used, 11);
  assert.equal(cupos.members.max, 15);
});

test('el plan premium sube los dos límites', () => {
  const cupos = D.cuposDelPlan({ plan: 'premium', miembrosActivos: 20, admins: 2 });
  assert.equal(cupos.members.max, 26);
  assert.equal(cupos.admins.max, 3);
});

test('un plan desconocido cae en estándar, nunca deja sin límite', () => {
  const cupos = D.cuposDelPlan({ plan: 'inventado', miembrosActivos: 3, admins: 1 });
  assert.equal(cupos.members.max, 15);
  assert.equal(cupos.admins.max, 1);
});

// ── Permisos ────────────────────────────────────────────────────────

test('el jugador no puede resolver nada', () => {
  const can = D.permisosDeClub('jugador');
  for (const clave of Object.keys(can)) assert.equal(can[clave], false, clave);
});

test('el admin puede todo lo del club', () => {
  const can = D.permisosDeClub('admin');
  for (const clave of Object.keys(can)) assert.equal(can[clave], true, clave);
});

test('un rol desconocido se trata como jugador, no como admin', () => {
  assert.equal(D.permisosDeClub('capitan').editarClub, false);
  assert.equal(D.permisosDeClub(undefined).editarClub, false);
});

// ── Normalización de las siete fuentes ──────────────────────────────

test('un desafío recibido se vuelve la tarea principal, en tono acento', () => {
  const [t] = D.normalizarTareas(fuentes({ desafiosRecibidos: [DESAFIO] }), {
    rol: 'admin',
    ahora: AHORA,
  });
  assert.equal(t.type, 'desafio');
  assert.equal(t.tone, 'accent');
  assert.equal(t.cta, 'Responder');
  assert.equal(t.target, 'ClubChallenges');
  assert.equal(t.status, 'abierta');
});

test('al jugador el mismo desafío le llega como «Ver» y dice quién responde', () => {
  const [t] = D.normalizarTareas(fuentes({ desafiosRecibidos: [DESAFIO] }), {
    rol: 'jugador',
    ahora: AHORA,
  });
  assert.equal(t.cta, 'Ver');
  assert.match(t.subtitle, /responde un admin/);
});

test('el jugador NO ve las solicitudes de ingreso', () => {
  const f = fuentes({ solicitudes: [{ request_id: 'r1', username: 'pedro' }] });
  const comoAdmin = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  const comoJugador = D.normalizarTareas(f, { rol: 'jugador', ahora: AHORA });
  assert.equal(comoAdmin.length, 1);
  assert.equal(comoAdmin[0].type, 'solicitud');
  assert.equal(comoJugador.length, 0);
});

test('un desafío ya expirado entra como vencido y no suma al badge', () => {
  const f = fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'expirado' }] });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas[0].status, 'vencida');
  assert.equal(D.contarConAccion(tareas), 0);
});

test('las siete fuentes producen sus siete tipos, en el orden del handoff', () => {
  const f = fuentes({
    desafiosRecibidos: [DESAFIO],
    propuestas: [{ id: 'p1', challenge_id: 'des-1' }],
    cambiosDePartido: [{ id: 'cb1', match_id: 'm1' }],
    nomina: { matchId: 'm1', confirmados: 9, cupos: 11 },
    solicitudes: [{ request_id: 'r1', username: 'pedro' }],
    sancion: { id: 's1', motivo: 'incomparecencia' },
    proximoPartido: { id: 'm1', hora: '2026-08-30T23:00:00Z' },
  });
  const tipos = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA }).map((t) => t.type);
  assert.deepEqual(tipos, [
    'desafio', 'propuesta', 'cambio', 'nomina', 'solicitud', 'sancion', 'partido',
  ]);
});

test('cada tarea trae un id único, para que la lista no se mezcle', () => {
  const f = fuentes({
    desafiosRecibidos: [DESAFIO, { ...DESAFIO, id: 'des-2' }],
    solicitudes: [{ request_id: 'r1' }, { request_id: 'r2' }],
  });
  const ids = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA }).map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('sin nada pendiente la lista es vacía, no null', () => {
  assert.deepEqual(D.normalizarTareas(fuentes(), { rol: 'admin', ahora: AHORA }), []);
});

test('no revienta con fuentes ausentes', () => {
  assert.deepEqual(D.normalizarTareas(undefined, { rol: 'admin', ahora: AHORA }), []);
  assert.deepEqual(D.normalizarTareas({}, {}), []);
});

// ═══════════════════════════════════════════════════════════════════
// VOCABULARIOS TERMINALES, UNO POR TABLA
//
// El defecto que estas pruebas fijan: un único conjunto de «estados
// muertos» aplicado a tres tablas que no comparten vocabulario. Una
// propuesta `rechazada` (femenino) o un cambio `caducado` quedaban
// abiertos PARA SIEMPRE y el badge los contaba.
//
// Los estados de cada tabla salen del `check` de su migración, no de
// memoria:
//   club_challenges           → 41_desafios_estados_y_chat.sql:38-55
//   club_challenge_proposals  → 43_desafios_plazos_y_propuesta.sql:157
//   club_match_changes        → 46_cambios_de_partido.sql:102
// ═══════════════════════════════════════════════════════════════════

const { ESTADOS } = require('../../services/clubChallengeRules.js');

/** Qué espera la portada de cada estado real de `club_challenges`. */
const ESPERADO_DESAFIO = {
  pendiente: 'abierta',
  negociacion: 'abierta',
  esperando_aprobacion: 'abierta',
  publicado: 'abierta',
  en_juego: 'abierta',
  esperando_resultado: 'abierta',
  resultado_en_disputa: 'abierta',
  bloqueado_sancion: 'abierta',
  finalizado: 'resuelta',
  aceptado: 'resuelta',
  rechazado: 'vencida',
  sin_acuerdo: 'vencida',
  cancelado: 'vencida',
  expirado: 'vencida',
};

const ESPERADO_PROPUESTA = {
  pendiente: 'abierta',
  aprobada: 'resuelta',
  rechazada: 'vencida',
  caducada: 'vencida',
};

const ESPERADO_CAMBIO = {
  pendiente: 'abierta',
  aceptado: 'resuelta',
  rechazado: 'vencida',
  caducado: 'vencida',
};

test('la tabla de estados del desafío cubre exactamente los de la migración 41', () => {
  // Si una migración agrega un estado y alguien lo suma a `ESTADOS`, esta
  // prueba falla hasta que la portada decida qué hacer con él. Es la red
  // que faltaba: el hueco anterior fue justo un estado sin clasificar.
  assert.deepEqual(
    Object.keys(ESPERADO_DESAFIO).sort(),
    Object.values(ESTADOS).sort()
  );
});

test('cada estado real de club_challenges se clasifica como corresponde', () => {
  for (const [estado, esperado] of Object.entries(ESPERADO_DESAFIO)) {
    assert.equal(D.estadoDeTarea('desafio', estado), esperado, `desafío en '${estado}'`);
  }
});

test('cada estado real de club_challenge_proposals se clasifica como corresponde', () => {
  for (const [estado, esperado] of Object.entries(ESPERADO_PROPUESTA)) {
    assert.equal(D.estadoDeTarea('propuesta', estado), esperado, `propuesta en '${estado}'`);
  }
});

test('cada estado real de club_match_changes se clasifica como corresponde', () => {
  for (const [estado, esperado] of Object.entries(ESPERADO_CAMBIO)) {
    assert.equal(D.estadoDeTarea('cambio', estado), esperado, `cambio en '${estado}'`);
  }
});

test('el vocabulario de una tabla no contamina el de otra', () => {
  // 'caducada' es de propuestas y 'caducado' de cambios: ni uno ni otro
  // significan nada en `club_challenges`, así que ahí no cierran nada.
  assert.equal(D.estadoDeTarea('desafio', 'caducada'), 'abierta');
  assert.equal(D.estadoDeTarea('desafio', 'caducado'), 'abierta');
  // 'sin_acuerdo' es de desafíos; una propuesta nunca lo tiene.
  assert.equal(D.estadoDeTarea('propuesta', 'sin_acuerdo'), 'abierta');
  // 'aceptado' cierra un cambio pero 'aprobada' no existe ahí.
  assert.equal(D.estadoDeTarea('cambio', 'aprobada'), 'abierta');
});

// ── Los tres estados que el conjunto único dejaba abiertos ──────────

test('un desafío sin_acuerdo queda vencido y no suma al badge', () => {
  const f = fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'sin_acuerdo' }] });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas[0].status, 'vencida');
  assert.equal(D.contarConAccion(tareas), 0);
});

test('una propuesta rechazada queda vencida y no suma al badge', () => {
  // El femenino es el punto: el conjunto viejo tenía 'rechazado'.
  const f = fuentes({ propuestas: [{ id: 'p1', estado: 'rechazada' }] });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas[0].status, 'vencida');
  assert.equal(D.contarConAccion(tareas), 0);
});

test('una propuesta caducada queda vencida y no suma al badge', () => {
  const f = fuentes({ propuestas: [{ id: 'p1', estado: 'caducada' }] });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas[0].status, 'vencida');
  assert.equal(D.contarConAccion(tareas), 0);
});

test('un cambio de partido caducado queda vencido y no suma al badge', () => {
  const f = fuentes({ cambiosDePartido: [{ id: 'cb1', estado: 'caducado' }] });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas[0].status, 'vencida');
  assert.equal(D.contarConAccion(tareas), 0);
});

test('un desafío bloqueado por sanción sigue vivo: no es un estado terminal', () => {
  // Retirar la sanción lo devuelve al estado en que estaba
  // (`TRANSICIONES.bloqueado_sancion`), así que marcarlo vencido mentiría.
  const f = fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'bloqueado_sancion' }] });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas[0].status, 'abierta');
});

// ── «Aceptado» salió bien: no es un fracaso, y no queda en la lista ──

test('un cambio de partido aceptado desaparece: se aplicó, no venció', () => {
  const f = fuentes({ cambiosDePartido: [{ id: 'cb1', estado: 'aceptado' }] });
  assert.deepEqual(D.normalizarTareas(f, { rol: 'admin', ahora: AHORA }), []);
});

test('una propuesta aprobada desaparece: se aprobó, no venció', () => {
  const f = fuentes({ propuestas: [{ id: 'p1', estado: 'aprobada' }] });
  assert.deepEqual(D.normalizarTareas(f, { rol: 'admin', ahora: AHORA }), []);
});

test('un desafío finalizado desaparece: se jugó', () => {
  const f = fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'finalizado' }] });
  assert.deepEqual(D.normalizarTareas(f, { rol: 'admin', ahora: AHORA }), []);
});

test('un desafío aceptado del flujo legado desaparece: ya no hay qué responder', () => {
  const f = fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'aceptado' }] });
  assert.deepEqual(D.normalizarTareas(f, { rol: 'admin', ahora: AHORA }), []);
});

test('lo resuelto no ocupa lugar en el tope de cuatro visibles', () => {
  // Si «resuelta» se colara en la lista, empujaría fuera de las cuatro
  // visibles a una tarea que el usuario sí puede accionar.
  const f = fuentes({
    desafiosRecibidos: [
      { ...DESAFIO, id: 'd1', estado: 'aceptado' },
      { ...DESAFIO, id: 'd2', estado: 'finalizado' },
      { ...DESAFIO, id: 'd3', estado: 'pendiente' },
    ],
  });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas.length, 1);
  assert.equal(tareas[0].id, 'desafio:d3');
  assert.equal(D.contarConAccion(tareas), 1);
});

test('el badge no cuenta una propuesta rechazada ni un cambio caducado', () => {
  // La regresión completa del defecto crítico, en una sola prueba.
  const f = fuentes({
    desafiosRecibidos: [DESAFIO],
    propuestas: [{ id: 'p1', estado: 'rechazada' }],
    cambiosDePartido: [{ id: 'cb1', estado: 'caducado' }],
  });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas.length, 3);
  assert.equal(D.contarConAccion(tareas), 1);
});

// ═══════════════════════════════════════════════════════════════════
// EL TÍTULO DEL PRÓXIMO PARTIDO
//
// Se cuenta por día de calendario, no por bloques de 24 horas: un
// partido esta noche es «hoy» aunque falten 11 horas, y uno mañana
// temprano es «mañana» aunque falten 9. Es lo que dice la gente.
//
// Las fechas se arman con setDate/setHours, que trabajan en hora
// local, para que la prueba no dependa del huso donde se ejecute.
// ═══════════════════════════════════════════════════════════════════

/** Un instante en hora local: `dias` desde `base`, a las `hora` en punto. */
function localISO(base, dias, hora) {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  d.setHours(hora, 0, 0, 0);
  return d.toISOString();
}

/** Las 9:00 en punto del día de AHORA, en hora local. */
const HOY_09 = (() => {
  const d = new Date(AHORA);
  d.setHours(9, 0, 0, 0);
  return d;
})();

function tareaPartido(hora, ahora = HOY_09) {
  const f = fuentes({ proximoPartido: { id: 'm1', hora } });
  return D.normalizarTareas(f, { rol: 'admin', ahora })[0] || null;
}

test('un partido más tarde hoy dice «hoy», no «en 1 días»', () => {
  const t = tareaPartido(localISO(HOY_09, 0, 21));
  assert.equal(t.title, 'Próximo partido hoy');
});

test('un partido del día siguiente dice «mañana»', () => {
  const t = tareaPartido(localISO(HOY_09, 1, 8));
  assert.equal(t.title, 'Próximo partido mañana');
});

test('un partido de pasado mañana dice «en 2 días», en plural', () => {
  const t = tareaPartido(localISO(HOY_09, 2, 20));
  assert.equal(t.title, 'Próximo partido en 2 días');
});

test('un partido de la semana que viene cuenta los días de calendario', () => {
  const t = tareaPartido(localISO(HOY_09, 6, 11));
  assert.equal(t.title, 'Próximo partido en 6 días');
});

test('un partido que ya empezó no es una tarea pendiente', () => {
  // Empezó hace media hora: «Próximo partido» sería mentira, y «en 0
  // días» ni siquiera es castellano.
  const t = tareaPartido(new Date(HOY_09.getTime() - 30 * 60000).toISOString());
  assert.equal(t, null);
});

test('un partido de anteayer tampoco genera tarea', () => {
  const t = tareaPartido(localISO(HOY_09, -2, 20));
  assert.equal(t, null);
});

test('un partido sin hora usable se anuncia sin plazo, pero se anuncia', () => {
  const t = tareaPartido('vaya uno a saber');
  assert.equal(t.title, 'Próximo partido');
  assert.equal(t.status, 'abierta');
});

// ═══════════════════════════════════════════════════════════════════
// LA NÓMINA, CUANDO LOS DATOS VIENEN INCOMPLETOS
//
// La tarea se genera si faltan cupos por confirmar. El riesgo no es que
// no aparezca: es que aparezca diciendo «null de 11 cupos confirmados».
//
// `cupos_por_club` tiene `check (between 4 and 15)` en la migración
// 43_desafios_plazos_y_propuesta.sql:177, así que 0 o nulo NUNCA es un
// partido de club legítimo: es un dato que llegó a medias.
// ═══════════════════════════════════════════════════════════════════

function tareaNomina(nomina) {
  const f = fuentes({ nomina });
  return D.normalizarTareas(f, { rol: 'admin', ahora: AHORA })[0] || null;
}

test('con cupos por llenar, la nómina dice cuántos van de cuántos', () => {
  const t = tareaNomina({ matchId: 'm1', confirmados: 9, cupos: 11 });
  assert.equal(t.type, 'nomina');
  assert.equal(t.subtitle, '9 de 11 cupos confirmados');
  assert.equal(t.status, 'abierta');
});

test('la nómina completa no deja tarea: no hay nada que confirmar', () => {
  assert.equal(tareaNomina({ matchId: 'm1', confirmados: 11, cupos: 11 }), null);
});

test('cupos en 0 no genera tarea: es un dato incompleto, no un partido sin cupos', () => {
  // `resumenNomina` devuelve `cupos: 0` cuando `cupos_por_club` no es un
  // número, así que este es el 0 que de verdad llega.
  assert.equal(tareaNomina({ matchId: 'm1', confirmados: 0, cupos: 0 }), null);
});

test('cupos nulos no generan tarea', () => {
  assert.equal(tareaNomina({ matchId: 'm1', confirmados: 3, cupos: null }), null);
});

test('cupos negativos no generan tarea', () => {
  assert.equal(tareaNomina({ matchId: 'm1', confirmados: 0, cupos: -4 }), null);
});

test('confirmados nulos no inventan un «null de 11»', () => {
  // `null < 11` es `true` en JavaScript, así que sin una guardia explícita
  // esto pintaba la tarea con la palabra «null» dentro del subtítulo.
  assert.equal(tareaNomina({ matchId: 'm1', confirmados: null, cupos: 11 }), null);
});

test('confirmados ausentes tampoco generan tarea', () => {
  assert.equal(tareaNomina({ matchId: 'm1', cupos: 11 }), null);
});

test('un confirmados que no es número no se cuela como si lo fuera', () => {
  assert.equal(tareaNomina({ matchId: 'm1', confirmados: '9', cupos: 11 }), null);
});

// ═══════════════════════════════════════════════════════════════════
// EL ORDEN Y SU DESEMPATE
//
// El contrato: entre tipos manda ORDEN; dentro de un tipo manda el
// orden en que vino la fuente, que es el que ya trae el servidor.
// No estaba escrito ni probado, y depende de que `Array.sort` sea
// estable — lo es desde ES2019, pero eso hay que fijarlo.
// ═══════════════════════════════════════════════════════════════════

test('dos desafíos del mismo tipo conservan el orden en que vino la fuente', () => {
  const f = fuentes({
    desafiosRecibidos: [
      { ...DESAFIO, id: 'primero' },
      { ...DESAFIO, id: 'segundo' },
      { ...DESAFIO, id: 'tercero' },
    ],
  });
  const ids = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA }).map((t) => t.id);
  assert.deepEqual(ids, ['desafio:primero', 'desafio:segundo', 'desafio:tercero']);
});

test('el desempate sobrevive a que haya varias tareas de varios tipos', () => {
  const f = fuentes({
    desafiosRecibidos: [{ ...DESAFIO, id: 'd1' }, { ...DESAFIO, id: 'd2' }],
    propuestas: [{ id: 'p1', estado: 'pendiente' }, { id: 'p2', estado: 'pendiente' }],
    cambiosDePartido: [{ id: 'cb1', estado: 'pendiente' }],
  });
  const ids = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA }).map((t) => t.id);
  assert.deepEqual(ids, [
    'desafio:d1', 'desafio:d2', 'propuesta:p1', 'propuesta:p2', 'cambio:cb1',
  ]);
});

test('una tarea vencida no se va al fondo: el orden es por tipo, no por estado', () => {
  // Importa para el tope de cuatro: si lo vencido se hundiera, «Ver N más»
  // escondería tareas accionables detrás de avisos muertos.
  const f = fuentes({
    desafiosRecibidos: [
      { ...DESAFIO, id: 'muerto', estado: 'cancelado' },
      { ...DESAFIO, id: 'vivo', estado: 'pendiente' },
    ],
  });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.deepEqual(tareas.map((t) => t.id), ['desafio:muerto', 'desafio:vivo']);
  assert.equal(D.contarConAccion(tareas), 1);
});

// ═══════════════════════════════════════════════════════════════════
// LA ETIQUETA DEL PLAZO, PARA QUIEN NO ES LA LISTA DE TAREAS
//
// La tarjeta del próximo partido lleva una pastilla con el mismo plazo
// que el título de la tarea, pero en corto y en mayúsculas. Se exporta
// en vez de dejar que la pantalla recorte el título con una expresión
// regular: si el título cambia, un recorte se rompe en silencio y esto
// falla acá.
// ═══════════════════════════════════════════════════════════════════

test('el plazo de un partido de hoy se etiqueta «HOY»', () => {
  assert.equal(D.etiquetaPlazo(D.plazoDePartido(localISO(HOY_09, 0, 21), HOY_09)), 'HOY');
});

test('el plazo de mañana se etiqueta «MAÑANA»', () => {
  assert.equal(D.etiquetaPlazo(D.plazoDePartido(localISO(HOY_09, 1, 8), HOY_09)), 'MAÑANA');
});

test('a partir de dos días la etiqueta cuenta los días', () => {
  assert.equal(D.etiquetaPlazo(D.plazoDePartido(localISO(HOY_09, 4, 20), HOY_09)), 'EN 4 DÍAS');
});

test('un partido pasado o sin fecha no tiene etiqueta de plazo', () => {
  assert.equal(D.etiquetaPlazo(D.plazoDePartido(localISO(HOY_09, -1, 20), HOY_09)), null);
  assert.equal(D.etiquetaPlazo(D.plazoDePartido('vaya uno a saber', HOY_09)), null);
  assert.equal(D.etiquetaPlazo(null), null);
});

test('la etiqueta y el título del partido cuentan los mismos días', () => {
  // El punto de exportarlas juntas: si divergen, la pastilla dice una cosa
  // y la tarea de abajo otra sobre el mismo partido.
  for (const dias of [0, 1, 2, 5, 30]) {
    const hora = localISO(HOY_09, dias, 20);
    const etiqueta = D.etiquetaPlazo(D.plazoDePartido(hora, HOY_09));
    const titulo = tareaPartido(hora)?.title;
    assert.equal(
      titulo.replace(/^Próximo partido\s*/, '').toUpperCase(),
      etiqueta,
      `a ${dias} días`
    );
  }
});

// ── El subtítulo de una tarea que ya no se puede accionar ────────────
//
// «· responde un admin» explica al jugador por qué no ve un botón. En una
// tarea vencida el botón no falta por su rol: no hay nada que responder, ni
// para él ni para el admin. Mandarlo a buscar a un administrador que tampoco
// puede hacer nada es la promesa vacía que estas tarjetas existen para no
// hacer. Sólo se vuelve visible ahora que el contexto deja pasar los
// desenlaces recientes.

test('a una tarea vencida no se le pega «responde un admin»', () => {
  const [t] = D.normalizarTareas(
    fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'sin_acuerdo' }] }),
    { rol: 'jugador', ahora: AHORA }
  );
  assert.equal(t.status, 'vencida');
  assert.doesNotMatch(t.subtitle, /responde un admin/);
});

test('la coletilla sigue apareciendo en la misma tarea si está abierta', () => {
  // El contraste con la de arriba: lo que cambia es el estado, no el rol.
  const [t] = D.normalizarTareas(fuentes({ desafiosRecibidos: [DESAFIO] }), {
    rol: 'jugador',
    ahora: AHORA,
  });
  assert.equal(t.status, 'abierta');
  assert.match(t.subtitle, /responde un admin/);
});

test('un cambio de partido caducado tampoco manda a buscar a un admin', () => {
  const [t] = D.normalizarTareas(
    fuentes({ cambiosDePartido: [{ id: 'c1', estado: 'caducado' }] }),
    { rol: 'jugador', ahora: AHORA }
  );
  assert.equal(t.status, 'vencida');
  assert.doesNotMatch(t.subtitle, /responde un admin/);
});

// ── F10: qué DICE una tarjeta vencida ────────────────────────────────
//
// El checklist pide que una tarea vencida salga «al 55% de opacidad, sin
// botón, con chip Expiró». `PendingTaskCard` ya lo dibuja así, pero el
// CONTENIDO seguía siendo el de una tarea pendiente: un desafío cerrado sin
// acuerdo se titulaba «Desafío recibido» y llevaba un `cta` «Responder»; una
// propuesta caducada se titulaba, literalmente, «Propuesta pendiente».
// Apagar una tarjeta no arregla que el texto describa otra cosa.

const VERBOS_DE_ACCION = /responder|revisar|ver nómina|ir ahora|pendiente|por confirmar/i;

test('un desafío sin acuerdo no se titula «Desafío recibido»', () => {
  const [t] = D.normalizarTareas(
    fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'sin_acuerdo' }] }),
    { rol: 'admin', ahora: AHORA }
  );
  assert.equal(t.status, 'vencida');
  assert.equal(t.title, 'Desafío sin acuerdo');
});

test('una propuesta vencida no se titula «Propuesta pendiente»', () => {
  // Era el texto más contradictorio de los tres: «Propuesta pendiente» junto
  // a un chip que dice «Expiró».
  const [rechazada] = D.normalizarTareas(
    fuentes({ propuestas: [{ id: 'p1', estado: 'rechazada' }] }),
    { rol: 'admin', ahora: AHORA }
  );
  assert.equal(rechazada.status, 'vencida');
  assert.equal(rechazada.title, 'Propuesta rechazada');

  const [caducada] = D.normalizarTareas(
    fuentes({ propuestas: [{ id: 'p2', estado: 'caducada' }] }),
    { rol: 'admin', ahora: AHORA }
  );
  assert.equal(caducada.title, 'Propuesta caducada');
});

test('un cambio de partido vencido dice qué pasó, no qué proponen', () => {
  const [t] = D.normalizarTareas(
    fuentes({ cambiosDePartido: [{ id: 'c1', estado: 'caducado' }] }),
    { rol: 'admin', ahora: AHORA }
  );
  assert.equal(t.status, 'vencida');
  assert.equal(t.title, 'Cambio sin respuesta');
});

test('cada desenlace se titula por SU estado, no todos igual', () => {
  // El título tiene que describir el estado. Si los cuatro cierres del
  // desafío dijeran lo mismo, la tarjeta explicaría menos que el chip.
  const titulo = (estado) =>
    D.normalizarTareas(fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado }] }), {
      rol: 'admin',
      ahora: AHORA,
    })[0].title;
  const titulos = ['sin_acuerdo', 'expirado', 'rechazado', 'cancelado'].map(titulo);
  assert.equal(new Set(titulos).size, 4, `se repiten: ${titulos.join(' | ')}`);
});

test('ninguna tarea vencida lleva CTA', () => {
  // No basta con que la tarjeta no lo dibuje: el objeto no puede seguir
  // prometiendo «Responder» en un campo que alguien más podría leer.
  const f = fuentes({
    desafiosRecibidos: [{ ...DESAFIO, estado: 'sin_acuerdo' }],
    propuestas: [{ id: 'p1', estado: 'rechazada' }],
    cambiosDePartido: [{ id: 'c1', estado: 'caducado' }],
  });
  const vencidas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(vencidas.length, 3);
  for (const t of vencidas) {
    assert.equal(t.status, 'vencida');
    assert.equal(t.cta, null, `${t.id} todavía trae cta «${t.cta}»`);
  }
});

test('ni el título ni el subtítulo de una vencida hablan de algo por hacer', () => {
  const f = fuentes({
    desafiosRecibidos: [{ ...DESAFIO, estado: 'sin_acuerdo' }],
    propuestas: [{ id: 'p1', estado: 'rechazada' }],
    cambiosDePartido: [{ id: 'c1', estado: 'caducado' }],
  });
  for (const rol of ['admin', 'jugador']) {
    for (const t of D.normalizarTareas(f, { rol, ahora: AHORA })) {
      assert.doesNotMatch(t.title, VERBOS_DE_ACCION, `${t.id} título: ${t.title}`);
      assert.doesNotMatch(t.subtitle, VERBOS_DE_ACCION, `${t.id} subtítulo: ${t.subtitle}`);
    }
  }
});

test('una tarea ABIERTA conserva su CTA y su texto de siempre', () => {
  // El contraste: lo de arriba no puede haberse llevado por delante el caso
  // normal, que es el 99% de las tarjetas.
  const [t] = D.normalizarTareas(fuentes({ desafiosRecibidos: [DESAFIO] }), {
    rol: 'admin',
    ahora: AHORA,
  });
  assert.equal(t.status, 'abierta');
  assert.equal(t.title, 'Desafío recibido');
  assert.equal(t.cta, 'Responder');
});

test('y la vencida sigue sin sumar al badge', () => {
  // La otra mitad de F10, por si un cambio de copy se llevara el status.
  const f = fuentes({
    desafiosRecibidos: [{ ...DESAFIO, estado: 'sin_acuerdo' }],
    propuestas: [{ id: 'p1', estado: 'rechazada' }],
  });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas.length, 2);
  assert.equal(D.contarConAccion(tareas), 0);
});

// ── N4: el badge de la barra y el de la portada dicen lo mismo ───────

test('el badge se rotula igual hasta 9 y se corta en «9+»', () => {
  assert.equal(D.etiquetaBadge(1), '1');
  assert.equal(D.etiquetaBadge(9), '9');
  assert.equal(D.etiquetaBadge(10), '9+');
  assert.equal(D.etiquetaBadge(99), '9+');
});

test('un cierre nuevo que nadie redactó igual describe el estado', () => {
  // `VENCIDOS.desafio` se DERIVA de `ESTADOS_CERRADOS`, así que una
  // migración puede meter un estado cerrado nuevo sin que nadie escriba su
  // texto. El respaldo tiene que decir algo cierto, no «Desafío recibido».
  const [t] = D.normalizarTareas(
    fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'bloqueado_por_fuerza_mayor' }] }),
    { rol: 'admin', ahora: AHORA }
  );
  // Un estado desconocido cuenta como abierta, que es la regla vigente.
  assert.equal(t.status, 'abierta');

  // Pero uno que SÍ está en VENCIDOS y no tiene copy propio, no.
  const conCopy = D.normalizarTareas(
    fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'sin_acuerdo' }] }),
    { rol: 'admin', ahora: AHORA }
  )[0];
  assert.notEqual(conCopy.title, 'Desafío recibido');
});

test('el subtítulo de un desafío vencido nombra al rival cuando se sabe', () => {
  const [t] = D.normalizarTareas(
    fuentes({ desafiosRecibidos: [{ ...DESAFIO, estado: 'sin_acuerdo' }] }),
    { rol: 'admin', ahora: AHORA }
  );
  assert.equal(t.subtitle, 'lagardere fcv');
});

test('y explica el cierre cuando no se sabe con quién era', () => {
  const [t] = D.normalizarTareas(
    fuentes({ desafiosRecibidos: [{ id: 'd9', estado: 'sin_acuerdo' }] }),
    { rol: 'admin', ahora: AHORA }
  );
  assert.match(t.subtitle, /sin acuerdo/i);
});

// ── Invitaciones recibidas ───────────────────────────────────────────
//
// EL BLOQUEADOR QUE FIJAN. Una invitación a alguien que YA tiene club era
// invisible. La cadena entera:
//
//   1. La migración 13 no crea aviso a propósito —«solo solicitudes (las
//      invitaciones las ve el jugador en su pestaña)»—, así que Avisos no
//      la muestra y eso es deliberado.
//   2. Pero `<Invitaciones>` sólo se dibujaba en `SinClub` y en
//      `SolicitudEnRevision`. En la portada de quien YA es miembro, cero.
//   3. Y a quien invita se le prometía lo contrario: «verá tu invitación en
//      su pestaña Clubes» (ClubInviteScreen).
//
// Como se puede pertenecer hasta a 3 clubes (migración 24), el caso roto es
// el normal, no el raro. La invitación pasa a ser una tarea más.

const INVITACION = {
  request_id: 'inv-1',
  club_id: 'c-inv',
  created_at: '2026-08-27T12:00:00Z',
  club: { id: 'c-inv', nombre: 'Los Papi Pasty' },
};

test('una invitación recibida se convierte en tarea', () => {
  const [t] = D.normalizarTareas(fuentes({ invitaciones: [INVITACION] }), {
    rol: 'jugador',
    ahora: AHORA,
  });
  assert.equal(t.type, 'invitacion');
  assert.equal(t.id, 'invitacion:inv-1');
  assert.equal(t.status, 'abierta');
  assert.match(t.title, /invitación/i);
  assert.match(t.subtitle, /Los Papi Pasty/);
});

test('la invitación trae DOS acciones, no un cta único', () => {
  // Aceptar y rechazar son salidas distintas y ninguna es «la principal».
  // Con un solo `cta` la tarjeta tendría que inventarse la segunda.
  const [t] = D.normalizarTareas(fuentes({ invitaciones: [INVITACION] }), {
    rol: 'jugador',
    ahora: AHORA,
  });
  assert.equal(t.cta, null);
  assert.deepEqual(
    (t.acciones || []).map((a) => a.clave),
    ['aceptar', 'rechazar']
  );
  assert.equal(t.acciones[0].label, 'Aceptar');
  assert.equal(t.acciones[1].label, 'Rechazar');
});

test('la invitación va PRIMERA: es la única que decide el usuario por sí solo', () => {
  const f = fuentes({
    invitaciones: [INVITACION],
    desafiosRecibidos: [DESAFIO],
    cambiosDePartido: [{ id: 'c1', estado: 'pendiente' }],
  });
  const tareas = D.normalizarTareas(f, { rol: 'admin', ahora: AHORA });
  assert.equal(tareas[0].type, 'invitacion');
  // Y no altera el orden relativo de las demás, que es el de D3.
  assert.deepEqual(
    tareas.map((t) => t.type),
    ['invitacion', 'desafio', 'cambio']
  );
});

test('la invitación SUMA al badge', () => {
  const tareas = D.normalizarTareas(fuentes({ invitaciones: [INVITACION] }), {
    rol: 'jugador',
    ahora: AHORA,
  });
  assert.equal(D.contarConAccion(tareas), 1);
  assert.equal(D.etiquetaBadge(D.contarConAccion(tareas)), '1');
});

test('el jugador sin cargo también la ve, y sin «responde un admin»', () => {
  // Una invitación es personal: no la responde un administrador del club al
  // que ya pertenezco, la respondo yo.
  const [t] = D.normalizarTareas(fuentes({ invitaciones: [INVITACION] }), {
    rol: 'jugador',
    ahora: AHORA,
  });
  assert.doesNotMatch(t.subtitle, /responde un admin/);
  assert.deepEqual(
    t.acciones.map((a) => a.clave),
    ['aceptar', 'rechazar']
  );
});

test('dos invitaciones son dos tareas, y ninguna se repite', () => {
  const otra = { ...INVITACION, request_id: 'inv-2', club: { id: 'c2', nombre: 'SixSiete' } };
  const tareas = D.normalizarTareas(fuentes({ invitaciones: [INVITACION, otra] }), {
    rol: 'jugador',
    ahora: AHORA,
  });
  const ids = tareas.map((t) => t.id);
  assert.deepEqual(ids, ['invitacion:inv-1', 'invitacion:inv-2']);
  assert.equal(new Set(ids).size, ids.length, 'hay ids repetidos');
  assert.equal(D.contarConAccion(tareas), 2);
});

test('la misma invitación repetida en la fuente no se dibuja dos veces', () => {
  // `listMyInvitations` no debería devolver duplicados, pero si la ronda de
  // red se solapa consigo misma, la portada no puede mostrar dos tarjetas
  // idénticas ni contar dos veces en el badge.
  const tareas = D.normalizarTareas(fuentes({ invitaciones: [INVITACION, { ...INVITACION }] }), {
    rol: 'jugador',
    ahora: AHORA,
  });
  assert.equal(tareas.length, 1);
  assert.equal(D.contarConAccion(tareas), 1);
});

test('una invitación sin club resuelto no se dibuja', () => {
  // `listMyInvitations` ya filtra las que no resuelven club, pero sin esto
  // la tarjeta diría «Te invitó undefined».
  const tareas = D.normalizarTareas(
    fuentes({ invitaciones: [{ request_id: 'x', club_id: 'c', club: null }] }),
    { rol: 'jugador', ahora: AHORA }
  );
  assert.deepEqual(tareas, []);
});

test('con el máximo de clubes la invitación NO se esconde', () => {
  // LA REGLA VIVE EN EL SERVIDOR, no acá. El trigger `check_user_club_limit`
  // (migración 24, líneas 18-43) es un BEFORE INSERT sobre `club_members`
  // que lanza «Ya perteneces al máximo de 3 clubes permitidos». Aceptar la
  // cuarta falla ahí y `respondToRequest()` propaga ese mensaje tal cual.
  //
  // Esconder la invitación en el cliente sería inventar una política que el
  // servidor no tiene: la invitación EXISTE y sigue pendiente. Se muestra, y
  // quien la acepte recibe el motivo real. Rechazarla sí funciona siempre.
  const tareas = D.normalizarTareas(
    fuentes({ invitaciones: [INVITACION] }),
    { rol: 'jugador', ahora: AHORA, clubesActuales: 3 }
  );
  assert.equal(tareas.length, 1);
  assert.equal(tareas[0].status, 'abierta');
});
