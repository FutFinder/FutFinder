/**
 * Pruebas de la política de autenticación.
 *
 * La razón de que este archivo exista: `signInOrUp()` convertía un login
 * fallido en un registro. Con la confirmación de correo desactivada en el
 * proyecto, `signUp` autoconfirma y devuelve sesión al instante, así que
 * cualquier correo inventado con cualquier contraseña entraba a la app.
 * Estas pruebas fijan el comportamiento correcto: el login solo inicia
 * sesión, jamás crea cuentas, y sin sesión válida nadie entra.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeEmail,
  validateCredentials,
  describeAuthError,
  hasActiveSession,
  decideAuthDestination,
  performLogin,
  performSignUp,
  MENSAJES,
} = require('../authPolicy.js');

/**
 * Cliente de auth falso que registra qué métodos se llamaron. Reemplaza a
 * `supabase.auth` sin tocar la red ni React Native.
 */
function fakeAuthClient({ signIn, signUp, otp } = {}) {
  const calls = [];
  return {
    calls,
    async signInWithPassword(args) {
      calls.push({ method: 'signInWithPassword', args });
      return signIn ?? { data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } };
    },
    async signUp(args) {
      calls.push({ method: 'signUp', args });
      return signUp ?? { data: { user: null, session: null }, error: null };
    },
    async signInWithOtp(args) {
      calls.push({ method: 'signInWithOtp', args });
      return otp ?? { data: {}, error: null };
    },
  };
}

const SESION_VALIDA = {
  access_token: 'token-de-prueba',
  user: { id: 'uuid-1', email: 'jugador@futfinder.cl', email_confirmed_at: '2026-08-01T00:00:00Z' },
};

// --- El fallo reportado: entrar con credenciales inventadas ---------------

test('un correo inexistente no inicia sesión y NUNCA crea una cuenta', async () => {
  const client = fakeAuthClient();
  const res = await performLogin({ email: 'inventado@nadie.cl', password: 'cualquiera123' }, client);

  assert.equal(res.session, null, 'no debe devolver sesión');
  assert.ok(res.error, 'debe devolver error');
  const metodos = client.calls.map((c) => c.method);
  assert.deepEqual(metodos, ['signInWithPassword'], 'el login solo intenta iniciar sesión');
  assert.ok(!metodos.includes('signUp'), 'el login jamás debe registrar al usuario');
});

test('una contraseña incorrecta no inicia sesión y NUNCA crea una cuenta', async () => {
  const client = fakeAuthClient({
    signIn: { data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } },
  });
  const res = await performLogin({ email: 'jugador@futfinder.cl', password: 'contrasena-mala' }, client);

  assert.equal(res.session, null);
  assert.ok(res.error);
  assert.ok(!client.calls.some((c) => c.method === 'signUp'), 'no debe caer a signUp');
});

test('una cuenta válida y verificada sí inicia sesión', async () => {
  const client = fakeAuthClient({
    signIn: { data: { user: SESION_VALIDA.user, session: SESION_VALIDA }, error: null },
  });
  const res = await performLogin({ email: 'jugador@futfinder.cl', password: 'contrasena-buena' }, client);

  assert.equal(res.error, null);
  assert.ok(res.session, 'debe devolver la sesión real');
  assert.equal(res.needsVerification, false);
});

test('los campos vacíos no se envían al proveedor', async () => {
  for (const credenciales of [
    { email: '', password: 'contrasena123' },
    { email: '   ', password: 'contrasena123' },
    { email: 'jugador@futfinder.cl', password: '' },
    { email: '', password: '' },
  ]) {
    const client = fakeAuthClient();
    const res = await performLogin(credenciales, client);
    assert.equal(client.calls.length, 0, `no debe llamar al proveedor con ${JSON.stringify(credenciales)}`);
    assert.ok(res.error, 'debe avisar del campo faltante');
    assert.equal(res.session, null);
  }
});

test('un correo con formato inválido no se envía al proveedor', async () => {
  const client = fakeAuthClient();
  const res = await performLogin({ email: 'no-es-un-correo', password: 'contrasena123' }, client);
  assert.equal(client.calls.length, 0);
  assert.ok(res.error);
});

test('el correo se normaliza antes de llegar al proveedor', async () => {
  const client = fakeAuthClient({
    signIn: { data: { user: SESION_VALIDA.user, session: SESION_VALIDA }, error: null },
  });
  await performLogin({ email: '  JuGaDoR@FutFinder.CL  ', password: 'contrasena-buena' }, client);
  assert.equal(client.calls[0].args.email, 'jugador@futfinder.cl');
});

