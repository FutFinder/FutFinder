/**
 * Pruebas de las reglas puras que alimentan la portada de Clubes.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. `useClubsHome` es un hook y el repo no tiene
 * infraestructura de pruebas de render, así que todo lo que decida algo se
 * saca del hook y se prueba acá. Lo que queda en el hook es atar servicios y
 * llamar a estas funciones.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../clubsHomeSources.js');

// ── A qué club pertenece un aviso ───────────────────────────────────
//
// Las tres claves salen de las migraciones que crean los avisos:
//   clubId                       → 13, 14, 16 (membresía) y 47, 47c (sanción)
//   clubRetadorId / clubRetadoId → 26, 28, 42, 43 (cualquier desafío)

test('un aviso de membresía se atribuye por clubId', () => {
  assert.equal(S.avisoDelClub({ data: { clubId: 'c1' } }, 'c1'), true);
  assert.equal(S.avisoDelClub({ data: { clubId: 'c2' } }, 'c1'), false);
});

test('un aviso de desafío se atribuye por cualquiera de los dos clubes', () => {
  const aviso = { data: { clubRetadorId: 'c1', clubRetadoId: 'c2' } };
  assert.equal(S.avisoDelClub(aviso, 'c1'), true);
  assert.equal(S.avisoDelClub(aviso, 'c2'), true);
  assert.equal(S.avisoDelClub(aviso, 'c3'), false);
});

test('un aviso que solo lleva matchId no se atribuye a ningún club', () => {
  // A propósito: una lista corta y cierta es mejor que una completa y
  // adivinada. Un partido normal no es actividad del club.
  assert.equal(S.avisoDelClub({ data: { matchId: 'm1' } }, 'c1'), false);
});

test('un aviso sin data no revienta', () => {
  assert.equal(S.avisoDelClub({}, 'c1'), false);
  assert.equal(S.avisoDelClub(null, 'c1'), false);
});

test('sin club activo ningún aviso se atribuye', () => {
  // Si `clubId` viniera nulo, `d.clubId === clubId` sería verdadero para
  // todo aviso sin club y la actividad se llenaría de cosas ajenas.
  assert.equal(S.avisoDelClub({ data: {} }, null), false);
  assert.equal(S.avisoDelClub({ data: { clubId: null } }, null), false);
});

// ── Qué club queda activo ───────────────────────────────────────────

const CLUBES = [
  { club: { id: 'c1', nombre: 'primero' }, miRol: 'admin' },
  { club: { id: 'c2', nombre: 'segundo' }, miRol: 'jugador' },
];

test('sin clubes no hay club activo', () => {
  assert.equal(S.elegirClubActivo([], 'c1'), null);
  assert.equal(S.elegirClubActivo(undefined, 'c1'), null);
});

test('el club guardado manda si todavía pertenezco a él', () => {
  assert.equal(S.elegirClubActivo(CLUBES, 'c2'), 'c2');
});

test('si el club guardado ya no es mío, cae al primero por fecha de ingreso', () => {
  // `getMyClubs` ordena por `joined_at`, así que el primero es el más antiguo.
  assert.equal(S.elegirClubActivo(CLUBES, 'club-del-que-me-fui'), 'c1');
});

test('sin nada guardado, el primero', () => {
  assert.equal(S.elegirClubActivo(CLUBES, null), 'c1');
});

test('una membresía sin club no se elige ni rompe la elección', () => {
  assert.equal(S.elegirClubActivo([{ miRol: 'admin' }, ...CLUBES], null), 'c1');
});

// ── Miembro, pendiente o nada ───────────────────────────────────────

test('con clubes soy miembro, aunque además tenga invitaciones', () => {
  assert.equal(
    S.derivarMembresia({ clubes: CLUBES, invitaciones: [{ id: 'i1' }], solicitudes: [] }),
    'member'
  );
});

test('sin clubes y con una invitación, quedo pendiente', () => {
  assert.equal(
    S.derivarMembresia({ clubes: [], invitaciones: [{ id: 'i1' }], solicitudes: [] }),
    'pending'
  );
});

test('sin clubes y con una solicitud enviada, también quedo pendiente', () => {
  // El caso que antes era inalcanzable: dependía de un id guardado en
  // AsyncStorage de una membresía anterior, así que quien postulaba a su
  // primer club veía «Aún sin club».
  assert.equal(
    S.derivarMembresia({ clubes: [], invitaciones: [], solicitudes: [{ id: 'r1' }] }),
    'pending'
  );
});

test('sin clubes, sin invitaciones y sin solicitudes, no hay nada', () => {
  assert.equal(S.derivarMembresia({ clubes: [], invitaciones: [], solicitudes: [] }), 'none');
});

test('la membresía no revienta con fuentes ausentes', () => {
  assert.equal(S.derivarMembresia({}), 'none');
  assert.equal(S.derivarMembresia(), 'none');
});

// ── Qué partido puede tener un cambio pendiente ─────────────────────

test('un partido nacido de una propuesta admite cambio', () => {
  assert.equal(
    S.partidoAdmiteCambio({ id: 'm1', challenge_proposal_id: 'p1', cupos_por_club: 11 }),
    true
  );
});

test('sin cupos por club el partido SIGUE admitiendo cambio', () => {
  // El acople que había: la consulta del cambio colgaba de
  // `usaNominaPorClub()`, que además exige `cupos_por_club != null`.
  // `responder_cambio_partido` (migración 46:395) solo exige la propuesta,
  // así que un partido sin cupos nunca mostraba su cambio pendiente.
  assert.equal(
    S.partidoAdmiteCambio({ id: 'm1', challenge_proposal_id: 'p1', cupos_por_club: null }),
    true
  );
});

test('un partido normal no admite cambio de partido de clubes', () => {
  assert.equal(S.partidoAdmiteCambio({ id: 'm1', challenge_proposal_id: null }), false);
  assert.equal(S.partidoAdmiteCambio(null), false);
});

// ── Qué desenlaces siguen en pantalla, y por cuánto ──────────────────
//
// El encabezado de `clubsHomeTasks.js` promete que «una tarea vencida sigue
// en pantalla un rato para explicar qué pasó, pero no suma». Nada la
// producía: el contexto sólo dejaba pasar lo accionable, así que el estado
// `'vencida'` —la opacidad .55 y el chip «Expiró» de `PendingTaskCard`— era
// inalcanzable desde el flujo real. Estas dos funciones son el «rato».

const DIA = 86400000;
const AHORA = new Date('2026-09-02T12:00:00.000Z');
const haceDias = (n) => new Date(AHORA.getTime() - n * DIA).toISOString();

test('la ventana de los desenlaces son 7 días', () => {
  // No es un número suelto en un `filter`: lo leen las dos funciones y las
  // pruebas de abajo, así que moverlo mueve todo junto.
  assert.equal(S.DIAS_DESENLACE_VISIBLE, 7);
});

// —— desafíos recibidos ——

test('un desafío recibido pendiente siempre entra, sin fecha que mirar', () => {
  const lista = S.desafiosRecibidosParaTareas(
    [{ id: 'd1', estado: 'pendiente', created_at: haceDias(400) }],
    { ahora: AHORA }
  );
  assert.deepEqual(
    lista.map((d) => d.id),
    ['d1']
  );
});

test('un «sin acuerdo» reciente entra: es lo que la tarjeta vencida explica', () => {
  const lista = S.desafiosRecibidosParaTareas(
    [{ id: 'd1', estado: 'sin_acuerdo', negociacion_vence_at: haceDias(2) }],
    { ahora: AHORA }
  );
  assert.deepEqual(
    lista.map((d) => d.id),
    ['d1']
  );
});

test('la prórroga manda sobre el plazo de negociación al fechar el cierre', () => {
  // La 43 cierra en `sin_acuerdo` cuando vence la PRÓRROGA (línea 395). Si se
  // fechara con `negociacion_vence_at`, un desafío cerrado ayer con una
  // prórroga de 24 h contaría como cerrado hace tres días.
  const d = {
    id: 'd1',
    estado: 'sin_acuerdo',
    negociacion_vence_at: haceDias(8),
    prorroga_vence_at: haceDias(1),
  };
  assert.equal(S.desafiosRecibidosParaTareas([d], { ahora: AHORA }).length, 1);
});

test('un «sin acuerdo» de hace más de una semana ya no se muestra', () => {
  // `listChallengesForClub` devuelve el historial COMPLETO y sin límite. Sin
  // esta ventana, cada desenlace se quedaría en la portada para siempre.
  const lista = S.desafiosRecibidosParaTareas(
    [{ id: 'd1', estado: 'sin_acuerdo', negociacion_vence_at: haceDias(8) }],
    { ahora: AHORA }
  );
  assert.deepEqual(lista, []);
});

test('un «sin acuerdo» cerrado por un «No» de la prórroga entra aunque el plazo no haya vencido', () => {
  // La 43:733 cierra en el acto cuando un club responde que no se juega, así
  // que `prorroga_vence_at` queda en el FUTURO. Acaba de pasar: se muestra.
  const lista = S.desafiosRecibidosParaTareas(
    [
      {
        id: 'd1',
        estado: 'sin_acuerdo',
        prorroga_vence_at: new Date(AHORA.getTime() + DIA).toISOString(),
      },
    ],
    { ahora: AHORA }
  );
  assert.equal(lista.length, 1);
});

test('un «sin acuerdo» sin ninguna fecha usable queda fuera', () => {
  // Ante un desenlace que no se puede fechar, callar. Dejarlo entrar sería
  // volver al historial infinito por la puerta de atrás.
  const lista = S.desafiosRecibidosParaTareas(
    [
      { id: 'd1', estado: 'sin_acuerdo' },
      { id: 'd2', estado: 'sin_acuerdo', negociacion_vence_at: 'mañana por la tarde' },
    ],
    { ahora: AHORA }
  );
  assert.deepEqual(lista, []);
});

test('un desafío recibido que EXPIRÓ no se le muestra al retado', () => {
  // La 43 avisa del `expirado` sólo al club retador, y lo dice con todas sus
  // letras: «el retado nunca respondió, y avisarle de algo que decidió
  // ignorar es ruido». La portada no puede contradecir al servidor.
  const lista = S.desafiosRecibidosParaTareas(
    [{ id: 'd1', estado: 'expirado', created_at: haceDias(1) }],
    { ahora: AHORA }
  );
  assert.deepEqual(lista, []);
});

test('un desafío que MI club rechazó no vuelve como aviso', () => {
  // Rechazar es del retado (migración 26, línea 75): soy yo. Contarme lo que
  // acabo de decidir es ruido, igual que el `expirado`.
  const lista = S.desafiosRecibidosParaTareas(
    [{ id: 'd1', estado: 'rechazado', responded_at: haceDias(1) }],
    { ahora: AHORA }
  );
  assert.deepEqual(lista, []);
});

test('un desafío cancelado tampoco entra: no hay con qué fecharlo ni el texto calza', () => {
  // La 47 sólo cancela desde `publicado`/`en_juego` y no escribe fecha de
  // cierre, así que el único ancla sería un `created_at` de hace semanas. Y
  // «Desafío recibido · Expiró» no es lo que pasó: se canceló un encuentro
  // ya publicado. Eso lo cuenta el hilo, no la portada.
  const lista = S.desafiosRecibidosParaTareas(
    [{ id: 'd1', estado: 'cancelado', created_at: haceDias(1) }],
    { ahora: AHORA }
  );
  assert.deepEqual(lista, []);
});

test('lo que sigue vivo pero no se responde desde la portada queda fuera', () => {
  // `negociacion`, `esperando_aprobacion`, `publicado`… son desafíos abiertos,
  // pero la tarea dice «Desafío recibido / Responder» y ahí no hay nada que
  // responder. Se atienden en el hilo.
  const estados = ['negociacion', 'esperando_aprobacion', 'publicado', 'finalizado'];
  const lista = S.desafiosRecibidosParaTareas(
    estados.map((estado, i) => ({ id: `d${i}`, estado, created_at: haceDias(1) })),
    { ahora: AHORA }
  );
  assert.deepEqual(lista, []);
});

test('se conserva el orden y la fila entera que vino del servicio', () => {
  // `normalizarTareas` lee `otroClub.nombre` para el subtítulo, y el orden
  // dentro de un tipo es el del servidor.
  const recibidos = [
    { id: 'd1', estado: 'pendiente', otroClub: { nombre: 'Rival FC' } },
    { id: 'd2', estado: 'sin_acuerdo', negociacion_vence_at: haceDias(1) },
    { id: 'd3', estado: 'pendiente' },
  ];
  const lista = S.desafiosRecibidosParaTareas(recibidos, { ahora: AHORA });
  assert.deepEqual(
    lista.map((d) => d.id),
    ['d1', 'd2', 'd3']
  );
  assert.equal(lista[0].otroClub.nombre, 'Rival FC');
});

test('sin lista no se cae', () => {
  assert.deepEqual(S.desafiosRecibidosParaTareas(null, { ahora: AHORA }), []);
  assert.deepEqual(S.desafiosRecibidosParaTareas(undefined), []);
});

// —— cambio de partido ——

test('la solicitud de cambio pendiente manda sobre cualquier desenlace', () => {
  // El índice único parcial de la 46 garantiza que hay como mucho una.
  const cambio = S.cambioParaTareas(
    [
      { id: 'c2', estado: 'caducado', respondida_at: haceDias(1) },
      { id: 'c1', estado: 'pendiente', created_at: haceDias(0) },
    ],
    { ahora: AHORA }
  );
  assert.equal(cambio.id, 'c1');
});

test('un cambio caducado hace poco se muestra como vencido', () => {
  const cambio = S.cambioParaTareas(
    [{ id: 'c1', estado: 'caducado', respondida_at: haceDias(2) }],
    { ahora: AHORA }
  );
  assert.equal(cambio.id, 'c1');
});

test('de dos caducados se muestra el más reciente, no el primero de la lista', () => {
  // `getCambiosDelPartido` ordena de más nuevo a más viejo, pero la función
  // no se fía del orden: compara las fechas.
  const cambio = S.cambioParaTareas(
    [
      { id: 'viejo', estado: 'caducado', respondida_at: haceDias(5) },
      { id: 'nuevo', estado: 'caducado', respondida_at: haceDias(1) },
    ],
    { ahora: AHORA }
  );
  assert.equal(cambio.id, 'nuevo');
});

test('un cambio caducado hace más de una semana desaparece', () => {
  assert.equal(
    S.cambioParaTareas([{ id: 'c1', estado: 'caducado', respondida_at: haceDias(8) }], {
      ahora: AHORA,
    }),
    null
  );
});

test('un cambio respondido no vuelve: lo decidió uno de los dos clubes', () => {
  // `aceptado` salió bien —`normalizarTareas` ni lo dibuja— y `rechazado` es
  // una decisión que ya tuvo su respuesta y su evento en el hilo. Vencido es
  // lo que no decidió nadie: el plazo de 2 horas de la 46.
  const cambios = [
    { id: 'c1', estado: 'rechazado', respondida_at: haceDias(1) },
    { id: 'c2', estado: 'aceptado', respondida_at: haceDias(1) },
  ];
  assert.equal(S.cambioParaTareas(cambios, { ahora: AHORA }), null);
});

test('un caducado sin fecha de respuesta no se muestra', () => {
  assert.equal(
    S.cambioParaTareas([{ id: 'c1', estado: 'caducado' }], { ahora: AHORA }),
    null
  );
});

test('sin solicitudes devuelve null, no undefined', () => {
  assert.equal(S.cambioParaTareas([], { ahora: AHORA }), null);
  assert.equal(S.cambioParaTareas(null, { ahora: AHORA }), null);
});
