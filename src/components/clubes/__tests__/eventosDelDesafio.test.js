const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Que ningún evento del ciclo de desafíos quede sin su frase.
 *
 * POR QUÉ EXISTE. `ChallengeEventBubble` traduce `club_challenge_events.tipo`
 * a una frase, y cierra con un `default` que dice «Hubo una novedad en el
 * desafío». Ese default es correcto para un tipo que venga de un servidor
 * MÁS NUEVO que la app, y es justo lo que lo vuelve peligroso: un tipo que
 * este mismo servidor ya emite y que nadie cableó cae ahí sin romper nada.
 *
 * Pasó el 2026-10-21, caminando el ciclo con dos cuentas: al terminar el
 * partido, el hilo mostró DOS burbujas idénticas y mudas seguidas —«Hubo
 * una novedad en el desafío»— donde iban «empezó el partido» y «terminó,
 * registren el marcador», que son los dos momentos que más le importan a
 * quien está en esa conversación. `partido_en_juego` y
 * `esperando_resultado` los emite la migración 43 desde el primer día.
 *
 * La autoridad sobre qué tipos existen es `club_challenge_events_tipo_check`,
 * leída de la última migración que la declara — mismo criterio que
 * `avisosCompletos` con `notifications_type_check`.
 *
 * SE LEE EL TEXTO DEL ARCHIVO y no se importa: el componente trae JSX y bajo
 * `node --test` no hay quien lo transpile.
 */

const RAIZ = path.resolve(__dirname, '../../..');
const MIGRACIONES = path.join(RAIZ, '..', 'supabase', 'migrations');

/** Los tipos que el CHECK permite, de la última migración que lo declara. */
function tiposPermitidos() {
  const archivo = fs.readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => fs.readFileSync(path.join(MIGRACIONES, f), 'utf8')
      .includes('add constraint club_challenge_events_tipo_check'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .pop();
  assert.ok(archivo, 'ninguna migración declara club_challenge_events_tipo_check');

  const src = fs.readFileSync(path.join(MIGRACIONES, archivo), 'utf8');
  const i = src.indexOf('add constraint club_challenge_events_tipo_check');
  const bloque = src.slice(i, src.indexOf(']', i));
  return [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** Los `case '<tipo>':` que la burbuja sabe traducir. */
function tiposConFrase() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ChallengeEventBubble.js'), 'utf8');
  const i = src.indexOf('export function textoDelEvento');
  assert.ok(i > -1, 'textoDelEvento ya no se exporta con ese nombre');
  const cuerpo = src.slice(i);
  return [...cuerpo.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]);
}

test('el CHECK y la burbuja se leen de verdad', () => {
  // Si cualquiera de las dos lecturas se rompe, la comparación de abajo
  // pasaría comparando dos listas vacías.
  assert.ok(tiposPermitidos().length >= 20);
  assert.ok(tiposConFrase().length >= 20);
});

test('todo evento que el servidor puede emitir tiene su frase en el hilo', () => {
  const conFrase = new Set(tiposConFrase());
  const mudos = tiposPermitidos().filter((t) => !conFrase.has(t));
  assert.deepEqual(
    mudos, [],
    'estos eventos caen en «Hubo una novedad en el desafío», que es el texto '
    + 'para un servidor más nuevo que la app, no para lo que ya emite',
  );
});

test('la burbuja no inventa tipos que el CHECK no permite', () => {
  const permitidos = new Set(tiposPermitidos());
  const inventados = tiposConFrase().filter((t) => !permitidos.has(t));
  assert.deepEqual(
    inventados, [],
    'un case con un tipo que el servidor no puede escribir es código muerto, '
    + 'y casi siempre un tipo mal escrito',
  );
});
