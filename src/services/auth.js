import { supabase, isSupabaseConfigured } from './supabase';
import { performLogin, performSignUp, describeAuthError, MENSAJES } from './authPolicy';
import {
  guardarPasswordPendiente,
  consumirPasswordPendiente,
  olvidarPasswordPendiente,
} from './pendingSignUp';

/**
 * Servicio de autenticación de FutFinder.
 *
 * Solo conecta el cliente real de Supabase Auth con la política pura de
 * `authPolicy.js`. Supabase verifica las credenciales contra su tabla de
 * usuarios: acá no se comparan contraseñas ni se fabrican sesiones.
 *
 * Sin configuración (faltan las variables de entorno) estas funciones fallan
 * con un mensaje claro. Antes devolvían un usuario inventado y, junto con el
 * `isAuthenticated` del contexto, eso dejaba la app entera abierta a
 * cualquiera en un build sin `.env`.
 *
 * El trigger `handle_new_user` de la base de datos (ver supabase/schema.sql)
 * crea automáticamente un row en `profiles` cada vez que alguien se registra,
 * con username derivado del email y trust_score inicial de 100.
 */

function faltaConfiguracion() {
  return {
    user: null,
    session: null,
    error: { message: MENSAJES.faltaConfiguracion },
    needsVerification: false,
  };
}

/**
 * Inicia sesión con correo y contraseña.
 *
 * NUNCA crea una cuenta. Si las credenciales no coinciden con un usuario
 * real, devuelve error. Registrarse es un acto aparte: `registerWithEmail`.
 */
export async function loginWithEmail({ email, password }) {
  if (!isSupabaseConfigured) return faltaConfiguracion();
  return performLogin({ email, password }, supabase.auth);
}

/**
 * Empieza un registro: manda un código de 6 dígitos al correo y NO deja
 * ninguna cuenta usable hasta que ese código se verifique. Un correo
 * inventado no recibe nada, así que no puede entrar ni registrándose ni
 * después iniciando sesión.
 *
 * La contraseña queda en memoria (nunca en disco ni en la navegación) para
 * fijarla al verificar, en `completeSignUpPassword`.
 */
export async function registerWithEmail({ email, password, username }) {
  if (!isSupabaseConfigured) return faltaConfiguracion();
  const result = await performSignUp({ email, password, username }, supabase.auth);
  if (!result.error) {
    guardarPasswordPendiente(result.email, password);
  } else {
    olvidarPasswordPendiente();
  }
  return result;
}

/**
 * Fija la contraseña del registro, ya con la sesión que emitió `verifyOtp`.
 * Se llama una sola vez y solo si ese correo tenía un registro en curso.
 *
 * @returns {{ error: {message: string}|null, applied: boolean }}
 */
export async function completeSignUpPassword({ email }) {
  const password = consumirPasswordPendiente(email);
  if (!password) return { error: null, applied: false };
  if (!isSupabaseConfigured) return { error: { message: MENSAJES.faltaConfiguracion }, applied: false };

  const { error } = await supabase.auth.updateUser({ password });
  return { error: error ? { message: describeAuthError(error) } : null, applied: !error };
}

/** Descarta un registro a medias (por ejemplo, al salir de la verificación). */
export function abandonSignUp() {
  olvidarPasswordPendiente();
}

/**
 * Verifica el código OTP enviado por email (6 dígitos).
 * Requiere que en Supabase Dashboard → Auth → Email Templates
 * el template "Confirm signup" use {{ .Token }} en vez de link.
 */
export async function verifyEmailOtp({ email, token }) {
  if (!isSupabaseConfigured) return faltaConfiguracion();
  const { data, error } = await supabase.auth.verifyOtp({
    email: String(email || '').trim().toLowerCase(),
    token,
    type: 'email',
  });
  return {
    user: data?.user ?? null,
    session: data?.session ?? null,
    error: error ? { message: describeAuthError(error) } : null,
  };
}

/**
 * Reenvía el código. Va por `signInWithOtp` (no por `resend({type:'signup'})`)
 * porque el registro ahora se inicia con OTP: `resend` de tipo signup no
 * aplica a una cuenta creada así y respondía con error.
 *
 * `shouldCreateUser: false` para que reenviar no cree cuentas por su cuenta.
 */
export async function resendOtp({ email }) {
  if (!isSupabaseConfigured) return { error: { message: MENSAJES.faltaConfiguracion } };
  const { error } = await supabase.auth.signInWithOtp({
    email: String(email || '').trim().toLowerCase(),
    options: { shouldCreateUser: false },
  });
  return { error: error ? { message: describeAuthError(error) } : null };
}

export async function signOut() {
  if (!isSupabaseConfigured) return { error: null };
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function getCurrentUser() {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

export async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (error) return null;
  return data;
}

export function onAuthChange(callback) {
  if (!isSupabaseConfigured) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}
