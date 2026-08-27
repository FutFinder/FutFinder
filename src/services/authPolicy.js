/**
 * Política de autenticación de FutFinder.
 *
 * Módulo puro: no importa React Native ni el cliente de Supabase, así que
 * `npm test` lo puede ejecutar en Node y el cliente de auth se inyecta. Acá
 * vive la única decisión que importa —¿esta persona tiene sesión válida?— y
 * la traducción de los errores del proveedor a mensajes en español.
 *
 * Regla que este módulo existe para sostener: el login SOLO inicia sesión.
 * Nunca registra. Antes, un login fallido caía a `signUp` y, como el
 * proyecto tiene la confirmación de correo desactivada, Supabase autoconfirma
 * y devuelve sesión al instante: cualquier correo inventado entraba a la app
 * creando una cuenta real de paso. Registrarse es un acto explícito y
 * separado (`performSignUp`).
 *
 * La verificación de credenciales la hace Supabase Auth contra su tabla de
 * usuarios; acá jamás se compara una contraseña.
 */

/** Mínimo que exigimos al crear una cuenta. Supabase también valida su propio mínimo. */
export const MIN_PASSWORD_SIGNUP = 8;

export const MENSAJES = {
  correoRequerido: 'Ingresa tu correo electrónico',
  correoInvalido: 'Revisa tu correo: parece que está mal escrito',
  passwordRequerida: 'Ingresa tu contraseña',
  credencialesInvalidas: 'Correo o contraseña incorrectos',
  correoSinConfirmar:
    'Todavía no confirmas tu correo. Te enviamos un código para activar tu cuenta.',
  yaRegistrado: 'Ya existe una cuenta con este correo. Inicia sesión.',
  passwordDebil: `Tu contraseña es muy débil: usa al menos ${MIN_PASSWORD_SIGNUP} caracteres.`,
  demasiadosIntentos: 'Demasiados intentos. Espera un momento y vuelve a intentar.',
  sinConexion: 'Sin conexión. Revisa tu internet e intenta de nuevo.',
  inesperado: 'No pudimos completar la operación. Intenta de nuevo.',
  faltaConfiguracion:
    'La app no está conectada a su servidor. Avisa al equipo de FutFinder.',
};

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Errores del proveedor → mensaje nuestro. Nunca se muestra el texto crudo. */
const POR_CODIGO = {
  invalid_credentials: MENSAJES.credencialesInvalidas,
  invalid_grant: MENSAJES.credencialesInvalidas,
  user_not_found: MENSAJES.credencialesInvalidas,
  email_not_confirmed: MENSAJES.correoSinConfirmar,
  user_already_exists: MENSAJES.yaRegistrado,
  email_exists: MENSAJES.yaRegistrado,
  weak_password: MENSAJES.passwordDebil,
  over_request_rate_limit: MENSAJES.demasiadosIntentos,
  over_email_send_rate_limit: MENSAJES.demasiadosIntentos,
  too_many_requests: MENSAJES.demasiadosIntentos,
};

const PARECE_DE_RED = /network|fetch|load failed|timeout|econn|offline/i;

export function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function isValidEmail(email) {
  return CORREO_VALIDO.test(normalizeEmail(email));
}

/**
 * Valida lo que se escribió antes de gastar una llamada al proveedor.
 * En `signup` exigimos una contraseña mínima; en `login` no, porque el largo
 * de una contraseña vieja no es asunto nuestro: quien decide es el servidor.
 */
export function validateCredentials({ email, password, mode = 'login' } = {}) {
  const correo = normalizeEmail(email);
  if (!correo) return { valid: false, message: MENSAJES.correoRequerido, field: 'email' };
  if (!isValidEmail(correo)) return { valid: false, message: MENSAJES.correoInvalido, field: 'email' };

  const clave = typeof password === 'string' ? password : '';
  if (!clave) return { valid: false, message: MENSAJES.passwordRequerida, field: 'password' };
  if (mode === 'signup' && clave.length < MIN_PASSWORD_SIGNUP) {
    return { valid: false, message: MENSAJES.passwordDebil, field: 'password' };
  }
  return { valid: true, email: correo, password: clave };
}

/**
 * Traduce un error de Supabase Auth. Devuelve siempre un texto propio: el
 * mensaje del proveedor puede traer detalles que no queremos mostrar, y
 * "usuario no existe" se responde igual que "contraseña incorrecta" para no
 * permitir averiguar qué correos están registrados.
 */
