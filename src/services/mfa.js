import { supabase, isSupabaseConfigured } from './supabase';
import { MFA_MENSAJES, describeMfaError, factoresVerificados } from './mfaPolicy';

/**
 * Verificación en dos pasos (TOTP) con Supabase Auth.
 *
 * Todo lo que pasa por acá es opcional para la gente común y obligatorio sólo
 * para el personal cuando se encienda la bandera `mfa_obligatoria_staff`
 * (migración 167). La política pura vive en `mfaPolicy.js`.
 *
 * NO HAY CÓDIGOS DE RECUPERACIÓN: Supabase no los trae. Quien pierda su app de
 * autenticación tiene que pedir que el equipo le quite el factor desde el
 * panel (`auth.mfa_factors`). La pantalla de activación lo dice antes de que
 * la persona lo necesite.
 */

function sinConfiguracion() {
  return { data: null, error: { message: MFA_MENSAJES.faltaConfiguracion } };
}

const aError = (error) => (error ? { message: describeMfaError(error) } : null);

/** `{ currentLevel, nextLevel }` de la sesión actual. Se lee del token: no sale a la red. */
export async function nivelDeAutenticacion() {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { data: data ?? null, error: aError(error) };
}

/** Los factores TOTP verificados de la persona: `{ data: [{ id, friendly_name }], error }`. */
export async function misFactoresTotp() {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { data: [], error: aError(error) };
  return { data: factoresVerificados(data?.all ?? data?.totp ?? []), error: null };
}

/**
 * Empieza la activación: devuelve el QR, la clave para teclearla a mano y el
 * enlace `otpauth://` (en el teléfono, abre la app de autenticación).
 *
 * Primero borra las activaciones que quedaron a medias: Supabase no deja crear
 * un segundo factor con el mismo nombre, y una persona que cerró la pantalla
 * a la mitad se quedaría sin poder volver a empezar.
 */
export async function iniciarActivacion() {
  if (!isSupabaseConfigured) return sinConfiguracion();

  const { data: lista } = await supabase.auth.mfa.listFactors();
  const aMedias = (lista?.all ?? []).filter((f) => f.status !== 'verified');
  for (const f of aMedias) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'FutFinder',
    friendlyName: `FutFinder ${Date.now().toString(36)}`,
  });
  if (error) return { data: null, error: aError(error) };
  return {
    data: {
      factorId: data.id,
      qr: data.totp?.qr_code ?? null,
      secreto: data.totp?.secret ?? null,
      uri: data.totp?.uri ?? null,
    },
    error: null,
  };
}

/** Pide un desafío y lo responde con el código de seis dígitos. Sube la sesión a `aal2`. */
export async function verificarCodigo({ factorId, codigo }) {
  if (!isSupabaseConfigured) return sinConfiguracion();
  const { data: desafio, error: eDesafio } = await supabase.auth.mfa.challenge({ factorId });
  if (eDesafio) return { data: null, error: aError(eDesafio) };
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: desafio.id,
    code: codigo,
  });
  return { data: data ?? null, error: aError(error) };
}

/** Confirma la activación con el primer código. Es el mismo trámite que verificar uno. */
export const confirmarActivacion = verificarCodigo;

/**
 * Verifica el código de ENTRADA contra el primer factor verificado. Es lo que
 * llama la pantalla de inicio de sesión: la persona sólo escribe seis dígitos.
 */
export async function verificarCodigoDeEntrada({ codigo }) {
  const { data: factores, error } = await misFactoresTotp();
  if (error) return { data: null, error };
  if (!factores.length) {
    return { data: null, error: { message: MFA_MENSAJES.inesperado } };
  }
  return verificarCodigo({ factorId: factores[0].id, codigo });
}

/** Desactiva el factor. Supabase exige que la sesión ya sea `aal2`. */
export async function desactivar(factorId) {
  if (!isSupabaseConfigured) return sinConfiguracion();
  const { data, error } = await supabase.auth.mfa.unenroll({ factorId });
  return { data: data ?? null, error: aError(error) };
}

/**
 * Lo que el servidor dice del personal (migración 167): `{ es_staff, requerida,
 * cumple, nivel }`. Si la RPC todavía no existe, nada se exige.
 */
export async function miRequisitoMfa() {
  const base = { es_staff: false, requerida: false, cumple: true, nivel: null };
  if (!isSupabaseConfigured) return { data: base, error: null };
  const { data, error } = await supabase.rpc('mi_requisito_mfa');
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return { data: base, error: null };
    return { data: base, error: { message: MFA_MENSAJES.inesperado } };
  }
  return { data: { ...base, ...(data || {}) }, error: null };
}