// --- Cuenta sin verificar -------------------------------------------------

test('una sesión de una cuenta sin correo verificado no entra: pide verificación', async () => {
  const usuarioSinVerificar = { id: 'uuid-2', email: 'nuevo@futfinder.cl', email_confirmed_at: null };
  const client = fakeAuthClient({
    signIn: { data: { user: usuarioSinVerificar, session: { access_token: 't', user: usuarioSinVerificar } }, error: null },
  });
  const res = await performLogin({ email: 'nuevo@futfinder.cl', password: 'contrasena123' }, client);

  assert.equal(res.needsVerification, true);
  assert.equal(res.email, 'nuevo@futfinder.cl');
});

test('el error de correo no confirmado del proveedor se traduce a pedir verificación', async () => {
  const client = fakeAuthClient({
    signIn: { data: { user: null, session: null }, error: { code: 'email_not_confirmed', message: 'Email not confirmed' } },
  });
  const res = await performLogin({ email: 'nuevo@futfinder.cl', password: 'contrasena123' }, client);
  assert.equal(res.needsVerification, true);
});

// --- Registro: el correo tiene que existir de verdad ---------------------

test('el registro con contraseña débil no llega al proveedor', async () => {
  const client = fakeAuthClient();
  const res = await performSignUp({ email: 'nuevo@futfinder.cl', password: '123' }, client);
  assert.equal(client.calls.length, 0);
  assert.equal(res.error.message, MENSAJES.passwordDebil);
});

test('el registro pide un código por correo (signInWithOtp), NO crea una cuenta con contraseña usable', async () => {
  const client = fakeAuthClient({ otp: { data: {}, error: null } });
  await performSignUp({ email: 'nuevo@futfinder.cl', password: 'contrasena123' }, client);

  const metodos = client.calls.map((c) => c.method);
  assert.deepEqual(metodos, ['signInWithOtp'], 'el registro solo manda el código');
  assert.ok(!metodos.includes('signUp'), 'signUp dejaría una cuenta que sirve para iniciar sesión sin verificar');
  assert.equal(client.calls[0].args.options.shouldCreateUser, true);
});

test('el registro NUNCA devuelve sesión: sin el código del correo no se entra', async () => {
  const client = fakeAuthClient({ otp: { data: {}, error: null } });
  const res = await performSignUp({ email: 'nuevo@futfinder.cl', password: 'contrasena123' }, client);
  assert.equal(res.session, null, 'no puede haber sesión antes de verificar');
  assert.equal(res.needsVerification, true);
  assert.equal(res.email, 'nuevo@futfinder.cl');
});

test('un correo de un dominio que no existe se rechaza con un mensaje claro', async () => {
  const client = fakeAuthClient({
    otp: { data: {}, error: { code: 'email_address_invalid', message: 'Email address "x@y.cl" is invalid' } },
  });
  const res = await performSignUp({ email: 'jugador@dominio-inventado.cl', password: 'contrasena123' }, client);
  assert.equal(res.error.message, MENSAJES.correoNoRecibeMensajes);
  assert.equal(res.session, null);
  assert.equal(res.needsVerification, false);
});

test('registrar un correo que ya existe no revela que existe: pide el código igual', async () => {
  // signInWithOtp responde lo mismo exista o no la cuenta; no hay nada que filtrar.
  const client = fakeAuthClient({ otp: { data: {}, error: null } });
  const res = await performSignUp({ email: 'jugador@futfinder.cl', password: 'contrasena123' }, client);
  assert.equal(res.error, null);
  assert.equal(res.needsVerification, true);
});

test('si el trigger de la base de datos falla, el mensaje es comprensible y no un 500 crudo', async () => {
  const client = fakeAuthClient({
    otp: { data: {}, error: { code: 'unexpected_failure', message: 'Database error saving new user' } },
  });
  const res = await performSignUp({ email: 'nuevo@futfinder.cl', password: 'contrasena123' }, client);
  assert.equal(res.error.message, MENSAJES.inesperado);
  assert.ok(!/Database error/i.test(res.error.message), 'no se muestra el error crudo del servidor');
});

test('demasiados envíos de código dan el mensaje de esperar, no un error genérico', async () => {
  const client = fakeAuthClient({
    otp: { data: {}, error: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } },
  });
  const res = await performSignUp({ email: 'nuevo@futfinder.cl', password: 'contrasena123' }, client);
  assert.equal(res.error.message, MENSAJES.demasiadosIntentos);
});

