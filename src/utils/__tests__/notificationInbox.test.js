/**
 * Pruebas de la lógica pura de la bandeja de Avisos (estados, guarda contra
 * doble ejecución, actualización optimista con rollback).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getInboxStatus,
  createRequestGuard,
  runOptimistic,
  withRead,
  withAllRead,
  withoutId,
  withActionsResolved,
  resolucionDeEstado,
  textoResolucion,
  conResoluciones,
  fusionarAvisoEnVivo,
  deshacerBorrado,
  deshacerLeidos,
} = require('../notificationInbox.js');

// ---------------------------------------------------------------------------
// getInboxStatus — qué vista mostrar
// ---------------------------------------------------------------------------

test('getInboxStatus: cargando manda siempre, incluso con error previo', () => {
  assert.equal(getInboxStatus({ loading: true, loadError: null }), 'loading');
  assert.equal(getInboxStatus({ loading: true, loadError: { message: 'x' } }), 'loading');
});

test('getInboxStatus: un error de carga da la vista de error, no la de lista', () => {
  assert.equal(getInboxStatus({ loading: false, loadError: { message: 'falló' } }), 'error');
});

test('getInboxStatus: sin loading ni error, la vista es la lista (el vacío lo resuelve el propio SectionList)', () => {
  assert.equal(getInboxStatus({ loading: false, loadError: null }), 'ready');
});

test('getInboxStatus: sin sesión (listNotifications devuelve "No autenticado") es un error, nunca "todo al día"', () => {
  // Ruta privada sin sesión: si por lo que sea la bandeja se pide sin sesión
  // vigente, tiene que verse como cualquier otra falla de carga con
  // reintento — no como una bandeja vacía que celebra "no hay avisos".
  assert.equal(getInboxStatus({ loading: false, loadError: { message: 'No autenticado' } }), 'error');
});

// ---------------------------------------------------------------------------
// createRequestGuard — evita ejecutar dos veces la misma solicitud
// ---------------------------------------------------------------------------

test('createRequestGuard: begin() es true la primera vez y false mientras está en curso', () => {
  const guard = createRequestGuard();
  assert.equal(guard.begin('n1'), true);
  assert.equal(guard.begin('n1'), false);
  assert.equal(guard.isBusy('n1'), true);
});

test('createRequestGuard: end() libera el id para que un próximo begin() vuelva a valer', () => {
  const guard = createRequestGuard();
  guard.begin('n1');
  guard.end('n1');
  assert.equal(guard.isBusy('n1'), false);
  assert.equal(guard.begin('n1'), true);
});

test('createRequestGuard: ids distintos no se bloquean entre sí', () => {
  const guard = createRequestGuard();
  assert.equal(guard.begin('n1'), true);
  assert.equal(guard.begin('n2'), true);
});

test('doble pulsación de punta a punta: la segunda invocación no repite la acción de red', async () => {
  const guard = createRequestGuard();
  let calls = 0;
  const action = () =>
    new Promise((resolve) => {
      calls += 1;
      setTimeout(() => resolve({ error: null }), 5);
    });

  async function tapAceptar() {
    if (!guard.begin('n1')) return { skipped: true };
    try {
      return await action();
    } finally {
      guard.end('n1');
    }
  }

  // Dos taps casi simultáneos, como un doble click real.
  const [first, second] = await Promise.all([tapAceptar(), tapAceptar()]);

  assert.equal(calls, 1, 'la acción de red debió dispararse una sola vez');
  assert.equal(second.skipped, true);
  assert.equal(first.error, null);
});

// ---------------------------------------------------------------------------
// runOptimistic — éxito y rollback
//
// C07 (auditoría de chats y avisos, 2026-09-23): el rollback restauraba el
// arreglo ENTERO que había antes de la petición, y se llevaba por delante lo
// que hubiera llegado por Realtime mientras tanto. Ahora se aplica y se
// revierte sólo el cambio propio, siempre sobre el estado actual.
// ---------------------------------------------------------------------------

/** Un `setItems` como el de React: acepta valor o función del estado actual. */
function estado(inicial) {
  const s = { actual: inicial };
  s.setItems = (u) => {
    s.actual = typeof u === 'function' ? u(s.actual) : u;
  };
  return s;
}

/** Una acción que no resuelve hasta que la prueba lo decide. */
function accionPendiente() {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { action: () => promesa, resolver: (v) => resolver(v) };
}

