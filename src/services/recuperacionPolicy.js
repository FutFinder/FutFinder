/**
 * «Olvidé mi contraseña», con un código de 6 dígitos en vez de un enlace.
 *
 * Antes se llamaba `resetPasswordForEmail` sin `redirectTo` y nada en la app
 * escuchaba `PASSWORD_RECOVERY`: el enlace abría la web con la sesión iniciada
 * y el único cambio de contraseña que había (Ajustes) pedía la ACTUAL, que es
 * justo la que se olvidó. Quien la olvidaba quedaba fuera de su cuenta.
 *
 * El flujo nuevo reutiliza el correo que ya funciona en producción: el de
 * `signInWithOtp`, cuya plantilla (Magic Link) manda `{{ .Token }}` — es el
 * mismo de «Reenviar código» del registro. No hace falta tocar el panel:
 *
 *   1. pedirCodigo        → signInWithOtp({ shouldCreateUser: false })
 *   2. verificarCodigo    → verifyOtp({ type: 'email' }) → sesión
 *      (si la cuenta tiene verificación en dos pasos, falta el código de la
 *      app de autenticación antes del paso 3: Supabase exige `aal2` para
 *      cambiar la contraseña de quien la tiene activada)
 *   3. fijarNuevaPassword → updateUser({ password }) y cierra las OTRAS
 *      sesiones: si alguien más entró con la contraseña vieja, queda fuera.
 *
 * Todo recibe el cliente de auth por parámetro (como `performLogin`) para
 * poder probarlo sin red ni React Native.
 */
import { describeAuthError, isValidEmail, isSessionUsable, MENSAJES } from './authPolicy.js';
import { validarPassword } from '../utils/passwordStrength.js';
import { nivelDesdeSesion, necesitaSegundoPaso, codigoCompleto } from './mfaPolicy.js';

export const MENSAJES_RECUPERACION = {
  codigoEnviado: (email) =>
    `Si ${email} tiene una cuenta en FutFinder, te llegará un código de 6 dígitos. Revisa también el spam.`,
  codigoIncompleto: 'Ingresa los 6 dígitos del correo.',
  passwordsDistintas: 'Las contraseñas no coinciden.',
  mismaPassword: 'Usa una contraseña distinta a la anterior.',
  faltaSegundoPaso:
    'Tu cuenta tiene verificación en dos pasos: ingresa primero el código de tu app de autenticación.',
  sinSesion: 'El código ya no sirve. Pide uno nuevo.',
  crearPassword:
    'Tu correo ya quedó verificado. Falta elegir la contraseña con la que vas a entrar a FutFinder.',
  passwordRechazada: 'La contraseña que escribiste al registrarte no cumple las reglas. Elige otra.',
};

/**
 * Errores que significan «ese correo no tiene cuenta». Se responden IGUAL que
 * un envío correcto: si no, esta pantalla serviría para averiguar qué correos
 * están registrados.
 */
function esCuentaInexistente(error) {
  const codigo = error?.code || error?.error_code || '';
  if (codigo === 'otp_disabled' || codigo === 'user_not_found' || codigo === 'signup_disabled') return true;
  return /signups? not allowed|user not found/i.test(String(error?.message || ''));
}

/** Paso 1. Devuelve `{ error }`, con `error` ya escrito para mostrar. */
export async function pedirCodigo(email, authClient) {
  const correo = String(email || '').trim().toLowerCase();
  if (!isValidEmail(correo)) return { error: { message: MENSAJES.correoInvalido } };
  const { error } = await authClient.signInWithOtp({
    email: correo,
    options: { shouldCreateUser: false },
  });
  if (error && !esCuentaInexistente(error)) return { error: { message: describeAuthError(error) } };
  return { error: null, email: correo };
}

/**
 * Paso 2. Devuelve `{ session, necesitaMfa, error }`. Sin sesión usable no se
 * avanza, aunque el proveedor no haya dado error.
 */
export async function verificarCodigo({ email, codigo }, authClient) {
  if (!codigoCompleto(codigo)) {
    return { session: null, necesitaMfa: false, error: { message: MENSAJES_RECUPERACION.codigoIncompleto } };
  }
  const { data, error } = await authClient.verifyOtp({
    email: String(email || '').trim().toLowerCase(),
    token: codigo,
    type: 'email',
  });
  if (error) {
    return { session: null, necesitaMfa: false, error: { message: MENSAJES.codigoInvalido } };
  }
  const session = data?.session ?? null;
  if (!isSessionUsable(session)) {
    return { session: null, necesitaMfa: false, error: { message: MENSAJES.codigoInvalido } };
  }
  return { session, necesitaMfa: necesitaSegundoPaso(nivelDesdeSesion(session)), error: null };
}

/**
 * Paso 3. Valida en el cliente con la misma regla del registro antes de
 * llamar al servidor, y traduce lo que el servidor conteste.
 */
export async function fijarNuevaPassword({ password, confirmacion }, authClient) {
  const regla = validarPassword(password);
  if (!regla.valid) return { error: { message: regla.message } };
  if (password !== confirmacion) return { error: { message: MENSAJES_RECUPERACION.passwordsDistintas } };

  const { error } = await authClient.updateUser({ password });
  if (error) {
    const codigo = error.code || error.error_code;
    if (codigo === 'same_password') return { error: { message: MENSAJES_RECUPERACION.mismaPassword } };
    if (codigo === 'insufficient_aal') return { error: { message: MENSAJES_RECUPERACION.faltaSegundoPaso } };
    if (codigo === 'session_not_found' || codigo === 'session_expired') {
      return { error: { message: MENSAJES_RECUPERACION.sinSesion } };
    }
    return { error: { message: describeAuthError(error) } };
  }

  // Las demás sesiones (otro teléfono, otra pestaña, o quien supiera la
  // contraseña vieja) se cierran. Si falla, la contraseña igual quedó
  // cambiada: no se le muestra un error por algo que ya está hecho.
  try {
    await authClient.signOut({ scope: 'others' });
  } catch {
    // sin efecto para quien recupera su cuenta
  }
  return { error: null };
}
