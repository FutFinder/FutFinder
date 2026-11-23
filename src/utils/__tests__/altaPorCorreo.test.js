/**
 * El alta por correo tiene que poder terminarse aunque algo falle a mitad.
 * Se ejecutan con: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ESPERA_REENVIO,
  formatoEspera,
  segundosDeEspera,
  siguientePasoDelAlta,
  repartirCodigo,
} = require('../altaPorCorreo.js');

test('la espera para reenviar es la misma que exige Auth (max_frequency)', () => {
  const toml = fs.readFileSync(path.join(__dirname, '../../../supabase/config.toml'), 'utf8');
  const m = toml.match(/^max_frequency\s*=\s*"(?:(\d+)m)?(?:(\d+)s)?"/m);
  assert.ok(m, 'config.toml ya no declara max_frequency');
  const segundos = Number(m[1] || 0) * 60 + Number(m[2] || 0);
  assert.equal(ESPERA_REENVIO, segundos);
});

test('la espera se muestra en minutos y segundos', () => {
  assert.equal(formatoEspera(60), '1:00');
  assert.equal(formatoEspera(42), '0:42');
  assert.equal(formatoEspera(5), '0:05');
  assert.equal(formatoEspera(0), '0:00');
  assert.equal(formatoEspera(-3), '0:00');
  assert.equal(formatoEspera(undefined), '0:00');
});

test('un rechazo por frecuencia dice cuántos segundos faltan', () => {
  assert.equal(
    segundosDeEspera({
      code: 'over_email_send_rate_limit',
      message: 'For security purposes, you can only request this after 37 seconds.',
    }),
    37
  );
  // Sin número en el texto: la espera completa.
  assert.equal(segundosDeEspera({ code: 'over_email_send_rate_limit', message: 'rate limit' }), ESPERA_REENVIO);
  // Sin código pero con el texto de Auth.
  assert.equal(segundosDeEspera({ message: 'you can only request this after 1 second.' }), 1);
});

test('otros errores no son una espera', () => {
  assert.equal(segundosDeEspera(null), 0);
  assert.equal(segundosDeEspera({ message: 'Failed to fetch' }), 0);
  assert.equal(segundosDeEspera({ code: 'otp_expired', message: 'Token has expired' }), 0);
});

test('registro normal: primero la contraseña, después la edad, después se sigue', () => {
  const base = { esRegistro: true, edad: 25 };
  assert.equal(siguientePasoDelAlta({ ...base, hayPasswordPendiente: true }), 'password');
  assert.equal(siguientePasoDelAlta({ ...base, passwordFijada: true }), 'edad');
  assert.equal(siguientePasoDelAlta({ ...base, passwordFijada: true, edadGuardada: true }), 'listo');
});

test('si falla la contraseña y sigue en memoria, se reintenta la contraseña', () => {
  assert.equal(
    siguientePasoDelAlta({ esRegistro: true, hayPasswordPendiente: true, passwordFijada: false, edad: 25 }),
    'password'
  );
});

test('registro sin contraseña en memoria (recarga): se guarda la edad y se pide crear una', () => {
  const base = { esRegistro: true, hayPasswordPendiente: false, passwordFijada: false, edad: 25 };
  assert.equal(siguientePasoDelAlta(base), 'edad');
  assert.equal(siguientePasoDelAlta({ ...base, edadGuardada: true }), 'crearPassword');
  assert.equal(siguientePasoDelAlta({ ...base, edad: null }), 'crearPassword');
});

test('quien viene de Iniciar sesión ya tiene contraseña: nunca se le pide crear una', () => {
  assert.equal(siguientePasoDelAlta({ esRegistro: false }), 'listo');
  assert.equal(siguientePasoDelAlta({}), 'listo');
});

test('la pantalla de verificación no ignora los resultados', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../screens/VerificationScreen.js'), 'utf8');
  const sinComentarios = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  // Ninguna llamada suelta: el resultado se asigna o se devuelve.
  assert.doesNotMatch(sinComentarios, /^\s*(?:if \([^)]*\) )?await (?:updateMyProfile|resendOtp)\(/m);
  assert.doesNotMatch(sinComentarios, /setSeconds\(\s*\d+\s*\)|useState\(\s*42\s*\)/);
  assert.match(sinComentarios, /ESPERA_REENVIO/);
});

test('la contraseña pendiente no se borra antes de saber que se guardó', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../services/auth.js'), 'utf8');
  assert.doesNotMatch(src, /consumirPasswordPendiente/);
});

test('escribir un dígito llena su casilla y pasa a la siguiente', () => {
  const vacias = ['', '', '', '', '', ''];
  assert.deepEqual(repartirCodigo(vacias, 0, '7'), { casillas: ['7', '', '', '', '', ''], foco: 1 });
  assert.deepEqual(repartirCodigo(['7', '8', '1', '2', '4', ''], 5, '5'), {
    casillas: ['7', '8', '1', '2', '4', '5'],
    foco: 5,
  });
});

test('pegar el código entero lo reparte en las seis casillas', () => {
  const vacias = ['', '', '', '', '', ''];
  assert.deepEqual(repartirCodigo(vacias, 0, '781245'), {
    casillas: ['7', '8', '1', '2', '4', '5'],
    foco: 5,
  });
  // Con espacios o guion, como lo copia la gente desde el correo.
  assert.deepEqual(repartirCodigo(vacias, 0, ' 781 245 ').casillas, ['7', '8', '1', '2', '4', '5']);
  // Pegado a mitad de camino: no se sale de las casillas.
  assert.deepEqual(repartirCodigo(['7', '8', '', '', '', ''], 2, '124599').casillas, ['7', '8', '1', '2', '4', '5']);
});

test('escribir sobre una casilla ocupada la reemplaza, y borrar la vacía', () => {
  const llenas = ['7', '8', '1', '2', '4', '5'];
  assert.deepEqual(repartirCodigo(llenas, 2, '19'), { casillas: ['7', '8', '9', '2', '4', '5'], foco: 3 });
  assert.deepEqual(repartirCodigo(llenas, 2, ''), { casillas: ['7', '8', '', '2', '4', '5'], foco: 2 });
  assert.deepEqual(repartirCodigo(llenas, 2, 'x').casillas[2], '');
});
