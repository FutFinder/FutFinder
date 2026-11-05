/**
 * C06 de la auditoría de chats y avisos (2026-09-23): la bandeja pedía 50
 * avisos y filtraba después, así que lo que quedaba del 51 para atrás no se
 * podía ver nunca, ni siquiera filtrando.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  AVISOS_POR_PAGINA,
  CLAVES_DE_CLUB,
  aplicarFiltrosDeAvisos,
  cursorDeAvisos,
  paginaDeAvisos,
  sumarPaginaDeAvisos,
  tiposDeCategoria,
} = require('../consultaDeAvisos.js');
const { vieneAntesQue, deNuevoAAntiguo } = require('../cursorDeMensajes.js');
const { avisoDelClub } = require('../clubsHomeSources.js');

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

const MAPA = {
  match_join: 'partidos',
  match_reminder: 'partidos',
  club_request: 'clubes',
  club_challenge: 'clubes',
  friend_request: 'social',
};

/** Lo que haría PostgREST con esos filtros, en memoria. */
function servidor(filas, { tipos = null, clubId = null, cursor = null, limit }) {
  const rows = filas
    .filter((n) => !tipos || tipos.includes(n.type))
    .filter((n) => !clubId || CLAVES_DE_CLUB.some((k) => n.data?.[k] === clubId))
    .filter((n) => vieneAntesQue(n, cursor))
    .sort(deNuevoAAntiguo)
    .slice(0, limit + 1);
  return paginaDeAvisos(rows, limit);
}

const id = (i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
const minuto = (m) => new Date(Date.UTC(2026, 8, 22, 12, 0) - m * 60000).toISOString();

test('C06: la solicitud de club del puesto 51 aparece en «Clubes»', () => {
  const filas = Array.from({ length: 50 }, (_, i) => ({
    id: id(i + 1), type: 'match_join', created_at: minuto(i), data: {},
  }));
  filas.push({ id: id(99), type: 'club_request', created_at: minuto(60), data: { clubId: 'c1' } });

  // Cómo era: 50 globales y el filtro después. La solicitud no está.
  const antes = servidor(filas, { limit: 50 }).data.filter((n) => MAPA[n.type] === 'clubes');
  assert.equal(antes.length, 0);

  // Cómo es: el filtro va en la consulta, antes del límite.
  const ahora = servidor(filas, { tipos: tiposDeCategoria('clubes', MAPA), limit: AVISOS_POR_PAGINA });
  assert.deepEqual(ahora.data.map((n) => n.id), [id(99)]);
});

test('C06: el filtro de club también va antes del límite', () => {
  const filas = Array.from({ length: 50 }, (_, i) => ({
    id: id(i + 1), type: 'club_request', created_at: minuto(i), data: { clubId: 'otro' },
  }));
  filas.push({ id: id(99), type: 'club_challenge', created_at: minuto(70), data: { clubRetadoId: 'c1' } });
  const p = servidor(filas, { tipos: tiposDeCategoria('clubes', MAPA), clubId: 'c1', limit: 30 });
  assert.deepEqual(p.data.map((n) => n.id), [id(99)]);
});

test('C06: se puede seguir hacia atrás sin perder avisos, aunque empaten en el corte', () => {
  const mismaHora = minuto(5);
  const filas = Array.from({ length: 65 }, (_, i) => ({
    id: id(i + 1), type: 'match_join', created_at: i < 40 ? minuto(i % 3) : mismaHora, data: {},
  }));
  let cargados = [];
  let hayMas = true;
  let vueltas = 0;
  while (hayMas && vueltas < 10) {
    const p = servidor(filas, { cursor: cursorDeAvisos(cargados), limit: 30 });
    cargados = sumarPaginaDeAvisos(cargados, p.data);
    hayMas = p.hasMore;
    vueltas += 1;
  }
  assert.equal(new Set(cargados.map((n) => n.id)).size, 65);
});

test('C06: la consulta pone orden, tipos, club y cursor', () => {
  const r = { order: [], in: [], or: [] };
  const q = {
    order(c, o) { r.order.push([c, o]); return q; },
    in(c, v) { r.in.push([c, v]); return q; },
    or(f) { r.or.push(f); return q; },
  };
  aplicarFiltrosDeAvisos(q, {
    tipos: ['club_request'],
    clubId: 'c1',
    cursor: { created_at: '2026-09-22T12:00:00Z', id: 'x' },
  });
  assert.deepEqual(r.order, [['created_at', { ascending: false }], ['id', { ascending: false }]]);
  assert.deepEqual(r.in, [['type', ['club_request']]]);
  assert.deepEqual(r.or, [
    'created_at.lt."2026-09-22T12:00:00Z",and(created_at.eq."2026-09-22T12:00:00Z",id.lt."x")',
    'data->>clubId.eq."c1",data->>clubRetadorId.eq."c1",data->>clubRetadoId.eq."c1"',
  ]);
});

test('C06: «todos» no filtra por tipo', () => {
  assert.equal(tiposDeCategoria('todos', MAPA), null);
  assert.equal(tiposDeCategoria(null, MAPA), null);
  assert.deepEqual(tiposDeCategoria('partidos', MAPA), ['match_join', 'match_reminder']);
});

test('C06: el filtro de club del servidor reconoce lo mismo que avisoDelClub', () => {
  for (const k of CLAVES_DE_CLUB) {
    assert.equal(avisoDelClub({ data: { [k]: 'c1' } }, 'c1'), true, `avisoDelClub ya no mira ${k}`);
  }
  const src = leer('utils', 'clubsHomeSources.js');
  const cuerpo = src.slice(src.indexOf('export function avisoDelClub'));
  const claves = cuerpo.slice(0, cuerpo.indexOf('\n}\n')).match(/d\.(\w+) === clubId/g) || [];
  assert.equal(claves.length, CLAVES_DE_CLUB.length, 'avisoDelClub mira otras claves que el servidor');
});

test('C06: el servicio pagina y filtra en la consulta', () => {
  const src = leer('services', 'notifications.js');
  const ini = src.indexOf('export async function listNotifications(');
  const cuerpo = src.slice(ini, src.indexOf('\n}\n', ini));
  assert.match(cuerpo, /aplicarFiltrosDeAvisos\(/, 'listNotifications vuelve a pedir sin filtros');
  assert.match(cuerpo, /\.limit\(limit \+ 1\)/, 'sin uno de más no se sabe si quedan avisos');
});

test('C06: la bandeja pide con su filtro y ofrece cargar más', () => {
  const src = leer('screens', 'NotificationsScreen.js');
  assert.ok(!/listNotifications\(\{ limit: 50 \}\)/.test(src), 'la bandeja vuelve a pedir 50 y filtrar después');
  assert.match(src, /tiposDeCategoria\(filtroEfectivo, CATEGORY\)/);
  assert.match(src, /cursorDeAvisos\(/);
  assert.match(src, /Ver avisos anteriores/);
});
