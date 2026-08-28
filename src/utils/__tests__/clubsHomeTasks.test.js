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