test('runOptimistic (éxito): el cambio optimista queda aplicado y no hay error', async () => {
  const s = estado([{ id: 1 }, { id: 2 }]);
  const { error } = await runOptimistic({
    apply: (items) => withoutId(items, 2),
    revert: (items) => deshacerBorrado(items, [{ id: 2 }]),
    action: async () => ({ error: null }),
    setItems: s.setItems,
  });
  assert.equal(error, null);
  assert.deepEqual(s.actual, [{ id: 1 }]);
});

test('runOptimistic (error): revierte el cambio y devuelve el error', async () => {
  const s = estado([{ id: 1 }, { id: 2 }]);
  const { error } = await runOptimistic({
    apply: (items) => withoutId(items, 2),
    revert: (items) => deshacerBorrado(items, [{ id: 2 }]),
    action: async () => ({ error: { message: 'Supabase no respondió' } }),
    setItems: s.setItems,
  });
  assert.equal(error.message, 'Supabase no respondió');
  assert.deepEqual(s.actual.map((n) => n.id).sort(), [1, 2]);
});

test('C07: un aviso que llega mientras se borra otro sobrevive al rollback', async () => {
  const viejo = { id: 'a', created_at: '2026-09-22T10:00:00Z' };
  const otro = { id: 'b', created_at: '2026-09-22T09:00:00Z' };
  const s = estado([viejo, otro]);
  const pend = accionPendiente();

  const corrida = runOptimistic({
    apply: (items) => withoutId(items, 'a'),
    revert: (items) => deshacerBorrado(items, [viejo]),
    action: pend.action,
    setItems: s.setItems,
  });
  // Llega una novedad por Realtime mientras el borrado está en vuelo.
  const nueva = { id: 'nueva', created_at: '2026-09-22T11:00:00Z' };
  s.setItems((prev) => fusionarAvisoEnVivo(prev, nueva));
  pend.resolver({ error: { message: 'falló' } });
  await corrida;

  assert.deepEqual(
    s.actual.map((n) => n.id),
    ['nueva', 'a', 'b'],
    'el rollback se llevó la novedad o no devolvió el aviso a su lugar'
  );
});

test('C07: el rollback no resucita un aviso que otra acción ya borró bien', async () => {
  const a = { id: 'a', created_at: '2026-09-22T10:00:00Z', read: false };
  const b = { id: 'b', created_at: '2026-09-22T09:00:00Z', read: false };
  const s = estado([a, b]);
  const pend = accionPendiente();

  const corrida = runOptimistic({
    apply: withAllRead,
    revert: (items) => deshacerLeidos(items, ['a', 'b']),
    action: pend.action,
    setItems: s.setItems,
  });
  // Mientras «leer todo» viaja, otro borrado de «b» sale bien.
  s.setItems((prev) => withoutId(prev, 'b'));
  pend.resolver({ error: { message: 'falló' } });
  await corrida;

  assert.deepEqual(s.actual, [{ ...a, read: false }], '«b» volvió a aparecer');
});

test('C07: «marcar todo» que falla vuelve a no leído sólo lo que estaba sin leer', async () => {
  const s = estado([
    { id: 1, read: false },
    { id: 2, read: true },
    { id: 3, read: false },
  ]);
  const pend = accionPendiente();
  const corrida = runOptimistic({
    apply: withAllRead,
    revert: (items) => deshacerLeidos(items, [1, 3]),
    action: pend.action,
    setItems: s.setItems,
  });
  s.setItems((prev) => fusionarAvisoEnVivo(prev, { id: 4, read: false }));
  pend.resolver({ error: { message: 'fail' } });
  await corrida;
  assert.deepEqual(s.actual, [
    { id: 4, read: false },
    { id: 1, read: false },
    { id: 2, read: true },
    { id: 3, read: false },
  ]);
});

test('C07: «limpiar todo» que falla devuelve lo borrado y conserva lo que llegó', async () => {
  const previos = [
    { id: 1, created_at: '2026-09-22T10:00:00Z' },
    { id: 2, created_at: '2026-09-22T09:00:00Z' },
  ];
  const s = estado(previos);
  const pend = accionPendiente();
  const corrida = runOptimistic({
    apply: () => [],
    revert: (items) => deshacerBorrado(items, previos),
    action: pend.action,
    setItems: s.setItems,
  });
  assert.deepEqual(s.actual, []);
  s.setItems((prev) => fusionarAvisoEnVivo(prev, { id: 3, created_at: '2026-09-22T11:00:00Z' }));
  pend.resolver({ error: { message: 'fail' } });
  await corrida;
  assert.deepEqual(s.actual.map((n) => n.id), [3, 1, 2]);
});

