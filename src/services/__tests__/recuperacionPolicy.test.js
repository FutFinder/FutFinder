/**
 * «Olvidé mi contraseña» con código (services/recuperacionPolicy.js).
 *
 * Por qué existe: el flujo anterior mandaba un enlace que la app no sabía
 * recibir y la única forma de cambiar la contraseña pedía la actual. Estas
 * pruebas fijan el flujo de tres pasos y, sobre todo, lo que NO debe pasar:
 * crear cuentas, revelar qué correos existen, avanzar sin sesión, o dejar
 * vivas las sesiones abiertas con la contraseña vieja.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  pedirCodigo,
  verificarCodigo,
  fijarNuevaPassword,
  MENSAJES_RECUPERACION,
} = require('../recuperacionPolicy.js');
const { MENSAJES } = require('../authPolicy.js');

/** Cliente de auth falso: registra cada llamada y contesta lo que se le diga. */
function clienteFalso(respuestas = {}) {
  const llamadas = [];
  const metodo = (nombre) => async (args) => {
    llamadas.push({ nombre, args });
    const r = respuestas[nombre];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(args) : r ?? { data: {}, error: null };
  };
  return {
    llamadas,
    signInWithOtp: metodo('signInWithOtp'),
    verifyOtp: metodo('verifyOtp'),
    updateUser: metodo('updateUser'),
    signOut: metodo('signOut'),
  };
}

