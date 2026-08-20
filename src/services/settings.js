import { supabase, isSupabaseConfigured } from './supabase';

export async function verifyPassword(email, password) {
  if (!isSupabaseConfigured) return { error: null };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: { message: 'Contraseña actual incorrecta' } };
  return { error: null };
}

export async function requestPasswordReset() {
  if (!isSupabaseConfigured) return { error: null, email: 'demo@example.com' };
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email;
  if (!email) {
    return { error: { message: 'No hay sesión activa con email registrado' }, email: null };
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) console.error('[FutFinder] requestPasswordReset:', error);
  return { error, email };
}

/**
 * Paso 1 de "cambiar email": envía un código de 6 dígitos al correo ACTUAL
 * (no al nuevo) para confirmar que quien pide el cambio sigue controlando
 * la cuenta. `shouldCreateUser: false` porque este correo ya es de un
 * usuario existente — nunca debe crear una cuenta nueva.
 *
 * Distinto del cambio de email en sí: `changeEmail()` más abajo sigue
 * enviando, además, la confirmación de Supabase al correo NUEVO — este
 * código no la reemplaza, se suma como resguardo adicional.
 */
export async function requestEmailChangeOtp(currentEmail) {
  if (!isSupabaseConfigured) return { error: null };
  const { error } = await supabase.auth.signInWithOtp({
    email: currentEmail,
    options: { shouldCreateUser: false },
  });
  if (error) console.error('[FutFinder] requestEmailChangeOtp:', error);
  return { error };
}

/** Paso 2: verifica el código de 6 dígitos enviado al correo actual. */
export async function verifyEmailChangeOtp({ currentEmail, token }) {
  if (!isSupabaseConfigured) return { error: null };
  const { data, error } = await supabase.auth.verifyOtp({
    email: currentEmail,
    token,
    type: 'email',
  });
  if (error) return { error: { message: 'Código incorrecto o vencido' } };
  return { session: data?.session ?? null, error: null };
}

/** Paso 3: recién aquí se pide el cambio al email nuevo. */
export async function changeEmail(newEmail) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { data, error } = await supabase.auth.updateUser({
    email: newEmail.trim().toLowerCase(),
  });
  if (error) console.error('[FutFinder] changeEmail:', error);
  return { data, error };
}

export async function changePassword(newPassword) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) console.error('[FutFinder] changePassword:', error);
  return { data, error };
}

export async function deleteAccount() {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase.rpc('delete_my_account');
  if (error) console.error('[FutFinder] deleteAccount:', error);
  return { error };
}

export async function getTrustScoreHistory(limit = 50) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data, error } = await supabase
    .from('trust_score_history')
    .select('id, change_amount, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) console.error('[FutFinder] getTrustScoreHistory:', error);
  return { data: data || [], error };
}
