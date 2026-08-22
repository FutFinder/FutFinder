/**
 * Pruebas de buildRivalClubsQuery(): que los clubes propios del usuario y
 * el club que reta queden fuera DE LA CONSULTA, no de un filtro posterior.
 *
 * El cliente falso imita el query builder encadenable de supabase-js y
 * aplica cada filtro sobre un arreglo en memoria, así que se comprueba el
 * resultado real (qué filas quedan) y además qué filtros se enviaron.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRivalClubsQuery, RIVAL_CLUB_COLUMNS } = require('../rivalClubsQuery.js');

function createFakeQuery(rows) {
  let result = rows;
  const calls = [];
  const q = {
    calls,
    select(cols) {
      calls.push(['select', cols]);
      return q;
    },
    not(col, op, val) {
      calls.push(['not', col, op, val]);
      if (op === 'in') {
        const ids = val.replace(/^\(|\)$/g, '').split(',').filter(Boolean);
        result = result.filter((r) => !ids.includes(r[col]));
      }
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

const CLUBES = [
  { id: 'mio-1', nombre: 'Club Propio Uno', verificado: false },
  { id: 'mio-2', nombre: 'Club Propio Dos', verificado: false },
  { id: 'rival-1', nombre: 'Deportivo Ñuñoa', verificado: true },
  { id: 'rival-2', nombre: 'Atlético Maipú', verificado: false },
  { id: 'rival-3', nombre: 'Los Cóndores', verificado: false },
];

test('los clubes propios y el retador no aparecen entre los candidatos', async () => {
  const client = createFakeClient(CLUBES);
  const { data } = await buildRivalClubsQuery(client, {
    excludeIds: ['mio-1', 'mio-2'],
  });

  const ids = data.map((c) => c.id);
  assert.ok(!ids.includes('mio-1'), 'un club propio no puede ofrecerse como rival');
  assert.ok(!ids.includes('mio-2'), 'un club propio no puede ofrecerse como rival');
  assert.deepEqual(ids, ['rival-1', 'rival-2', 'rival-3']);
});

test('la exclusión viaja en la consulta (.not), no en un filtro posterior', async () => {
  const client = { from: () => createFakeQuery(CLUBES) };
  const q = buildRivalClubsQuery(client, { excludeIds: ['mio-1'] });

  const enviado = q.calls.find(([metodo, col, op]) => metodo === 'not' && col === 'id' && op === 'in');
  assert.ok(enviado, 'la exclusión debe enviarse como filtro .not(id, in, ...)');
  assert.equal(enviado[3], '(mio-1)');
});

test('sin ids que excluir no se manda un filtro vacío, que sería sintaxis inválida', async () => {
  for (const vacio of [[], null, undefined, [null, undefined, '']]) {
    const client = { from: () => createFakeQuery(CLUBES) };
    const q = buildRivalClubsQuery(client, { excludeIds: vacio });
    const enviado = q.calls.find(([metodo]) => metodo === 'not');
    assert.equal(enviado, undefined, `con ${JSON.stringify(vacio)} no debe agregarse un .not vacío`);
    const { data } = await q;
    assert.equal(data.length, CLUBES.length);
  }
});

test('los ids repetidos se mandan una sola vez', () => {
  const client = { from: () => createFakeQuery(CLUBES) };
  const q = buildRivalClubsQuery(client, { excludeIds: ['mio-1', 'mio-1', 'mio-2'] });
  const enviado = q.calls.find(([metodo]) => metodo === 'not');
  assert.equal(enviado[3], '(mio-1,mio-2)');
});

test('la exclusión se mantiene aunque haya término de búsqueda', async () => {
  const client = createFakeClient([
    ...CLUBES,
    { id: 'mio-3', nombre: 'Deportivo Propio', verificado: false },
  ]);
  const { data } = await buildRivalClubsQuery(client, {
    excludeIds: ['mio-3'],
    query: 'Deportivo',
  });

  const ids = data.map((c) => c.id);
  assert.ok(!ids.includes('mio-3'), 'buscar por nombre no puede recuperar un club propio');
  assert.deepEqual(ids, ['rival-1']);
});

test('un término con espacios se recorta antes de buscar', () => {
  const client = { from: () => createFakeQuery(CLUBES) };
  const q = buildRivalClubsQuery(client, { query: '   Ñuñoa   ' });
  const enviado = q.calls.find(([metodo]) => metodo === 'ilike');
  assert.equal(enviado[2], '%Ñuñoa%');
});

test('un término vacío no agrega un ilike que no filtra nada', () => {
  for (const vacio of ['', '   ', null, undefined]) {
    const client = { from: () => createFakeQuery(CLUBES) };
    const q = buildRivalClubsQuery(client, { query: vacio });
    assert.equal(q.calls.find(([metodo]) => metodo === 'ilike'), undefined);
  }
});

test('el límite viaja a la consulta y los verificados van primero', () => {
  const client = { from: () => createFakeQuery(CLUBES) };
  const q = buildRivalClubsQuery(client, { limit: 5 });

  assert.ok(q.calls.some(([m, n]) => m === 'limit' && n === 5));
  const orden = q.calls.filter(([m]) => m === 'order');
  assert.deepEqual(orden[0], ['order', 'verificado', false]);
});

test('pide las columnas mínimas para pintar una tarjeta de rival', () => {
  const client = { from: () => createFakeQuery(CLUBES) };
  const q = buildRivalClubsQuery(client, {});
  const seleccion = q.calls.find(([m]) => m === 'select');
  assert.equal(seleccion[1], RIVAL_CLUB_COLUMNS);
  for (const col of ['id', 'nombre', 'foto_url', 'comuna']) {
    assert.ok(RIVAL_CLUB_COLUMNS.includes(col), `falta la columna ${col}`);
  }
});

test('la tarjeta de un rival trae SU tema, para no pintarla con el color del club propio', () => {
  // Dos clubes con temas distintos conviven en la misma pantalla: el carrusel
  // «Buscar rivales» vive dentro de «Mi club». Si el tema del rival no viaja
  // en la consulta, su tarjeta se pinta con el color de quien la mira.
  assert.ok(
    RIVAL_CLUB_COLUMNS.split(',')
      .map((c) => c.trim())
      .includes('tema'),
    `falta la columna tema en «${RIVAL_CLUB_COLUMNS}»`
  );
});
