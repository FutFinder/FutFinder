/**
 * Pruebas de la consulta de la nómina de un partido entre clubes.
 *
 * LA PRUEBA QUE IMPORTA es la primera: que ninguna columna pedida sea
 * inventada. La nómina llegó a producción pidiendo `profiles.nombre`, que no
 * existe en ninguna migración, y PostgREST contestó
 *
 *     400  {"code":"42703","message":"column profiles_1.nombre does not exist"}
 *
 * rechazando la consulta ENTERA. No se perdía el nombre de un jugador: se
 * perdían las dos nóminas, los conteos quedaban en «0 de 7» y el botón seguía
 * diciendo «Inscribirme» a alguien que ya estaba inscrito. Por eso la lista de
 * columnas se contrasta contra el esquema versionado y no contra la memoria.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  NOMINA_ATTENDEE_COLUMNS,
  NOMINA_PROFILE_COLUMNS,
  NOMINA_COLUMNS,
  buildNominaQuery,
} = require('../nominaQuery.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const SUPABASE = path.join(RAIZ, 'supabase');

/**
 * Lee `schema.sql` y todas las migraciones en el orden en que se aplican.
 *
 * El orden importa: una migración puede agregar una columna que el esquema
 * base no tiene (`club_id` y `origen` llegan en la 45) o quitar una que sí
 * tenía.
 */
function sqlVersionado() {
  const migraciones = fs
    .readdirSync(path.join(SUPABASE, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (na !== nb) return na - nb;
      return a.localeCompare(b);
    })
    .map((f) => path.join(SUPABASE, 'migrations', f));

  return [path.join(SUPABASE, 'schema.sql'), ...migraciones]
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
}

// Palabras con las que empieza una restricción, no una columna.
const NO_ES_COLUMNA = new Set([
  'primary',
  'foreign',
  'unique',
  'check',
  'constraint',
  'exclude',
  'like',
]);

/**
 * Las columnas que el SQL versionado le da a una tabla.
 *
 * Recorre el `create table` contando paréntesis —una columna es una línea a
 * profundidad 1, así que los `check (...)` de varias líneas no se cuelan como
 * columnas— y después aplica los `add column` / `drop column` posteriores.
 */
function columnasDe(sql, tabla) {
  const columnas = new Set();

  const crear = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${tabla}\\s*\\(`,
    'gi'
  );
  let m;
  while ((m = crear.exec(sql)) !== null) {
    let profundidad = 1;
    let i = m.index + m[0].length;
    let linea = '';
    for (; i < sql.length && profundidad > 0; i += 1) {
      const c = sql[i];
      if (c === '\n') {
        const antes = profundidad;
        const primera = linea.trim().split(/[\s(]+/)[0]?.toLowerCase();
        if (antes === 1 && primera && !NO_ES_COLUMNA.has(primera) && /^[a-z_][a-z0-9_]*$/.test(primera)) {
          columnas.add(primera);
        }
        linea = '';
        continue;
      }
      if (c === '(') profundidad += 1;
      else if (c === ')') profundidad -= 1;
      if (profundidad > 0) linea += c;
    }
  }

  const agregar = new RegExp(
    `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${tabla}\\b([\\s\\S]*?);`,
    'gi'
  );
  while ((m = agregar.exec(sql)) !== null) {
    const cuerpo = m[1];
    for (const col of cuerpo.matchAll(
      /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi
    )) {
      columnas.add(col[1].toLowerCase());
    }
    for (const col of cuerpo.matchAll(
      /drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi
    )) {
      columnas.delete(col[1].toLowerCase());
    }
  }

  return columnas;
}

const SQL = sqlVersionado();

test('el parser de esquema reconoce columnas que sí existen', () => {
  // Si esto falla, las dos pruebas siguientes no prueban nada.
  const perfiles = columnasDe(SQL, 'profiles');
  for (const col of ['id', 'username', 'foto_url', 'trust_score', 'bio', 'modalidad']) {
    assert.ok(perfiles.has(col), `el parser no encontró profiles.${col}`);
  }
  assert.ok(!perfiles.has('check'), 'el parser tomó un check() por una columna');

  const asistentes = columnasDe(SQL, 'attendees');
  for (const col of ['id', 'id_partido', 'id_jugador', 'estado', 'inscrito_at']) {
    assert.ok(asistentes.has(col), `el parser no encontró attendees.${col}`);
  }
});

test('la nómina no pide ninguna columna de profiles que no exista', () => {
  const perfiles = columnasDe(SQL, 'profiles');
  const inventadas = NOMINA_PROFILE_COLUMNS.filter((c) => !perfiles.has(c));
  assert.deepEqual(
    inventadas,
    [],
    `PostgREST rechaza la consulta entera con 42703 si se pide una columna que no existe. ` +
      `No están en el esquema versionado: ${inventadas.join(', ')}`
  );
});

test('la nómina no pide ninguna columna de attendees que no exista', () => {
  const asistentes = columnasDe(SQL, 'attendees');
  const inventadas = NOMINA_ATTENDEE_COLUMNS.filter((c) => !asistentes.has(c));
  assert.deepEqual(inventadas, [], `No están en el esquema versionado: ${inventadas.join(', ')}`);
});

test('el nombre visible sale de username: no hace falta una columna nueva', () => {
  // `profiles` no tiene ni ha tenido nunca un campo de nombre propio. La
  // pantalla ya cae en `username`, así que pedirlo alcanza.
  assert.ok(NOMINA_PROFILE_COLUMNS.includes('username'));
  assert.ok(!NOMINA_PROFILE_COLUMNS.includes('nombre'));
});

// ── Cliente falso: imita el query builder encadenable de supabase-js y anota
// lo que se le pidió, para comprobar que el filtro por partido y el orden
// viajan DENTRO de la consulta y no como un `filter()` posterior en JS.
function createFakeQuery() {
  const calls = [];
  const q = {
    calls,
    from(tabla) {
      calls.push(['from', tabla]);
      return q;
    },
    select(cols) {
      calls.push(['select', cols]);
      return q;
    },
    eq(col, val) {
      calls.push(['eq', col, val]);
      return q;
    },
    order(col, opts) {
      calls.push(['order', col, opts]);
      return q;
    },
  };
  return q;
}

test('buildNominaQuery filtra por partido y ordena por llegada en la consulta', () => {
  const q = createFakeQuery();
  const res = buildNominaQuery(q, 'match-1');

  assert.equal(res, q, 'debe devolver la consulta encadenable, no un arreglo ya resuelto');
  assert.deepEqual(q.calls[0], ['from', 'attendees']);
  assert.deepEqual(q.calls[1], ['select', NOMINA_COLUMNS]);
  assert.deepEqual(q.calls[2], ['eq', 'id_partido', 'match-1']);
  assert.deepEqual(q.calls[3], ['order', 'inscrito_at', { ascending: true }]);
});

test('buildNominaQuery pide los dos clubes: no filtra por club_id', () => {
  // La gracia de la pantalla es ver cómo va el rival. Quien no puede mirar ya
  // lo corta la RLS de la 44d, no esta consulta.
  const q = createFakeQuery();
  buildNominaQuery(q, 'match-1');
  assert.ok(!q.calls.some((c) => c[0] === 'eq' && c[1] === 'club_id'));
});

test('el embed de profiles viaja en el select, no en una segunda consulta', () => {
  assert.match(NOMINA_COLUMNS, /profiles:id_jugador \(/);
  for (const col of NOMINA_ATTENDEE_COLUMNS) {
    assert.match(NOMINA_COLUMNS, new RegExp(`\\b${col}\\b`));
  }
});