// --- Sesión: nadie entra sin una de verdad -------------------------------

test('hasActiveSession: solo una sesión con token y usuario cuenta como sesión', () => {
  assert.equal(hasActiveSession(SESION_VALIDA), true);
  assert.equal(hasActiveSession(null), false);
  assert.equal(hasActiveSession(undefined), false);
  assert.equal(hasActiveSession({}), false);
  assert.equal(hasActiveSession({ user: { id: 'x' } }), false, 'sin access_token no es sesión');
  assert.equal(hasActiveSession({ access_token: 't' }), false, 'sin usuario no es sesión');
  assert.equal(hasActiveSession('si'), false);
  assert.equal(hasActiveSession(true), false);
});

test('decideAuthDestination: sin sesión el destino es Login, nunca una ruta privada', () => {
  assert.equal(decideAuthDestination({ session: null, onboardingDone: true }), 'login');
  assert.equal(decideAuthDestination({ session: undefined, onboardingDone: true }), 'login');
  assert.equal(decideAuthDestination({}), 'login');
  assert.equal(decideAuthDestination({ session: { user: { id: 'x' } }, onboardingDone: true }), 'login');
});

test('decideAuthDestination: con sesión sin verificar, va a verificación', () => {
  const sinVerificar = { access_token: 't', user: { id: 'x', email: 'a@b.cl', email_confirmed_at: null } };
  assert.equal(decideAuthDestination({ session: sinVerificar, onboardingDone: true }), 'verify-email');
});

test('decideAuthDestination: con sesión verificada, entra según el onboarding', () => {
  assert.equal(decideAuthDestination({ session: SESION_VALIDA, onboardingDone: true }), 'main');
  assert.equal(decideAuthDestination({ session: SESION_VALIDA, onboardingDone: false }), 'onboarding');
  assert.equal(decideAuthDestination({ session: SESION_VALIDA, onboardingDone: null }), 'onboarding');
});

// --- Mensajes ------------------------------------------------------------

test('credenciales inválidas y usuario inexistente dan EL MISMO mensaje (no se puede enumerar correos)', () => {
  const a = describeAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' });
  const b = describeAuthError({ code: 'user_not_found', message: 'User not found' });
  assert.equal(a, MENSAJES.credencialesInvalidas);
  assert.equal(b, MENSAJES.credencialesInvalidas);
  assert.equal(a, b, 'los mensajes deben ser indistinguibles');
});

test('los mensajes de error son comprensibles y en español', () => {
  assert.equal(describeAuthError({ code: 'email_not_confirmed' }), MENSAJES.correoSinConfirmar);
  assert.equal(describeAuthError({ code: 'user_already_exists' }), MENSAJES.yaRegistrado);
  assert.equal(describeAuthError({ code: 'weak_password' }), MENSAJES.passwordDebil);
  assert.equal(describeAuthError({ code: 'over_request_rate_limit' }), MENSAJES.demasiadosIntentos);
  assert.equal(describeAuthError({ message: 'Network request failed' }), MENSAJES.sinConexion);
  assert.equal(describeAuthError({ name: 'AuthRetryableFetchError', message: 'load failed' }), MENSAJES.sinConexion);
  assert.equal(describeAuthError({ code: 'algo_que_no_conocemos' }), MENSAJES.inesperado);
  assert.equal(describeAuthError(null), null);
});

test('un mensaje de error nunca filtra la contraseña ni el token', () => {
  const msg = describeAuthError({ code: 'invalid_credentials', message: 'password=secreto123 token=abc' });
  assert.ok(!msg.includes('secreto123'));
  assert.ok(!msg.includes('abc'));
});

// --- Validación ----------------------------------------------------------

test('validateCredentials: exige correo y contraseña', () => {
  assert.equal(validateCredentials({ email: '', password: 'contrasena123' }).valid, false);
  assert.equal(validateCredentials({ email: 'a@b.cl', password: '' }).valid, false);
  assert.equal(validateCredentials({ email: 'a@b.cl', password: 'contrasena123' }).valid, true);
});

test('validateCredentials: en registro exige contraseña de al menos 8 caracteres', () => {
  assert.equal(validateCredentials({ email: 'a@b.cl', password: '1234567', mode: 'signup' }).valid, false);
  assert.equal(validateCredentials({ email: 'a@b.cl', password: '12345678', mode: 'signup' }).valid, true);
});

test('normalizeEmail: recorta y baja a minúsculas, y tolera basura', () => {
  assert.equal(normalizeEmail('  A@B.CL '), 'a@b.cl');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(42), '');
});
