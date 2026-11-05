/**
 * La rama `canceledGone` de Gestionar partido le hablaba al organizador como
 * a un desarrollador: «En esta base de datos `cancel_match` elimina el
 * registro… hay que aplicar la migración 34 en Supabase». Es una pantalla de
 * usuario, y desde la 34 el partido se conserva como `cancelado`.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'ManageMatchScreen.js'), 'utf8');

/** El JSX que se pinta cuando el partido cancelado ya no está. */
function ramaCanceledGone() {
  const ini = SRC.indexOf('if (canceledGone) {');
  assert.ok(ini > 0, 'no se encontró la rama canceledGone');
  const fin = SRC.indexOf('\n  }\n', ini);
  return SRC.slice(ini, fin);
}

test('la pantalla de partido cancelado no habla de RPC, migraciones ni Supabase', () => {
  const rama = ramaCanceledGone();
  for (const jerga of [/cancel_match/, /migraci[oó]n/i, /Supabase/, /base de datos/i, /registro/i]) {
    assert.ok(!jerga.test(rama), `la rama canceledGone vuelve a mostrar jerga técnica: ${jerga}`);
  }
});

test('sigue diciendo qué pasó y ofreciendo volver', () => {
  const rama = ramaCanceledGone();
  assert.match(rama, /Ya no se juega/);
  assert.match(rama, /Volver a Partidos/);
});
