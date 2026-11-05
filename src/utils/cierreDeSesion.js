/**
 * Cerrar sesión en el orden correcto: primero lo que necesita la sesión,
 * después la sesión.
 *
 * EL FALLO. El token de push se borraba al recibir `SIGNED_OUT` (en
 * `App.js`), y supabase-js emite ese evento DESPUÉS de soltar la sesión. El
 * `delete` sobre `push_tokens` salía como `anon` y la base lo rechazaba con
 * 42501 (la RLS pide `auth.uid() = user_id`, y desde la 113 `anon` no
 * escribe nada). El error se tragaba: el teléfono seguía recibiendo los
 * push de una cuenta que ya había salido, también en uno compartido.
 *
 * Dar de baja el token no puede impedir salir: si falla o tarda más que el
 * tope (pedir el token a Expo puede demorar sin red), se cierra igual.
 *
 * Sin React ni Supabase, para probarse con `node --test`.
 */

const TOPE_MS = 3000;

function conTope(promesa, ms) {
  return Promise.race([
    Promise.resolve(promesa).catch(() => null),
    new Promise((resolver) => setTimeout(resolver, ms)),
  ]);
}

export async function cerrarSesionEnOrden({ usuarioActual, darDeBajaToken, cerrar, topeMs = TOPE_MS }) {
  let uid = null;
  try {
    uid = await usuarioActual();
  } catch {
    uid = null;
  }
  if (uid) await conTope(darDeBajaToken(uid), topeMs);
  return cerrar();
}
