/**
 * Pruebas de la consulta de "Usuarios bloqueados".
 *
 * LA PRUEBA QUE IMPORTA es la primera: que ninguna columna pedida sea
 * inventada. Esta consulta llegó a pedir `profiles.nombre`, que no existe:
 *
 *     400  {"code":"42703","message":"column profiles_1.nombre does not exist"}
 *
 * PostgREST no omite la columna que falta: rechaza la consulta ENTERA, así que
 * la pantalla se quedaba sin lista, no sin un nombre. Se coló porque la
 * migración 51 no estaba aplicada y el error que llegaba antes era `PGRST205`,
 * que el servicio sí sabía tratar; al aplicarla, el fallo habría cambiado de
 * forma y la pantalla habría quedado vacía sin decir por qué.
 *
 * Las columnas se contrastan contra el esquema versionado, no contra la
 * memoria.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BLOCKED_USERS_COLUMNS,
  BLOCKED_USERS_PROFILE_COLUMNS,
  BLOCKED_USERS_PROFILE_FK,
  buildBlockedUsersSelect,
} = require('../blockedUsersQuery.js');

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
  // Si esto falla, las pruebas siguientes no prueban nada.
  const perfiles = columnasDe(SQL, 'profiles');
  for (const col of ['id', 'username', 'foto_url', 'bio']) {
    assert.ok(perfiles.has(col), `el parser debería ver profiles.${col}`);
  }
  const bloqueos = columnasDe(SQL, 'blocked_users');
  for (const col of ['id', 'blocker_id', 'blocked_id', 'created_at']) {
    assert.ok(bloqueos.has(col), `el parser debería ver blocked_users.${col}`);
  }
});

test('ninguna columna pedida de blocked_users es inventada', () => {
  const reales = columnasDe(SQL, 'blocked_users');
  const inventadas = BLOCKED_USERS_COLUMNS.filter((c) => !reales.has(c));
  assert.deepEqual(
    inventadas,
    [],
    `PostgREST rechaza la consulta entera con 42703 si se pide una columna que no existe. ` +
      `No están en el esquema versionado: ${inventadas.join(', ')}`
  );
});

test('ninguna columna pedida del perfil embebido es inventada', () => {
  const reales = columnasDe(SQL, 'profiles');
  const inventadas = BLOCKED_USERS_PROFILE_COLUMNS.filter((c) => !reales.has(c));
  assert.deepEqual(
    inventadas,
    [],
    `PostgREST rechaza la consulta entera con 42703 si se pide una columna que no existe. ` +
      `No están en el esquema versionado: ${inventadas.join(', ')}`
  );
});

test('el nombre visible sale de username: profiles no tiene columna de nombre propio', () => {
  // `profiles` no tiene ni ha tenido nunca un campo `nombre`. La pantalla
  // muestra `username`, igual que el resto de la app.
  assert.ok(!BLOCKED_USERS_PROFILE_COLUMNS.includes('nombre'));
  assert.ok(!columnasDe(SQL, 'profiles').has('nombre'));
});

test('la clave foránea del embed existe y es la del bloqueado, no la del bloqueador', () => {
  // `blocked_users` apunta dos veces a `profiles`; sin nombrar la FK PostgREST
  // responde 300 por ambigüedad. Y tiene que ser la de `blocked_id`: con la de
  // `blocker_id` la lista mostraría al bloqueador, o sea a uno mismo.
  assert.equal(BLOCKED_USERS_PROFILE_FK, 'blocked_users_blocked_id_fkey');
  assert.match(SQL, /blocked_id\s+uuid\s+not\s+null\s+references\s+public\.profiles\(id\)/i);
});

test('el select armado es el que espera PostgREST', () => {
  assert.equal(
    buildBlockedUsersSelect(),
    'id, blocked_id, created_at, profile:profiles!blocked_users_blocked_id_fkey(id, username, foto_url)'
  );
});
