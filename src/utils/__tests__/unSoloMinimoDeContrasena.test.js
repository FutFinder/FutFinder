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

test('MIN_PASSWORD es 8, y es el que usan el registro y el cambio de contraseña', () => {
  const { MIN_PASSWORD } = require('../passwordStrength');
  assert.equal(MIN_PASSWORD, 8);

  const registro = fs.readFileSync(path.join(RAIZ, 'screens', 'RegisterScreen.js'), 'utf8');
  const ajustes = fs.readFileSync(path.join(RAIZ, 'screens', 'SettingsScreen.js'), 'utf8');

  assert.ok(
    /password\.length\s*<\s*MIN_PASSWORD/.test(registro),
    'RegisterScreen ya no valida contra MIN_PASSWORD',
  );
  assert.ok(
    /passwordInput\.length\s*<\s*MIN_PASSWORD/.test(ajustes),
    'SettingsScreen ya no valida contra MIN_PASSWORD',
  );
});
