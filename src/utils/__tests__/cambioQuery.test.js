/**
 * Pruebas de la consulta de solicitudes de cambio (`club_match_changes`).
 *
 * LA PRUEBA QUE IMPORTA es la primera: que ninguna columna pedida sea
 * inventada. Es la misma red que se puso en `nominaQuery.test.js` después de
 * que la nómina llegara a producción pidiendo `profiles.nombre` y PostgREST
 * contestara `400 {"code":"42703"}` rechazando la consulta ENTERA. Una columna
 * de más no degrada la pantalla: la apaga.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CAMBIO_COLUMNS,
  CAMBIO_SELECT,
  ESTADO_PENDIENTE,
  buildCambioPendienteQuery,
  buildCambiosDelPartidoQuery,
} = require('../cambioQuery.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const MIGRACION = path.join(RAIZ, 'supabase', 'migrations', '46_cambios_de_partido.sql');

/**
 * Las columnas que la migración le da a `club_match_changes`.
 *
 * Recorre el `create table` contando paréntesis: una columna es una línea a
 * profundidad 1, así que los `check (...)` y los `references ... (id)` no se
 * cuelan como columnas.
 */
function columnasDeLaMigracion() {
  const sql = fs.readFileSync(MIGRACION, 'utf8');
  const inicio = sql.search(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.club_match_changes\s*\(/i
  );
  assert.notEqual(inicio, -1, 'la migración 46 debería crear `club_match_changes`');

  const desde = sql.indexOf('(', inicio);
  const columnas = new Set();
  let profundidad = 0;
  let linea = '';

  for (let i = desde; i < sql.length; i += 1) {
    const c = sql[i];
    if (c === '(') {
      profundidad += 1;
      if (profundidad === 1) continue;
    }
    if (c === ')') {
      profundidad -= 1;
      if (profundidad === 0) break;
    }
    if (profundidad === 1 && (c === ',' || c === '\n')) {
      if (c === ',') {
        const nombre = linea.trim().split(/\s+/)[0];
        if (nombre) columnas.add(nombre.toLowerCase());
        linea = '';
        continue;
      }
    }
    linea += c;
  }
  const ultima = linea.trim().split(/\s+/)[0];
  if (ultima) columnas.add(ultima.toLowerCase());

  return columnas;
}

test('ninguna columna pedida es inventada: todas están en la migración 46', () => {
  const existentes = columnasDeLaMigracion();
  assert.ok(existentes.size > 5, 'el lector de la migración debería encontrar columnas');

  for (const columna of CAMBIO_COLUMNS) {
    assert.ok(
      existentes.has(columna.toLowerCase()),
      `«${columna}» no existe en club_match_changes — PostgREST rechazaría la consulta entera`
    );
  }
});

test('el select no pide embeds: `club_match_changes` no tiene ninguno que valga', () => {
  assert.doesNotMatch(CAMBIO_SELECT, /\(/, 'un embed inventado tumba la consulta completa');
});

test('el estado pendiente es el mismo literal que acepta el CHECK de la 46', () => {
  const sql = fs.readFileSync(MIGRACION, 'utf8');
  assert.match(sql, new RegExp(`'${ESTADO_PENDIENTE}'`));
});

// ---------------------------------------------------------------------------
// La forma de la consulta, con un doble de Supabase
// ---------------------------------------------------------------------------

function supabaseFalso(registro) {
  const cadena = {
    select(cols) { registro.select = cols; return cadena; },
    eq(col, val) { registro.eq.push([col, val]); return cadena; },
    order(col, opts) { registro.order = [col, opts]; return cadena; },
    limit(n) { registro.limit = n; return cadena; },
    maybeSingle() { registro.maybeSingle = true; return cadena; },
  };
  return {
    from(tabla) { registro.from = tabla; return cadena; },
  };
}

test('la pendiente se pide por partido y estado, y espera una sola fila', () => {
  const registro = { eq: [] };
  buildCambioPendienteQuery(supabaseFalso(registro), 'm1');

  assert.equal(registro.from, 'club_match_changes');
  assert.equal(registro.select, CAMBIO_SELECT);
  assert.deepEqual(registro.eq, [['match_id', 'm1'], ['estado', 'pendiente']]);
  // Una sola: el índice único parcial de la 46 impide que haya dos pendientes.
  assert.equal(registro.maybeSingle, true);
});

test('el historial llega de la más reciente a la más antigua y viene acotado', () => {
  const registro = { eq: [] };
  buildCambiosDelPartidoQuery(supabaseFalso(registro), 'm1');

  assert.deepEqual(registro.eq, [['match_id', 'm1']]);
  assert.deepEqual(registro.order, ['created_at', { ascending: false }]);
  assert.equal(registro.limit, 20);
});
