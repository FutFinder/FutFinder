/**
 * Servicio de autenticación.
 * Por ahora es un placeholder. Cuando integremos Supabase (Fase 2),
 * aquí pondremos las llamadas reales a supabase.auth.signInWithPassword,
 * signUp, signInWithOAuth, etc.
 */

export async function signInWithEmail({ email, password }) {
  // TODO: integrar con Supabase
  await new Promise((r) => setTimeout(r, 400));
  return { user: { email }, error: null };
}

export async function signUpWithEmail({ email, password }) {
  // TODO: integrar con Supabase
  await new Promise((r) => setTimeout(r, 400));
  return { user: { email }, error: null };
}

export async function signOut() {
  // TODO: integrar con Supabase
  return { error: null };
}