export function describeAuthError(error) {
  if (!error) return null;
  const porCodigo = POR_CODIGO[error.code];
  if (porCodigo) return porCodigo;

  const texto = typeof error.message === 'string' ? error.message : '';
  if (/invalid login credentials/i.test(texto)) return MENSAJES.credencialesInvalidas;
  if (/email not confirmed/i.test(texto)) return MENSAJES.correoSinConfirmar;
  if (/already registered/i.test(texto)) return MENSAJES.yaRegistrado;
  if (error.name === 'AuthRetryableFetchError' || PARECE_DE_RED.test(texto)) {
    return MENSAJES.sinConexion;
  }
  return MENSAJES.inesperado;
}

/** Un usuario cuenta como verificado solo si el proveedor marcó la fecha. */
export function isEmailConfirmed(user) {
  return Boolean(user && (user.email_confirmed_at || user.confirmed_at));
}

/**
 * Sesión de verdad: objeto con token de acceso y usuario. Un objeto a medias
 * (o `true`, o un string) no es sesión. Sin esto, cualquier valor "truthy"
 * abría las rutas privadas.
 */
export function hasActiveSession(session) {
  if (!session || typeof session !== 'object') return false;
  const { access_token: token, user } = session;
  return typeof token === 'string' && token.length > 0 && Boolean(user && user.id);
}

/** Sesión que además puede usarse para entrar: existe y tiene correo verificado. */
export function isSessionUsable(session) {
  return hasActiveSession(session) && isEmailConfirmed(session.user);
}

/**
 * Único lugar que decide a dónde va alguien. El default es `login`: cualquier
 * estado que no sea una sesión usable termina fuera de la app.
 */
export function decideAuthDestination({ session, onboardingDone } = {}) {
  if (!hasActiveSession(session)) return 'login';
  if (!isEmailConfirmed(session.user)) return 'verify-email';
  return onboardingDone === true ? 'main' : 'onboarding';
}

/**
 * Inicia sesión contra el proveedor. No registra en ningún caso.
 *
 * @param authClient objeto con `signInWithPassword` (en la app, `supabase.auth`)
 * @returns {{ user, session, error, needsVerification, email }}
 */
export async function performLogin({ email, password } = {}, authClient) {
  const check = validateCredentials({ email, password, mode: 'login' });
  if (!check.valid) {
    return { user: null, session: null, error: { message: check.message, field: check.field }, needsVerification: false };
  }

  const { data, error } = await authClient.signInWithPassword({
    email: check.email,
    password: check.password,
  });

  if (error) {
    const esSinConfirmar =
      error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message || '');
    return {
      user: null,
      session: null,
      error: { message: describeAuthError(error) },
      needsVerification: esSinConfirmar,
      email: check.email,
    };
  }

  const session = data?.session ?? null;
  if (!hasActiveSession(session)) {
    // Sin sesión no se entra, por más que el proveedor no haya dado error.
    return {
      user: null,
      session: null,
      error: { message: MENSAJES.inesperado },
      needsVerification: false,
      email: check.email,
    };
  }

  if (!isEmailConfirmed(session.user)) {
    return {
      user: session.user,
      session,
      error: null,
      needsVerification: true,
      email: check.email,
    };
  }

  return { user: data?.user ?? session.user, session, error: null, needsVerification: false, email: check.email };
}

/**
 * Crea una cuenta. Acto explícito: solo se llama desde el modo "registrarse".
 *
 * Cuando la confirmación de correo está activada, Supabase responde a un
 * correo ya registrado con un usuario sin `identities` y sin sesión —
 * idéntico a un registro nuevo— justamente para que no se pueda averiguar
 * quién tiene cuenta. Respetamos eso: ese caso sigue el mismo camino que un
 * registro nuevo, pidiendo el código.
 */
export async function performSignUp({ email, password, username } = {}, authClient) {
  const check = validateCredentials({ email, password, mode: 'signup' });
  if (!check.valid) {
    return { user: null, session: null, error: { message: check.message, field: check.field }, needsVerification: false };
  }

  const { data, error } = await authClient.signUp({
    email: check.email,
    password: check.password,
    options: { data: { username: username || check.email.split('@')[0] } },
  });

  if (error) {
    return {
      user: null,
      session: null,
      error: { message: describeAuthError(error) },
      needsVerification: false,
      email: check.email,
    };
  }

  const session = data?.session ?? null;
  if (isSessionUsable(session)) {
    return { user: session.user, session, error: null, needsVerification: false, email: check.email };
  }

  return {
    user: data?.user ?? null,
    session: null,
    error: null,
    needsVerification: true,
    email: check.email,
  };
}
