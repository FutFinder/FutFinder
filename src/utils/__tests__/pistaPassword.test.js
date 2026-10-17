/**
 * La pista que se le muestra a la persona tiene que decir la regla ENTERA.
 *
 * EL FALLO QUE MOTIVA ESTO (2026-10-16, probando el registro contra la base
 * local). Debajo del campo de contraseña, «Crear cuenta» decía «Usa una
 * mayúscula y un número para reforzarla» — y `validarPassword` exige CUATRO
 * tipos de carácter. Quien leía esa línea escribía `Futbol2026`, apretaba el
 * botón y recién ahí se enteraba: «Te falta un símbolo». El marcador de
 * posición sí lo decía entero, pero desaparece al escribir la primera letra.
 *
 * Y en Ajustes, el campo de contraseña nueva no decía NADA.
 *
 * No alcanza con arreglar las dos frases: lo que esto fija es que la pista
 * SE DERIVE de la misma regla, para que no se puedan volver a separar.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  MIN_PASSWORD,
  PISTA_PASSWORD,
  PISTA_PASSWORD_CORTA,
  validarPassword,
} = require('../passwordStrength.js');

const RAIZ = path.join(__dirname, '..', '..');

test('la pista nombra los cuatro tipos que el validador exige', () => {
  for (const tipo of ['minúscula', 'mayúscula', 'número', 'símbolo']) {
    assert.ok(
      PISTA_PASSWORD.includes(tipo),
      `la pista no menciona ${tipo}: "${PISTA_PASSWORD}"`
    );
  }
  assert.ok(PISTA_PASSWORD.includes(String(MIN_PASSWORD)), 'la pista no dice el mínimo');
});

test('una contraseña que cumple la pista pasa el validador', () => {
  // El caso que fallaba: mayúscula y número, sin símbolo.
  assert.equal(validarPassword('Futbol2026').valid, false);
  assert.equal(validarPassword('Futbol2026!').valid, true);
});

test('las dos pantallas que piden una contraseña muestran la pista, y no una escrita a mano', () => {
  const pantallas = ['screens/RegisterScreen.js', 'screens/SettingsScreen.js'];
  for (const rel of pantallas) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    assert.ok(
      src.includes('PISTA_PASSWORD'),
      `${rel} no usa PISTA_PASSWORD`
    );
    // Nadie vuelve a redactar la regla en la pantalla: si aparece la palabra
    // «mayúscula» fuera de un import, es una frase escrita a mano.
    const aMano = src
      .split('\n')
      .filter((l) => /mayúscula/i.test(l) && !/PISTA_PASSWORD/.test(l));
    assert.deepEqual(
      aMano.map((l) => l.trim()),
      [],
      `${rel} vuelve a escribir la regla a mano`
    );
  }
});

test('el marcador de posición también sale de la misma regla', () => {
  assert.ok(PISTA_PASSWORD_CORTA.startsWith(`${MIN_PASSWORD}+`));
  for (const tipo of ['mayúscula', 'número', 'símbolo']) {
    assert.ok(PISTA_PASSWORD_CORTA.includes(tipo), `el marcador no menciona ${tipo}`);
  }
});
