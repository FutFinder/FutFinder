/**
 * «Eliminar mi cuenta» (migración 176 + Edge Function `eliminar-cuenta`).
 *
 * `settings.js` importa el cliente de Supabase y no se puede cargar en Node,
 * así que estas pruebas leen el código: fijan el contrato que importa
 * (pasar por la función, caer a la RPC sólo si la función no existe, no
 * mostrar errores crudos) y que la migración y el texto de Ajustes digan lo
 * mismo que hace la base.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const SETTINGS = leer('src/services/settings.js');
const MIGRACION = leer('supabase/migrations/176_borrar_la_cuenta_de_verdad.sql');
const AJUSTES = leer('src/screens/SettingsScreen.js');

const cuerpoDe = (fuente, nombre) => {
  const ini = fuente.indexOf(`export async function ${nombre}(`);
  assert.ok(ini >= 0, `no está ${nombre}`);
  const fin = fuente.indexOf('\nexport ', ini + 10);
  return fuente.slice(ini, fin < 0 ? undefined : fin);
};

test('la app borra por la Edge Function y sólo cae a la RPC si la función no existe', () => {
  const f = cuerpoDe(SETTINGS, 'deleteAccount');
  assert.match(f, /functions\.invoke\('eliminar-cuenta'/);
  const iInvoke = f.indexOf("functions.invoke('eliminar-cuenta'");
  const iRpc = f.indexOf("rpc('delete_my_account')");
  assert.ok(iRpc > iInvoke, 'la RPC directa es el respaldo, no el camino principal');
  assert.match(f.slice(0, iRpc), /status === 404/, 'la RPC directa sólo cuando la función no está desplegada');
});

test('los errores de la base no llegan crudos: sólo los RAISE propios (P0001)', () => {
  assert.match(SETTINGS, /error\?\.code === 'P0001'/);
  // Lo único que llega a la pantalla es `{ message }`, ya escrito acá.
  const f = cuerpoDe(SETTINGS, 'deleteAccount');
  for (const m of f.matchAll(/return \{ error: ([^}]*\}?)/g)) {
    assert.match(m[1], /^(null|\{ message: |eRpc \? \{ message: )/, `devuelve un error crudo: ${m[1]}`);
  }
});

test('la migración deja sin autor lo compartido y anonimiza lo contable', () => {
  for (const [tabla, columna] of [
    ['clubs', 'created_by'],
    ['matches', 'id_organizador'],
    ['club_challenges', 'creado_por'],
    ['reservas', 'organizador_id'],
    ['pagos', 'user_id'],
    ['balance_movimientos', 'user_id'],
  ]) {
    assert.match(MIGRACION, new RegExp(`\\('${tabla}',\\s*'${columna}'`), `${tabla}.${columna} no pasa a set null`);
  }
  assert.match(MIGRACION, /on delete set null/);
  assert.match(MIGRACION, /cuentas_por_limpiar/);
});

test('el aviso de Ajustes no promete borrar lo que la base conserva', () => {
  const i = AJUSTES.indexOf("'¿Eliminar tu cuenta?'");
  const aviso = AJUSTES.slice(i, i + 900);
  assert.ok(!/Se borrarán todos tus datos, partidos/.test(aviso), 'vuelve a decir que borra los partidos');
  assert.match(aviso, /registros de pagos se conservan/);
});
