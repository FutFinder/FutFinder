import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Servicio de autenticación de FutFinder.
 *
 * El trigger `handle_new_user` de la base de datos (ver supabase/schema.sql)
 * crea automáticamente un row en `profiles` cada vez que alguien se registra,
 * con username derivado del email y trust_score inicial de 100.
 */

export async function signInWithEmail({ email, password }) {
  if (!isSupabaseConfigured) {
    return { user: { email }, error: null, demo: true };
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

export async function signUpWithEmail({ email, password, username }) {
  if (!isSupabaseConfigured) {
    return { user: { email }, error: null, demo: true };
  }
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: { username: username || email.split('@')[0] },
    },
  });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

/**
 * Login inteligente:
 *  - Intenta signIn con la contraseña.
 *  - Si el usuario no existe → hace signUp con esa misma contraseña.
 *  - Devuelve { user, session, isNewUser, error }.
 */
export async function signInOrUp({ email, password }) {
  if (!isSupabaseConfigured) {
    return { user: { email }, session: null, isNewUser: false, error: null, demo: true };
  }
  const signIn = await signInWithEmail({ email, password });
  if (signIn.user && !signIn.error) {
    return { ...signIn, isNewUser: false };
  }
  // Credenciales inválidas o usuario no existe → probamos signUp
  const signUp = await signUpWithEmail({ email, password });
  return { ...signUp, isNewUser: true };
}

/**
 * Verifica el código OTP enviado por email (6 dígitos).
 * Requiere que en Supabase Dashboard → Auth → Email Templates
 * el template "Confirm signup" use {{ .Token }} en vez de link.
 */
export async function verifyEmailOtp({ email, token }) {
  if (!isSupabaseConfigured) return { error: null, demo: true };
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token,
    type: 'email',
  });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

export async function resendOtp({ email }) {
  if (!isSupabaseConfigured) return { error: null, demo: true };
  const { error } = await supabase.auth.resend({
    email: email.trim().toLowerCase(),
    type: 'signup',
  });
  return { error };
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
