/**
 * Aceptar los términos no puede decir «todo listo» si no se guardó nada.
 *
 * EL FALLO (2026-10-17, corriendo la app contra la base local). La pantalla
 * de términos hacía `await completeOnboarding()` y navegaba a `Success`
 * pasara lo que pasara. Cuando la escritura falla —sin conexión, un 503—
 * el flag `onboarding_completed` se queda en false, la persona lee «¡Todo
 * listo! Tu cuenta ha sido verificada y configurada correctamente» y **la
 * próxima vez que abra la app vuelve a pasar por el permiso de ubicación y
 * por los términos**. Para siempre, y sin un solo indicio de que algo
 * falló. Se vio con el API REST del stack local apagado: el registro
 * llegaba hasta el final y el perfil quedaba sin marcar.
 *
 * No se monta React: se lee el archivo y se comprueba la forma. Lo que
 * importa es que el resultado NO se tire a la basura.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'TermsScreen.js'),
  'utf8'
);

test('el resultado de completeOnboarding se mira, no se descarta', () => {
  // Una línea que EMPIEZA por `await completeOnboarding(` es una llamada
  // cuyo resultado se tira. Si está asignada, la línea empieza por `const`.
  const tirado = SRC.split('\n').filter((l) => /^\s*await\s+completeOnboarding\(/.test(l));
  assert.deepEqual(
    tirado,
    [],
    'se está llamando a completeOnboarding() tirando el resultado'
  );
  assert.ok(
    /=\s*await\s+completeOnboarding\(/.test(SRC),
    'completeOnboarding() tiene que devolver algo que se mire'
  );
});

test('si falla, no se navega a Success', () => {
  // El `return` temprano del error tiene que estar ANTES del navigate.
  const i = SRC.indexOf('completeOnboarding(');
  const j = SRC.indexOf("navigation.navigate('Success')");
  assert.ok(i > 0 && j > i, 'no se encontró el orden esperado');
  const entre = SRC.slice(i, j);
  assert.ok(
    /if\s*\(\s*err/.test(entre) && /return;/.test(entre),
    'entre guardar y navegar tiene que haber un corte por error'
  );
});

test('y se le dice a la persona', () => {
  assert.ok(
    /No pudimos guardar tu aceptaci/.test(SRC),
    'falta el mensaje visible cuando no se pudo guardar'
  );
});
