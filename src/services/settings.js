import { supabase, isSupabaseConfigured } from './supabase';

export async function verifyPassword(email, password) {
  if (!isSupabaseConfigured) return { error: null };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: { message: 'Contraseña actual incorrecta' } };
  return { error: null };
}

export async function requestPasswordReset(email) {
  if (!isSupabaseConfigured) return { error: null };
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) console.error('[FutFinder] requestPasswordReset:', error);
  return { error };
}

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
