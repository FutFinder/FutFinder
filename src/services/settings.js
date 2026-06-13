import { supabase, isSupabaseConfigured } from './supabase';

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
