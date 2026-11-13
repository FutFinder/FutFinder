import { supabase, isSupabaseConfigured, crearClienteEfimero } from './supabase';

export async function verifyPassword(email, password) {
  if (!isSupabaseConfigured) return { error: null };
  // Con un cliente aparte: `signInWithPassword` reemplaza la sesión, y para
  // quien tiene la verificación en dos pasos eso la deja en `aal1` (fuera de
  // su cuenta). Ver `crearClienteEfimero`.
  const { error } = await crearClienteEfimero().auth.signInWithPassword({ email, password });
  if (error) return { error: { message: 'Contraseña actual incorrecta' } };
  return { error: null };
}

/**
 * El correo de la sesión, para abrir «Recuperar contraseña» desde Ajustes ya
 * escrito. (Antes esto mandaba un enlace de recuperación que la app no sabía
 * recibir; ahora el flujo es el mismo de Iniciar sesión, con código.)
 */
export async function correoDeLaSesion() {
  if (!isSupabaseConfigured) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.email ?? null;
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

const NO_SE_PUDO_BORRAR = 'No pudimos borrar tu cuenta. Intenta de nuevo en un rato.';

/**
 * Lo que la base contesta cuando no deja borrar (saldo a favor, reservas
 * pagadas por jugar, única admin de un recinto) son textos propios, con
 * RAISE (código P0001, migración 176): se muestran tal cual. Cualquier otro
 * error es interno y no se muestra crudo.
 */
export function mensajeDeBorrado(error) {
  if (error?.code === 'P0001' && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return NO_SE_PUDO_BORRAR;
}

/**
 * Borra la cuenta por la Edge Function `eliminar-cuenta`: la base primero
 * (`delete_my_account`, migración 176) y, si salió bien, las fotos de la
 * persona en Storage, que SQL no puede borrar.
 *
 * Si la función todavía no está desplegada (404), se llama la RPC directo:
 * los datos se borran igual y los archivos quedan en `cuentas_por_limpiar`
 * hasta la primera pasada de la función.
 */
export async function deleteAccount() {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };

  const { data, error } = await supabase.functions.invoke('eliminar-cuenta', { method: 'POST', body: {} });
  if (!error) {
    return data?.ok ? { error: null } : { error: { message: data?.reason || NO_SE_PUDO_BORRAR } };
  }

  if (error?.context?.status === 404) {
    const { error: eRpc } = await supabase.rpc('delete_my_account');
    if (eRpc) console.error('[FutFinder] deleteAccount:', eRpc.code);
    return { error: eRpc ? { message: mensajeDeBorrado(eRpc) } : null };
  }

  // 409 (la base no deja) o 500: la función manda el motivo en el cuerpo.
  let motivo = null;
  try {
    motivo = (await error.context.json())?.reason || null;
  } catch {
    // sin cuerpo legible: red caída o respuesta que no es JSON
  }
  console.error('[FutFinder] deleteAccount:', error?.context?.status ?? error?.name);
  return { error: { message: motivo || NO_SE_PUDO_BORRAR } };
}

/**
 * El historial antiguo de Trust Score, por páginas.
 *
 * Aquí `id` es un uuid, no una secuencia, así que la clave de paginación es
 * `created_at`. Y va con `lte`, no con `lt`: dos movimientos del mismo
 * segundo caen en el mismo valor, y con `lt` el segundo se perdía al cruzar
 * el borde de la página. Repetir el empate es barato; perder una fila del
 * historial, no. Quien llama fusiona por `id` y las repetidas se descartan.
 *
 * @param {number} limit filas por página
 * @param {{ antesDe?: string|null }} opciones `created_at` de la última fila
 * @returns {{ data: object[], error: object|null, hayMas: boolean }}
 */
export async function getTrustScoreHistory(limit = 50, { antesDe = null } = {}) {
  if (!isSupabaseConfigured) return { data: [], error: null, hayMas: false };
  let q = supabase
    .from('trust_score_history')
    .select('id, change_amount, reason, created_at');
  if (antesDe) q = q.lte('created_at', antesDe);
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) console.error('[FutFinder] getTrustScoreHistory:', error);
  const filas = data || [];
  return { data: filas, error, hayMas: !error && filas.length === limit };
}
