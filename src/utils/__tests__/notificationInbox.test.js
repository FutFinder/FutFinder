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
// ---------------------------------------------------------------------------

test('runOptimistic (éxito): el cambio optimista queda aplicado y no hay error', async () => {
  let current = [{ id: 1 }, { id: 2 }];
  const setItems = (next) => {
    current = next;
  };

  const { error } = await runOptimistic({
    items: current,
    apply: (items) => withoutId(items, 2),
    action: async () => ({ error: null }),
    setItems,
  });

  assert.equal(error, null);
  assert.deepEqual(current, [{ id: 1 }]);
});

test('runOptimistic (error): revierte a los items originales y devuelve el error', async () => {
  const original = [{ id: 1 }, { id: 2 }];
  let current = original;
  const setItems = (next) => {
    current = next;
  };

  const { error } = await runOptimistic({
    items: current,
    apply: (items) => withoutId(items, 2),
    action: async () => ({ error: { message: 'Supabase no respondió' } }),
    setItems,
  });

  assert.equal(error.message, 'Supabase no respondió');
  assert.deepEqual(current, original);
  // Mismo array de referencia, no una copia — el rollback no inventa datos.
  assert.equal(current, original);
});

test('runOptimistic (rollback): "marcar todo como leído" vuelve a los estados de lectura previos si falla', async () => {
  const original = [
    { id: 1, read: false },
    { id: 2, read: true },
    { id: 3, read: false },
  ];
  let current = original;
  const setItems = (next) => {
    current = next;
  };

  await runOptimistic({
    items: current,
    apply: withAllRead,
    action: async () => ({ error: { message: 'fail' } }),
    setItems,
  });

  assert.deepEqual(current, original);
});

test('runOptimistic (rollback): "limpiar todo" restaura la lista completa si el borrado falla', async () => {
  const original = [{ id: 1 }, { id: 2 }, { id: 3 }];
  let current = original;
  const setItems = (next) => {
    current = next;
  };

  await runOptimistic({
    items: current,
    apply: () => [],
    action: async () => ({ error: { message: 'fail' } }),
    setItems,
  });

  assert.deepEqual(current, original);
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
    { id: 1, read: true, _actionsResolved: true },
    { id: 2, read: false },
  ]);
});