test('C07: la bandeja ya no revierte con el arreglo entero', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'screens', 'NotificationsScreen.js'),
    'utf8'
  );
  const llamadas = src.split('runOptimistic({').slice(1);
  assert.ok(llamadas.length >= 3, 'no se encontraron las acciones optimistas de la bandeja');
  for (const l of llamadas) {
    const cuerpo = l.slice(0, l.indexOf('});'));
    assert.match(cuerpo, /revert:/, 'una acción optimista no dice cómo deshacer sólo su cambio');
    assert.ok(!/^\s*items,\s*$/m.test(cuerpo), 'una acción optimista vuelve a pasar el arreglo entero');
  }
});

// ---------------------------------------------------------------------------
// Transformaciones puras — contadores y filtros dependen de que estas sean
// correctas, porque son la única fuente de verdad para `items`.
// ---------------------------------------------------------------------------

test('withRead marca solo el id indicado', () => {
  const items = [{ id: 1, read: false }, { id: 2, read: false }];
  assert.deepEqual(withRead(items, 2), [{ id: 1, read: false }, { id: 2, read: true }]);
});

test('withAllRead marca todos como leídos sin tocar otros campos', () => {
  const items = [{ id: 1, read: false, title: 'a' }, { id: 2, read: false, title: 'b' }];
  assert.deepEqual(withAllRead(items), [
    { id: 1, read: true, title: 'a' },
    { id: 2, read: true, title: 'b' },
  ]);
});

test('withoutId quita únicamente el id indicado', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(withoutId(items, 2), [{ id: 1 }, { id: 3 }]);
});

test('withActionsResolved marca leído y oculta las acciones inline del id indicado', () => {
  const items = [{ id: 1, read: false }, { id: 2, read: false }];
  assert.deepEqual(withActionsResolved(items, 1), [
    { id: 1, read: true, _actionsResolved: true, _resolucion: null },
    { id: 2, read: false },
  ]);
});

test('withActionsResolved guarda cómo se respondió, para decirlo en la tarjeta', () => {
  const [n] = withActionsResolved([{ id: 1, type: 'friend_request' }], 1, 'aceptada');
  assert.equal(n._resolucion, 'aceptada');
  assert.equal(textoResolucion(n), 'Solicitud aceptada');
});

// El error de «Cannot coerce the result to a single JSON object»: aceptar
// marcaba el aviso como leído, ese UPDATE volvía por Realtime, reemplazaba la
// tarjeta entera y con ella se perdía la marca local — los botones volvían a
// aparecer, y el segundo toque chocaba con una solicitud que ya no estaba
// pendiente.
test('un aviso que vuelve por Realtime no revive los botones de una solicitud ya respondida', () => {
  const antes = withActionsResolved(
    [{ id: 1, type: 'friend_request', read: false, data: { friendshipId: 'f' } }],
    1,
    'aceptada'
  );
  const llega = { id: 1, type: 'friend_request', read: true, data: { friendshipId: 'f' } };
  const [n] = fusionarAvisoEnVivo(antes, llega);
  assert.equal(n._actionsResolved, true);
  assert.equal(n._resolucion, 'aceptada');
  assert.equal(n.read, true);
});

test('un aviso nuevo por Realtime entra arriba de la lista', () => {
  const lista = fusionarAvisoEnVivo([{ id: 1 }], { id: 2 });
  assert.deepEqual(lista.map((n) => n.id), [2, 1]);
});

test('resolucionDeEstado: pendiente sigue abierta; lo demás cierra la tarjeta', () => {
  assert.equal(resolucionDeEstado('friend_request', 'pending'), null);
  assert.equal(resolucionDeEstado('friend_request', 'accepted'), 'aceptada');
  assert.equal(resolucionDeEstado('friend_request', 'rejected'), 'rechazada');
  assert.equal(resolucionDeEstado('club_request', 'pending'), null);
  assert.equal(resolucionDeEstado('club_request', 'approved'), 'aceptada');
  assert.equal(resolucionDeEstado('club_request', 'rejected'), 'rechazada');
  assert.equal(resolucionDeEstado('club_challenge', 'pendiente'), null);
  assert.equal(resolucionDeEstado('club_challenge', 'aceptado'), 'aceptada');
  assert.equal(resolucionDeEstado('club_challenge', 'rechazado'), 'rechazada');
  assert.equal(resolucionDeEstado('club_challenge', 'caducado'), 'cerrada');
});