/** Un JWT sin firmar con el `aal` pedido: `nivelDesdeSesion` sólo lee el payload. */
function token(aal) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ aal, sub: 'u1' })}.firma`;
}

function sesion({ aal = 'aal1', factores = [] } = {}) {
  return {
    access_token: token(aal),
    user: { id: 'u1', email: 'ana@futfinder.cl', email_confirmed_at: '2026-01-01', factors: factores },
  };
}

// ── Paso 1: pedir el código ──────────────────────────────────────────

test('pedir el código nunca crea una cuenta', async () => {
  const auth = clienteFalso();
  const r = await pedirCodigo('  Ana@FutFinder.cl ', auth);
  assert.equal(r.error, null);
  assert.equal(auth.llamadas.length, 1);
  assert.deepEqual(auth.llamadas[0].args, {
    email: 'ana@futfinder.cl',
    options: { shouldCreateUser: false },
  });
});

test('un correo sin cuenta contesta igual que uno con cuenta (no se revela cuál existe)', async () => {
  for (const error of [
    { code: 'otp_disabled', message: 'Signups not allowed for otp' },
    { message: 'Signups not allowed for otp' },
    { code: 'user_not_found', message: 'User not found' },
  ]) {
    const r = await pedirCodigo('nadie@futfinder.cl', clienteFalso({ signInWithOtp: { error } }));
    assert.equal(r.error, null, `«${error.message}» no debería mostrarse como error`);
  }
});

test('un correo mal escrito no llega al servidor', async () => {
  const auth = clienteFalso();
  const r = await pedirCodigo('ana@', auth);
  assert.equal(r.error.message, MENSAJES.correoInvalido);
  assert.equal(auth.llamadas.length, 0);
});

test('el límite de envíos sí se le dice a la persona', async () => {
  const r = await pedirCodigo(
    'ana@futfinder.cl',
    clienteFalso({ signInWithOtp: { error: { code: 'over_email_send_rate_limit', message: 'x' } } })
  );
  assert.equal(r.error.message, MENSAJES.demasiadosIntentos);
});

// ── Paso 2: verificar el código ──────────────────────────────────────

test('el código se verifica como código de correo y entrega la sesión', async () => {
  const s = sesion();
  const auth = clienteFalso({ verifyOtp: { data: { session: s }, error: null } });
  const r = await verificarCodigo({ email: 'Ana@FutFinder.cl', codigo: '123456' }, auth);
  assert.equal(r.error, null);
  assert.equal(r.session, s);
  assert.equal(r.necesitaMfa, false);
  assert.deepEqual(auth.llamadas[0].args, { email: 'ana@futfinder.cl', token: '123456', type: 'email' });
});

test('un código incompleto no llega al servidor', async () => {
  const auth = clienteFalso();
  const r = await verificarCodigo({ email: 'ana@futfinder.cl', codigo: '12345' }, auth);
  assert.equal(r.error.message, MENSAJES_RECUPERACION.codigoIncompleto);
  assert.equal(auth.llamadas.length, 0);
});

test('código incorrecto, o respuesta sin sesión, no avanza', async () => {
  const conError = await verificarCodigo(
    { email: 'ana@futfinder.cl', codigo: '123456' },
    clienteFalso({ verifyOtp: { data: {}, error: { code: 'otp_expired', message: 'Token has expired' } } })
  );
  assert.equal(conError.session, null);
  assert.equal(conError.error.message, MENSAJES.codigoInvalido);

  const sinSesion = await verificarCodigo(
    { email: 'ana@futfinder.cl', codigo: '123456' },
    clienteFalso({ verifyOtp: { data: { session: null }, error: null } })
  );
  assert.equal(sinSesion.session, null);
  assert.ok(sinSesion.error);
});

test('con verificación en dos pasos, el código del correo no basta', async () => {
  const s = sesion({ factores: [{ id: 'f1', status: 'verified', factor_type: 'totp' }] });
  const r = await verificarCodigo(
    { email: 'ana@futfinder.cl', codigo: '123456' },
    clienteFalso({ verifyOtp: { data: { session: s }, error: null } })
  );
  assert.equal(r.error, null);
  assert.equal(r.necesitaMfa, true);
});

// ── Paso 3: la contraseña nueva ──────────────────────────────────────

test('la contraseña nueva cumple la regla del registro antes de ir al servidor', async () => {
  const auth = clienteFalso();
  const r = await fijarNuevaPassword({ password: 'corta', confirmacion: 'corta' }, auth);
  assert.match(r.error.message, /al menos 8/);
  assert.equal(auth.llamadas.length, 0);
});

test('las dos contraseñas tienen que coincidir', async () => {
  const auth = clienteFalso();
  const r = await fijarNuevaPassword({ password: 'Cancha#2026', confirmacion: 'Cancha#2027' }, auth);
  assert.equal(r.error.message, MENSAJES_RECUPERACION.passwordsDistintas);
  assert.equal(auth.llamadas.length, 0);
});

test('al cambiarla se cierran las demás sesiones', async () => {
  const auth = clienteFalso({ updateUser: { data: {}, error: null } });
  const r = await fijarNuevaPassword({ password: 'Cancha#2026', confirmacion: 'Cancha#2026' }, auth);
  assert.equal(r.error, null);
  assert.deepEqual(
    auth.llamadas.map((l) => l.nombre),
    ['updateUser', 'signOut']
  );
  assert.deepEqual(auth.llamadas[0].args, { password: 'Cancha#2026' });
  assert.deepEqual(auth.llamadas[1].args, { scope: 'others' });
});

test('si cerrar las otras sesiones falla, la contraseña igual quedó cambiada', async () => {
  const auth = clienteFalso({ updateUser: { data: {}, error: null }, signOut: new Error('red') });
  const r = await fijarNuevaPassword({ password: 'Cancha#2026', confirmacion: 'Cancha#2026' }, auth);
  assert.equal(r.error, null);
});

test('los rechazos del servidor llegan traducidos, nunca en inglés', async () => {
  const casos = [
    [{ code: 'same_password', message: 'New password should be different from the old password.' }, MENSAJES_RECUPERACION.mismaPassword],
    [{ code: 'insufficient_aal', message: 'AAL2 session is required' }, MENSAJES_RECUPERACION.faltaSegundoPaso],
    [{ code: 'session_not_found', message: 'Session not found' }, MENSAJES_RECUPERACION.sinSesion],
    [{ code: 'weak_password', message: 'Password is known to be weak', reasons: ['characters'] }, MENSAJES.passwordSinVariedad],
  ];
  for (const [error, esperado] of casos) {
    const auth = clienteFalso({ updateUser: { data: {}, error } });
    const r = await fijarNuevaPassword({ password: 'Cancha#2026', confirmacion: 'Cancha#2026' }, auth);
    assert.equal(r.error.message, esperado);
    assert.equal(auth.llamadas.length, 1, 'con error no se cierran otras sesiones');
  }
});

// ── El correo no viaja en la URL ─────────────────────────────────────

test('nadie abre «Recuperar contraseña» con el correo como parámetro (en web va a la URL)', () => {
  const pantallas = path.join(__dirname, '..', '..', 'screens');
  for (const archivo of fs.readdirSync(pantallas).filter((f) => f.endsWith('.js'))) {
    const fuente = fs.readFileSync(path.join(pantallas, archivo), 'utf8');
    for (const m of fuente.matchAll(/navigate\('RecuperarContrasena'([^)]*)\)/g)) {
      assert.ok(!/email/.test(m[1]), `${archivo} pasa el correo por parámetro: ${m[0]}`);
    }
  }
  const pantalla = fs.readFileSync(path.join(pantallas, 'RecuperarContrasenaScreen.js'), 'utf8');
  assert.ok(!/route\?\.params\?\.email/.test(pantalla), 'la pantalla vuelve a leer el correo de la ruta');
});

// ── Ya nadie manda el enlace que la app no sabía abrir ───────────────

test('ninguna parte de la app pide el enlace de recuperación', () => {
  const raiz = path.join(__dirname, '..', '..');
  const encontrados = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== '__tests__') recorrer(ruta);
      } else if (/\.js$/.test(e.name)) {
        const codigo = fs.readFileSync(ruta, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        if (codigo.includes('resetPasswordForEmail')) encontrados.push(path.relative(raiz, ruta));
      }
    }
  };
  recorrer(raiz);
  assert.deepEqual(encontrados, []);
});
