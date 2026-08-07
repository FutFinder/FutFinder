/**
 * Pruebas de buildSearchPlayersQuery(): confirman que la exclusión de
 * perfiles con "Visible en búsquedas" desactivado viaja en la consulta
 * real (vía .eq), no como un filtro que se aplica después sobre los
 * resultados ya traídos.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSearchPlayersQuery } = require('../searchPlayersQuery.js');

// ── Cliente falso: imita el query builder encadenable de supabase-js,
// aplicando cada filtro sobre un arreglo en memoria en vez de mandar
// una consulta real. Así probamos el comportamiento de principio a fin
// (qué filas quedan) y no solo qué métodos se llamaron.
function createFakeQuery(rows) {
  let result = rows;
  const calls = [];
  const q = {
    calls,
    select(cols) {
      calls.push(['select', cols]);
      return q;
    },
    eq(col, val) {
      calls.push(['eq', col, val]);
      result = result.filter((r) => r[col] === val);
      return q;
    },
    ilike(col, pattern) {
      calls.push(['ilike', col, pattern]);
      const needle = pattern.replace(/%/g, '').toLowerCase();
      result = result.filter((r) => String(r[col] || '').toLowerCase().includes(needle));
      return q;
    },
    order(col, { ascending } = {}) {
      calls.push(['order', col, ascending]);
      result = [...result].sort((a, b) => (ascending ? a[col] - b[col] : b[col] - a[col]));
      return q;
    },
    contains(col, val) {
      calls.push(['contains', col, val]);
      result = result.filter((r) => (r[col] || []).some((v) => val.includes(v)));
      return q;
    },
    in(col, list) {
      calls.push(['in', col, list]);
      result = result.filter((r) => list.includes(r[col]));
      return q;
    },
    gte(col, val) {
      calls.push(['gte', col, val]);
      result = result.filter((r) => r[col] >= val);
      return q;
    },
    lte(col, val) {
      calls.push(['lte', col, val]);
      result = result.filter((r) => r[col] <= val);
      return q;
    },
    limit(n) {
      calls.push(['limit', n]);
      result = result.slice(0, n);
      return q;
    },
    then(resolve) {
      resolve({ data: result, error: null });
    },
  };
  return q;
}

function createFakeClient(rows) {
  return { from: () => createFakeQuery(rows) };
}

const ROWS = [
  { id: 'visible-1', username: 'juanito', privacy_visible_in_search: true, trust_score: 80 },
  { id: 'oculto-1', username: 'pedrito', privacy_visible_in_search: false, trust_score: 95 },
];

test('un perfil visible aparece en los resultados de búsqueda', async () => {
  const q = buildSearchPlayersQuery(createFakeClient(ROWS), '', {}, 30);
  const { data } = await q;
  assert.ok(data.some((r) => r.id === 'visible-1'));
});

test('un perfil oculto (privacy_visible_in_search = false) no aparece, aunque tenga más trust score', async () => {
  const q = buildSearchPlayersQuery(createFakeClient(ROWS), '', {}, 30);
  const { data } = await q;
  assert.ok(!data.some((r) => r.id === 'oculto-1'));
});

test('la exclusión de ocultos va en la consulta (.eq), no en un filtro posterior', () => {
  const q = buildSearchPlayersQuery(createFakeClient(ROWS), 'juan', {}, 30);
  assert.ok(
    q.calls.some(([method, col, val]) => method === 'eq' && col === 'privacy_visible_in_search' && val === true)
  );
});

test('la exclusión de ocultos se aplica también cuando hay término de búsqueda y filtros', () => {
  const q = buildSearchPlayersQuery(createFakeClient(ROWS), 'juan', { region: 'RM', posicion: 'arquero' }, 30);
  assert.ok(
    q.calls.some(([method, col, val]) => method === 'eq' && col === 'privacy_visible_in_search' && val === true)
  );
});

test('sin término de búsqueda, ordena por trust_score entre los visibles', async () => {
  const rows = [
    { id: 'a', username: 'ana', privacy_visible_in_search: true, trust_score: 50 },
    { id: 'b', username: 'beto', privacy_visible_in_search: true, trust_score: 99 },
  ];
  const q = buildSearchPlayersQuery(createFakeClient(rows), '', {}, 30);
  const { data } = await q;
  assert.deepEqual(data.map((r) => r.id), ['b', 'a']);
});