// La amistad cancelada por quien la envió se borra: no hay fila que leer.
test('resolucionDeEstado: una solicitud que ya no existe también cierra la tarjeta', () => {
  assert.equal(resolucionDeEstado('friend_request', undefined), 'cerrada');
});

test('textoResolucion habla de solicitud o de reto según el aviso', () => {
  assert.equal(textoResolucion({ type: 'club_request', _resolucion: 'rechazada' }), 'Solicitud rechazada');
  assert.equal(textoResolucion({ type: 'club_challenge', _resolucion: 'aceptada' }), 'Reto aceptado');
  assert.equal(textoResolucion({ type: 'club_challenge', _resolucion: 'rechazada' }), 'Reto rechazado');
  assert.equal(textoResolucion({ type: 'friend_request', _resolucion: 'cerrada' }), 'Ya no está pendiente');
  assert.equal(textoResolucion({ type: 'friend_request' }), null);
});

// Al recargar la bandeja, lo que ya se respondió —desde aquí, desde el perfil
// o desde otro dispositivo— llega sin botones y con su resultado.
test('conResoluciones marca como respondidas las solicitudes que ya no están pendientes', () => {
  const items = [
    { id: 1, type: 'friend_request', data: { friendshipId: 'f1' } },
    { id: 2, type: 'friend_request', data: { friendshipId: 'f2' } },
    { id: 3, type: 'club_request', data: { requestId: 'r1' } },
    { id: 4, type: 'match_reminder', data: {} },
  ];
  const estados = {
    friendships: new Map([['f1', 'accepted'], ['f2', 'pending']]),
    requests: new Map([['r1', 'rejected']]),
    challenges: new Map(),
  };
  const [a, b, c, d] = conResoluciones(items, estados);
  assert.equal(a._resolucion, 'aceptada');
  assert.equal(a._actionsResolved, true);
  assert.equal(b._actionsResolved, undefined);
  assert.equal(c._resolucion, 'rechazada');
  assert.equal(d, items[3]);
});

// Si no se pudo averiguar (sin red, RLS), la tarjeta se queda como estaba:
// mejor ofrecer botones que esconderlos sin saber.
test('conResoluciones sin estados deja la lista intacta', () => {
  const items = [{ id: 1, type: 'friend_request', data: { friendshipId: 'f1' } }];
  assert.deepEqual(conResoluciones(items, null), items);
});

/* ── El resultado ya confirmado deja de pedir confirmación ──────────────── */

test('un resultado ya respondido no sigue diciendo «por confirmar»', () => {
  // Regresión del 2026-10-21, caminando el ciclo de desafíos con dos
  // cuentas: después de CONFIRMAR el 3-1, la bandeja seguía mostrando «Hay
  // un resultado por confirmar · Confírmalo o recházalo» como si quedara
  // algo que hacer. `conResoluciones` cubría tres tipos y éste no estaba.
  const items = [
    { id: 1, type: 'club_resultado_propuesto', data: { resultId: 'res-1' } },
    { id: 2, type: 'club_resultado_propuesto', data: { resultId: 'res-2' } },
    { id: 3, type: 'club_resultado_propuesto', data: { resultId: 'res-3' } },
    // Sin resultId no hay nada que mirar: se deja como está.
    { id: 4, type: 'club_resultado_propuesto', data: {} },
    // Y uno cuyo resultado no se pudo leer (RLS): tampoco se toca.
    { id: 5, type: 'club_resultado_propuesto', data: { resultId: 'res-ajeno' } },
  ];
  const estados = {
    friendships: new Map(),
    requests: new Map(),
    challenges: new Map(),
    resultados: new Map([
      ['res-1', 'confirmado'],
      ['res-2', 'rechazado'],
      ['res-3', 'propuesto'],
    ]),
  };
  const [a, b, c, d, e] = conResoluciones(items, estados);

  assert.equal(a._actionsResolved, true);
  assert.equal(textoResolucion(a), 'Resultado confirmado');
  assert.equal(b._actionsResolved, true);
  assert.equal(textoResolucion(b), 'Resultado rechazado');
  // Todavía propuesto: sigue pendiente de verdad.
  assert.equal(c._actionsResolved, undefined);
  assert.equal(textoResolucion(c), null);
  assert.equal(d, items[3]);
  assert.equal(e, items[4]);
});
