/**
 * Política pura de la verificación en dos pasos (TOTP de Supabase Auth).
 *
 * Sin red ni React Native: las decisiones que importan —¿esta sesión todavía
 * debe presentar el código?, ¿qué se le dice a la persona cuando el servidor
 * rechaza algo?— viven acá para poder probarlas con `npm test`. Quien habla
 * con Supabase es `mfa.js`.
 *
 * VOCABULARIO. `aal1` es una sesión que entró con la contraseña; `aal2` es la
 * que además presentó el código de su app de autenticación. Supabase calcula
 * dos niveles: `currentLevel` (el de la sesión que se tiene) y `nextLevel` (el
 * que se PODRÍA tener: `aal2` si la persona activó la verificación). Si
 * `nextLevel` es `aal2` y `currentLevel` no, falta presentar el código.
 */

export const MFA_MENSAJES = {
  codigoIncorrecto:
    'El código no es correcto. Revisa que sea el último que muestra tu app de autenticación e inténtalo de nuevo.',
  codigoVencido: 'Ese código ya venció. Espera al siguiente en tu app de autenticación e inténtalo de nuevo.',
  demasiados: 'Hiciste demasiados intentos. Espera un momento antes de volver a probar.',
  sinConexion: 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.',
  noDisponible:
    'La verificación en dos pasos todavía no está disponible. Inténtalo más tarde.',
  inesperado: 'Algo salió mal con la verificación. Inténtalo de nuevo.',
  faltaConfiguracion: 'Falta configurar la conexión con el servidor.',
};

const POR_CODIGO = {
  mfa_verification_failed: MFA_MENSAJES.codigoIncorrecto,
  mfa_challenge_expired: MFA_MENSAJES.codigoVencido,
  over_request_rate_limit: MFA_MENSAJES.demasiados,
  mfa_verification_rejected: MFA_MENSAJES.demasiados,
  mfa_totp_enroll_not_enabled: MFA_MENSAJES.noDisponible,
  mfa_totp_verify_not_enabled: MFA_MENSAJES.noDisponible,
  mfa_factor_name_conflict: MFA_MENSAJES.inesperado,
};

const PARECE_DE_RED = /network|fetch|failed to fetch|timeout|offline/i;

/** Traduce un error de `supabase.auth.mfa.*` a un texto en español para la persona. */
export function describeMfaError(error) {
  if (!error) return null;
  const porCodigo = POR_CODIGO[error.code] || POR_CODIGO[error.error_code];
  if (porCodigo) return porCodigo;

  const texto = typeof error.message === 'string' ? error.message : '';
  if (/invalid totp code|invalid code|verification failed/i.test(texto)) return MFA_MENSAJES.codigoIncorrecto;
  if (/expired/i.test(texto)) return MFA_MENSAJES.codigoVencido;
  if (/rate limit|too many/i.test(texto) || error.status === 429) return MFA_MENSAJES.demasiados;
  if (error.name === 'AuthRetryableFetchError' || PARECE_DE_RED.test(texto)) return MFA_MENSAJES.sinConexion;
  return MFA_MENSAJES.inesperado;
}

/**
 * ¿Esta sesión todavía tiene que presentar el código? `nivel` es lo que
 * devuelve `getAuthenticatorAssuranceLevel()`. Sin dato, no: es mejor no
 * bloquear a alguien por una lectura fallida que dejarlo fuera de su cuenta
 * (el servidor es quien exige `aal2` donde importa, ver migración 167).
 */
export function necesitaSegundoPaso(nivel) {
  if (!nivel || typeof nivel !== 'object') return false;
  return nivel.nextLevel === 'aal2' && nivel.currentLevel !== 'aal2';
}

/** Deja sólo los dígitos, hasta seis: lo que sale de pegar «123 456» o «123-456». */
export function normalizarCodigo(texto) {
  return String(texto ?? '').replace(/\D/g, '').slice(0, 6);
}

export function codigoCompleto(texto) {
  return /^\d{6}$/.test(String(texto ?? ''));
}

/** Los factores TOTP que ya quedaron verificados (los demás son altas a medias). */
export function factoresVerificados(factores) {
  if (!Array.isArray(factores)) return [];
  return factores.filter((f) => f && f.status === 'verified' && (f.factor_type || 'totp') === 'totp');
}

/** La clave en grupos de cuatro, para leerla y copiarla sin equivocarse: «ABCD EFGH …». */
export function claveEnGrupos(secreto) {
  return String(secreto ?? '')
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

/** El SVG del código QR viene como data URI; `SvgXml` pide el XML pelado. */
export function xmlDelQr(dataUri) {
  const texto = String(dataUri ?? '');
  const m = texto.match(/^data:image\/svg\+xml;(?:utf-8|charset=utf-8)?,?(.*)$/is);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (_) {
    return m[1];
  }
}

function decodificarPayload(token) {
  try {
    const parte = String(token || '').split('.')[1];
    if (!parte) return null;
    const b64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    const relleno = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(globalThis.atob(relleno));
  } catch (_) {
    return null;
  }
}

/**
 * `{ currentLevel, nextLevel }` calculado SOLO con la sesión, sin llamar a
 * Supabase. Es lo que hace `getAuthenticatorAssuranceLevel()` por dentro, y se
 * repite acá a propósito: `AuthContext` lo necesita de forma síncrona, en el
 * mismo render en que llega la sesión, y llamar a `supabase.auth` desde el
 * callback de `onAuthStateChange` puede dejar el cliente esperando un cerrojo
 * que ese mismo callback tiene tomado.
 *
 * Devuelve `null` si el token no se puede leer (y entonces no se bloquea a
 * nadie: lo exigido de verdad lo impone el servidor).
 */
export function nivelDesdeSesion(session) {
  if (!session || !session.access_token) return null;
  const payload = decodificarPayload(session.access_token);
  if (!payload) return null;
  const currentLevel = payload.aal === 'aal2' ? 'aal2' : 'aal1';
  const nextLevel = factoresVerificados(session.user?.factors).length > 0 ? 'aal2' : currentLevel;
  return { currentLevel, nextLevel };
}
