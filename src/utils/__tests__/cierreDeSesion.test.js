/**
 * El token de push quedaba huérfano al cerrar sesión.
 *
 * EL FALLO. `App.js` borraba el token en el evento `SIGNED_OUT`, que
 * supabase-js emite DESPUÉS de soltar la sesión: el `delete` salía como
 * `anon` y la base lo rechazaba (42501, comprobado contra la base local:
 * sin sesión «quedan 1», con sesión «quedan 0»). El error se tragaba y el
 * teléfono seguía recibiendo los push de la cuenta que ya había salido.
 *
 * Ahora `signOut` da de baja el token ANTES de cerrar la sesión, con un
 * tope de tiempo para que pedir el token a Expo no trabe la salida.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { cerrarSesionEnOrden } = require('../cierreDeSesion.js');

test('el token se da de baja con la sesión todavía viva', async () => {
  const pasos = [];
  let sesionViva = true;
  await cerrarSesionEnOrden({
    usuarioActual: async () => (sesionViva ? 'u1' : null),
    darDeBajaToken: async (uid) => { pasos.push(['baja', uid, sesionViva]); },
    cerrar: async () => { sesionViva = false; pasos.push(['cerrar']); return { error: null }; },
  });
  assert.deepEqual(pasos, [['baja', 'u1', true], ['cerrar']]);
});

test('si dar de baja el token falla o tarda, igual se cierra la sesión', async () => {
  let cerrada = false;
  const r = await cerrarSesionEnOrden({
    usuarioActual: async () => 'u1',
    darDeBajaToken: () => new Promise(() => {}), // nunca responde
    cerrar: async () => { cerrada = true; return { error: null }; },
    topeMs: 20,
  });
  assert.equal(cerrada, true);
  assert.equal(r.error, null);

  cerrada = false;
  await cerrarSesionEnOrden({
    usuarioActual: async () => 'u1',
    darDeBajaToken: async () => { throw new Error('sin red'); },
    cerrar: async () => { cerrada = true; return { error: null }; },
  });
  assert.equal(cerrada, true);
});

test('sin sesión no hay token que dar de baja', async () => {
  let bajas = 0;
  await cerrarSesionEnOrden({
    usuarioActual: async () => null,
    darDeBajaToken: async () => { bajas += 1; },
    cerrar: async () => ({ error: null }),
  });
  assert.equal(bajas, 0);
});

test('signOut usa el cierre en orden y App.js ya no borra en SIGNED_OUT', () => {
  const auth = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'auth.js'), 'utf8');
  const ini = auth.indexOf('export async function signOut(');
  const cuerpo = auth.slice(ini, auth.indexOf('\n}\n', ini));
  assert.match(cuerpo, /cerrarSesionEnOrden\(\{/);
  const app = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'App.js'), 'utf8');
  assert.ok(!/unregisterPushToken\(/.test(app), 'App.js vuelve a borrar el token cuando ya no hay sesión');
});
