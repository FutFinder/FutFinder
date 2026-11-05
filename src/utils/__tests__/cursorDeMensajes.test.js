/**
 * C03 de la auditoría de chats y avisos (2026-09-23): el historial de un
 * hilo perdía mensajes que compartían fecha justo en el corte de página.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  aplicarOrdenYCursorDeMensajes,
  cursorDeHistorial,
  cursorDeMensaje,
  deNuevoAAntiguo,
  vieneAntesQue,
} = require('../cursorDeMensajes.js');

const SERVICIO = fs.readFileSync(
  path.join(__dirname, '..', '..', 'services', 'messages.js'),
  'utf8'
);
const PANTALLA = fs.readFileSync(
  path.join(__dirname, '..', '..', 'screens', 'ChatThreadScreen.js'),
  'utf8'
);

const MISMA_HORA = '2026-09-22T21:00:00.123456+00:00';

/** 41 mensajes con la misma fecha, como los de la auditoría. */
function hiloEmpatado(n = 41) {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    created_at: MISMA_HORA,
  }));
}

/** Lo que haría el servidor: filtra, ordena y corta en `limit + 1`. */
function paginaDelServidor(filas, { limit, cursor }) {
  const rows = filas
    .filter((m) => vieneAntesQue(m, cursor))
    .sort(deNuevoAAntiguo)
    .slice(0, limit + 1);
  const hasMore = rows.length > limit;
  return { data: (hasMore ? rows.slice(0, limit) : rows).reverse(), hasMore };
}

test('C03: 41 mensajes a la misma hora se leen todos, en dos páginas', () => {
  const filas = hiloEmpatado(41);
  const p1 = paginaDelServidor(filas, { limit: 40, cursor: null });
  assert.equal(p1.data.length, 40);
  assert.equal(p1.hasMore, true);

  const p2 = paginaDelServidor(filas, { limit: 40, cursor: cursorDeHistorial(p1.data) });
  assert.equal(p2.data.length, 1, 'la segunda página volvió vacía: se perdió un mensaje');
  assert.equal(p2.hasMore, false);

  const vistos = new Set([...p1.data, ...p2.data].map((m) => m.id));
  assert.equal(vistos.size, 41);
});

test('C03: el cursor viejo (sólo created_at) es el que perdía el mensaje', () => {
  // Documenta el fallo: con `created_at < c` la segunda página sale vacía.
  const filas = hiloEmpatado(41);
  const p1 = paginaDelServidor(filas, { limit: 40, cursor: null });
  const viejo = filas.filter((m) => m.created_at < p1.data[0].created_at);
  assert.equal(viejo.length, 0);
});

test('C03: la consulta ordena por (created_at, id) y filtra con el par', () => {
  const llamadas = { order: [], or: [] };
  const q = {
    order(col, opts) { llamadas.order.push([col, opts]); return q; },
    or(f) { llamadas.or.push(f); return q; },
  };
  aplicarOrdenYCursorDeMensajes(q, { created_at: MISMA_HORA, id: 'abc' });
  assert.deepEqual(llamadas.order, [
    ['created_at', { ascending: false }],
    ['id', { ascending: false }],
  ]);
  assert.deepEqual(llamadas.or, [
    `created_at.lt."${MISMA_HORA}",and(created_at.eq."${MISMA_HORA}",id.lt."abc")`,
  ]);

  const sinCursor = { order: [], or: [] };
  const q2 = {
    order(col, opts) { sinCursor.order.push([col, opts]); return q2; },
    or(f) { sinCursor.or.push(f); return q2; },
  };
  aplicarOrdenYCursorDeMensajes(q2, null);
  assert.equal(sinCursor.or.length, 0, 'la primera página no lleva cursor');
});

test('C03: los mensajes optimistas no sirven de cursor', () => {
  assert.equal(cursorDeMensaje({ id: 'local-123', created_at: MISMA_HORA }), null);
  assert.equal(cursorDeMensaje({ id: 'x' }), null);
  assert.deepEqual(
    cursorDeHistorial([{ id: 'local-1', created_at: MISMA_HORA }, { id: 'm-2', created_at: MISMA_HORA }]),
    { created_at: MISMA_HORA, id: 'm-2' }
  );
  assert.equal(cursorDeHistorial([]), null);
});

test('C03: el servicio pagina con el cursor compuesto, no con lt(created_at)', () => {
  const ini = SERVICIO.indexOf('export async function listThreadMessages');
  const fin = SERVICIO.indexOf('export async function', ini + 10);
  const cuerpo = SERVICIO.slice(ini, fin);
  assert.ok(!/\.lt\('created_at'/.test(cuerpo), 'listThreadMessages vuelve a paginar sólo por created_at');
  assert.match(cuerpo, /aplicarOrdenYCursorDeMensajes\(/);
});

test('C03: «cargar anteriores» manda el par, no sólo la fecha', () => {
  assert.ok(
    !/before:\s*oldest\b/.test(PANTALLA) && !/messages\[0\]\?\.created_at/.test(PANTALLA),
    'la pantalla vuelve a pedir la página anterior sólo por fecha'
  );
  assert.match(PANTALLA, /cursorDeHistorial\(messages\)/);
});
