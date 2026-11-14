/**
 * De `pagos`, la app sólo pide columnas que la migración 180 le deja leer.
 *
 * La 180 cierra por columna: un `select` que nombre `datos`, el token o la
 * nota de devolución —o un `select('*')`— contesta 42501 y la pantalla de
 * pago se queda sin saber cómo quedó el cobro. Esta prueba lee las dos
 * puntas (la consulta del cliente y el `grant` de la migración) para que no
 * se separen.
 *
 * Se ejecutan con: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..', '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

function columnasConcedidas() {
  const sql = leer('supabase/migrations/180_pagos_el_cliente_lee_lo_justo.sql');
  const m = sql.match(/grant select \(([^)]*)\)\s*on public\.pagos to authenticated/);
  assert.ok(m, 'la 180 ya no trae el grant por columna');
  return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

/** Cada `.from('pagos')` del cliente, con las columnas de su `.select(...)`. */
function consultasDePagos() {
  const encontrados = [];
  const dirs = ['src/services', 'src/screens', 'src/utils', 'src/components', 'src/hooks', 'src/contexts'];
  for (const dir of dirs) {
    const abs = path.join(RAIZ, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs, { recursive: true })) {
      if (!String(f).endsWith('.js') || String(f).includes('__tests__')) continue;
      const src = fs.readFileSync(path.join(abs, String(f)), 'utf8');
      const re = /\.from\(\s*'pagos'\s*\)\s*\.select\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/g;
      for (const m of src.matchAll(re)) {
        encontrados.push({ archivo: `${dir}/${f}`, select: m[1] ?? m[2] ?? m[3] ?? '' });
      }
      const sueltos = (src.match(/\.from\(\s*'pagos'\s*\)/g) || []).length;
      const conSelect = [...src.matchAll(re)].length;
      assert.equal(sueltos, conSelect, `${dir}/${f}: hay un from('pagos') que esta prueba no sabe leer`);
    }
  }
  return encontrados;
}

test('las columnas internas del pago no están concedidas', () => {
  const concedidas = columnasConcedidas();
  for (const cerrada of ['datos', 'referencia_externa', 'reversa_nota', 'reversado_por']) {
    assert.ok(!concedidas.includes(cerrada), `${cerrada} no puede estar en el grant`);
  }
});

test('el cliente lee pagos, y sólo columnas concedidas', () => {
  const concedidas = columnasConcedidas();
  const consultas = consultasDePagos();
  assert.ok(consultas.length >= 1, 'no encontré la consulta de estadoDePago');
  for (const { archivo, select } of consultas) {
    const columnas = select.split(',').map((c) => c.trim()).filter(Boolean);
    assert.ok(columnas.length > 0 && !columnas.includes('*'), `${archivo}: select vacío o con *`);
    for (const c of columnas) {
      assert.ok(/^[a-z_]+$/.test(c), `${archivo}: «${c}» no es una columna simple (¿un embebido?)`);
      assert.ok(concedidas.includes(c), `${archivo}: pide «${c}», que la 180 no concede`);
    }
  }
});

test('los filtros y el orden de esa consulta también usan columnas concedidas', () => {
  const concedidas = columnasConcedidas();
  const src = leer('src/services/pagos.js');
  const i = src.indexOf(".from('pagos')");
  const tramo = src.slice(i, src.indexOf(',\n    supabase', i));
  for (const m of tramo.matchAll(/\.(?:eq|order|neq|in|is|gt|lt|gte|lte)\(\s*'([a-z_]+)'/g)) {
    assert.ok(concedidas.includes(m[1]), `filtra u ordena por «${m[1]}», que la 180 no concede`);
  }
});
