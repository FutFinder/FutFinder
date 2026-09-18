const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Que el mínimo de caracteres de una contraseña viva en UN SOLO SITIO.
 *
 * POR QUÉ EXISTE, que nació de un desacuerdo real. Hasta el 2026-09-18:
 *
 *     RegisterScreen  → if (password.length < 8)       «Usa al menos 8»
 *     SettingsScreen  → if (passwordInput.length < 6)  «Mínimo 6»
 *
 * O sea que alguien se registraba con ocho caracteres y al día siguiente se
 * la bajaba a seis por la otra puerta. Nadie lo escribió mal: se escribió
 * dos veces, y la segunda vez con otro número. Eso es lo que esta prueba
 * impide, y por eso mira el TEXTO de los archivos y no el comportamiento —
 * el comportamiento de hoy es correcto; lo que se vigila es que mañana no
 * se vuelva a teclear el número a mano en una tercera pantalla.
 *
 * Nota de alcance: esto es sólo el cliente. El mínimo que manda de verdad
 * lo aplica Supabase Auth en el panel, y hay que subirlo ahí también.
 */

const RAIZ = path.join(__dirname, '..', '..');

// `algoPassword.length < 7`, `clave.length <= 6`, `pwd.length < 10`…
const COMPARA_A_MANO =
  /\b[A-Za-z_$][\w$]*(?:password|passwd|pwd|clave|contrasena|contraseña)[\w$]*\s*\.length\s*[<>]=?\s*\d+/i;

// El medidor usa una variable corta (`p`), así que ahí hace falta una regla
// aparte — pero SÓLO ahí: `p.length > 0` es un filtro de cadenas de lo más
// normal en otros archivos, y la primera versión de esta prueba lo denunció.
const ARCHIVO_DEL_MEDIDOR = path.join('utils', 'passwordStrength.js');
const COMPARA_CORTO = /\bp\.length\s*[<>]=?\s*\d+/;

function archivos(dir) {
  const salida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue;
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...archivos(completo));
    else if (/\.(js|jsx)$/.test(e.name)) salida.push(completo);
  }
  return salida;
}

test('el mínimo de contraseña no se escribe a mano en ninguna parte', () => {
  const culpables = [];

  for (const archivo of archivos(RAIZ)) {
    const relativo = path.relative(RAIZ, archivo);
    const esElMedidor = relativo === ARCHIVO_DEL_MEDIDOR;
    const lineas = fs.readFileSync(archivo, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      if (COMPARA_A_MANO.test(linea) || (esElMedidor && COMPARA_CORTO.test(linea))) {
        culpables.push(`${relativo}:${i + 1}  ${linea.trim()}`);
      }
    });
  }

  assert.deepEqual(
    culpables,
    [],
    'Hay un mínimo de contraseña escrito a mano. Importa `MIN_PASSWORD` de ' +
      '`utils/passwordStrength` en vez de teclear el número:\n' +
      culpables.join('\n'),
  );
});

test('MIN_PASSWORD es 8, y las dos puertas validan con el mismo validador', () => {
  const { MIN_PASSWORD } = require('../passwordStrength');
  assert.equal(MIN_PASSWORD, 8);

  const registro = fs.readFileSync(path.join(RAIZ, 'screens', 'RegisterScreen.js'), 'utf8');
  const ajustes = fs.readFileSync(path.join(RAIZ, 'screens', 'SettingsScreen.js'), 'utf8');

  assert.ok(
    /validarPassword\(password\)/.test(registro),
    'RegisterScreen ya no valida con validarPassword',
  );
  assert.ok(
    /validarPassword\(passwordInput\)/.test(ajustes),
    'SettingsScreen ya no valida con validarPassword',
  );
});

/**
 * Estas comprueban que el espejo de las reglas del panel es fiel. Los casos
 * salen de probar el servidor de verdad el 2026-09-18: `Abcd3!xy` lo aceptó
 * y `contrasenalarga` lo rechazó por «characters».
 */
test('validarPassword: exige largo y los cuatro tipos de carácter', () => {
  const { validarPassword } = require('../passwordStrength');

  assert.equal(validarPassword('Abcd3!xy').valid, true);
  assert.equal(validarPassword('corta').valid, false);
  assert.equal(validarPassword('').valid, false);
  assert.equal(validarPassword(null).valid, false);

  // Lo que el servidor rechaza por tipos de carácter, no por largo.
  for (const floja of ['contrasenalarga', 'Contrasenalarga', 'Contrasena1', 'CONTRASENA1!']) {
    assert.equal(validarPassword(floja).valid, false, `deberia rechazar ${floja}`);
  }
});

test('validarPassword: el mensaje dice QUÉ falta, no sólo que está mal', () => {
  const { validarPassword } = require('../passwordStrength');

  assert.match(validarPassword('corta').message, /8 caracteres/);
  assert.match(validarPassword('Contrasena1').message, /símbolo/);
  assert.match(validarPassword('contrasenalarga').message, /mayúscula/);
  assert.match(validarPassword('contrasenalarga').message, /número/);
});

test('describeAuthError traduce el motivo REAL de una contraseña débil', async () => {
  const { describeAuthError } = await import('../../services/authPolicy.js');

  // Es el error que devolvió el servidor al activar los tipos de carácter.
  assert.match(
    describeAuthError({ code: 'weak_password', reasons: ['characters'] }),
    /minúscula.*mayúscula.*número.*símbolo/,
  );
  assert.match(
    describeAuthError({ code: 'weak_password', reasons: ['length'] }),
    /8 caracteres/,
  );
  // Y por la forma en que viene en la respuesta REST, no sólo desde el SDK.
  assert.match(
    describeAuthError({ code: 'weak_password', weak_password: { reasons: ['characters'] } }),
    /símbolo/,
  );
});
