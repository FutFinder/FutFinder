/**
 * Pruebas del sondeo de respaldo.
 *
 * EL FALLO QUE REPRODUCE. El hilo de negociación cargaba los eventos del
 * desafío y la solicitud de cambio UNA sola vez, al montar, y los volvía a
 * pedir sólo después de una acción PROPIA. Su única suscripción de Realtime
 * escucha `public.messages`, y ni `club_challenge_events` ni
 * `club_match_changes` están en la publicación `supabase_realtime`, así que
 * tampoco había nada a lo que suscribirse. Resultado comprobado a mano: un
 * administrador rechazaba un cambio y la sesión del otro seguía mostrando la
 * solicitud como pendiente indefinidamente, hasta recargar la página.
 *
 * Es la misma solución que la nómina de U3: un sondeo corto como reserva.
 * Acá es la única vía, no la reserva, porque esas dos tablas no emiten
 * eventos de Realtime.
 *
 * Los temporizadores se inyectan para poder mover el reloj a mano: una
 * prueba que espere 15 segundos de verdad no es una prueba, es una pausa.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { SONDEO_MS, crearSondeo } = require('../sondeo.js');

/** Reloj falso: guarda los intervalos y los dispara cuando se le pide. */
function relojFalso() {
  const activos = new Map();
  let siguiente = 1;
  return {
    timers: {
      setInterval: (fn, ms) => {
        const id = siguiente++;
        activos.set(id, { fn, ms });
        return id;
      },
      clearInterval: (id) => activos.delete(id),
    },
    /** Dispara `veces` ticks de todos los intervalos vivos. */
    avanzar(veces = 1) {
      for (let i = 0; i < veces; i += 1) {
        for (const { fn } of [...activos.values()]) fn();
      }
    },
    vivos: () => activos.size,
    intervaloDe: (id) => activos.get(id)?.ms,
  };
}

test('el intervalo por defecto es el mismo que usa la nómina de U3', () => {
  assert.equal(SONDEO_MS, 15000);
});

test('un hilo activo vuelve a pedir los datos en cada tick', () => {
  const reloj = relojFalso();
  let llamadas = 0;

  const detener = crearSondeo({
    activo: true,
    onTick: () => { llamadas += 1; },
    timers: reloj.timers,
  });

  assert.equal(llamadas, 0, 'no debería sondear antes del primer tick');
  reloj.avanzar(3);
  assert.equal(llamadas, 3);
  detener();
});

test('REGRESIÓN: un hilo inactivo no sondea nunca', () => {
  // Un DM o el chat de un club no tienen estado de desafío que refrescar:
  // sondearlos sería una consulta cada 15 segundos por cada conversación
  // abierta, a cambio de nada.
  const reloj = relojFalso();
  let llamadas = 0;

  const detener = crearSondeo({
    activo: false,
    onTick: () => { llamadas += 1; },
    timers: reloj.timers,
  });

  reloj.avanzar(5);
  assert.equal(llamadas, 0);
  assert.equal(reloj.vivos(), 0, 'no debería haber quedado ningún intervalo vivo');
  assert.equal(typeof detener, 'function', 'siempre devuelve una función de limpieza');
  detener();
});

test('detener corta el sondeo y no deja el intervalo colgado', () => {
  const reloj = relojFalso();
  let llamadas = 0;

  const detener = crearSondeo({
    activo: true,
    onTick: () => { llamadas += 1; },
    timers: reloj.timers,
  });

  reloj.avanzar(1);
  detener();
  reloj.avanzar(5);

  assert.equal(llamadas, 1, 'después de detener no debería sondear más');
  assert.equal(reloj.vivos(), 0);
});

test('detener dos veces no revienta', () => {
  const reloj = relojFalso();
  const detener = crearSondeo({ activo: true, onTick: () => {}, timers: reloj.timers });
  detener();
  detener();
  assert.equal(reloj.vivos(), 0);
});

test('un tick no se solapa con el anterior si la consulta todavía no volvió', () => {
  // Con la red lenta, sondear cada 15 s sin esta guarda apila consultas: la
  // pantalla termina pintando la respuesta de una petición vieja encima de
  // una nueva, que es peor que no refrescar.
  const reloj = relojFalso();
  let llamadas = 0;
  let resolver;

  const detener = crearSondeo({
    activo: true,
    onTick: () => {
      llamadas += 1;
      return new Promise((r) => { resolver = r; });
    },
    timers: reloj.timers,
  });

  reloj.avanzar(3);
  assert.equal(llamadas, 1, 'los ticks mientras hay una consulta en vuelo se saltan');

  resolver();
  return Promise.resolve().then(() => {
    reloj.avanzar(1);
    assert.equal(llamadas, 2, 'al resolverse la consulta, el siguiente tick vuelve a pedir');
    detener();
  });
});

test('un tick que falla no deja el sondeo trabado para siempre', () => {
  const reloj = relojFalso();
  let llamadas = 0;

  const detener = crearSondeo({
    activo: true,
    onTick: () => {
      llamadas += 1;
      return Promise.reject(new Error('sin red'));
    },
    timers: reloj.timers,
  });

  reloj.avanzar(1);
  assert.equal(llamadas, 1);

  return new Promise((r) => setTimeout(r, 0)).then(() => {
    reloj.avanzar(1);
    assert.equal(llamadas, 2, 'tras un fallo, el siguiente tick tiene que volver a intentarlo');
    detener();
  });
});

test('se puede elegir otro intervalo', () => {
  const reloj = relojFalso();
  const detener = crearSondeo({
    activo: true,
    intervaloMs: 4000,
    onTick: () => {},
    timers: reloj.timers,
  });
  assert.equal(reloj.intervaloDe(1), 4000);
  detener();
});

test('sin `onTick` no se programa nada', () => {
  const reloj = relojFalso();
  const detener = crearSondeo({ activo: true, timers: reloj.timers });
  reloj.avanzar(3);
  assert.equal(reloj.vivos(), 0);
  detener();
});

// ---------------------------------------------------------------------------
// El camino POR DEFECTO, que es el que corre en la aplicación
//
// REGRESIÓN del 2026-08-14: abrir el hilo de negociación en web reventaba con
// `TypeError: Illegal invocation` y el Error Boundary se comía la pantalla en
// las dos sesiones. La causa: los temporizadores por defecto se guardaban en
// un objeto (`{ setInterval, clearInterval }`) y se invocaban como método de
// ESE objeto, así que en el navegador llegaban con el receptor equivocado.
//
// Las pruebas de arriba no podían verlo: todas inyectan dobles, de modo que
// el camino por defecto —el único que corre de verdad— no se ejecutaba nunca.
// ---------------------------------------------------------------------------

/**
 * Modelo de los temporizadores de un navegador.
 *
 * WebIDL permite `setInterval(fn, ms)` a secas —cuando el receptor es
 * undefined se sustituye por el objeto global, que es por lo que la llamada
 * suelta funciona dentro de un módulo— pero lanza «Illegal invocation» si se
 * invoca como método de otro objeto. Node no comprueba nada, y ahí estaba el
 * punto ciego.
 */
function conTemporizadoresDeNavegador(fn) {
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const cuenta = { programados: 0, cancelados: 0 };

  const brandCheck = (contar) =>
    function () {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      contar();
      return 'id-de-navegador';
    };

  globalThis.setInterval = brandCheck(() => { cuenta.programados += 1; });
  globalThis.clearInterval = brandCheck(() => { cuenta.cancelados += 1; });
  try {
    return fn(cuenta);
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
}

test('REGRESIÓN: abrir un hilo de desafío en web no lanza «Illegal invocation»', () => {
  conTemporizadoresDeNavegador((cuenta) => {
    let detener;
    assert.doesNotThrow(() => {
      // Sin `timers`: exactamente como lo llama `ChatThreadScreen`.
      detener = crearSondeo({ activo: true, onTick: () => {} });
    }, 'crearSondeo no puede reventar con los temporizadores del navegador');

    assert.equal(cuenta.programados, 1, 'debería haber programado el sondeo');

    assert.doesNotThrow(() => detener(), 'detener tampoco puede reventar');
    assert.equal(cuenta.cancelados, 1, 'debería haber cancelado el intervalo');
  });
});

test('REGRESIÓN: un hilo inactivo en web no toca los temporizadores', () => {
  conTemporizadoresDeNavegador((cuenta) => {
    const detener = crearSondeo({ activo: false, onTick: () => {} });
    assert.doesNotThrow(() => detener());
    assert.equal(cuenta.programados, 0);
  });
});

test('con temporizadores de verdad, el sondeo programa y limpia sin ayuda', async () => {
  // La última red: sin dobles y sin modelos, contra el `setInterval` real de
  // este entorno, con un intervalo corto.
  let llamadas = 0;
  const detener = crearSondeo({
    activo: true,
    intervaloMs: 5,
    onTick: () => { llamadas += 1; },
  });

  await new Promise((r) => setTimeout(r, 40));
  detener();
  const alDetener = llamadas;
  assert.ok(alDetener >= 2, `debería haber sondeado varias veces, fueron ${alDetener}`);

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(llamadas, alDetener, 'después de detener no debería sondear más');
});

test('REGRESIÓN: si programar el sondeo falla, el hilo sigue en pie', () => {
  // La lección del Error Boundary: un refresco de respaldo que revienta se
  // lleva por delante toda la conversación. Degradar a «sin refresco
  // automático» es malo; quedarse sin chat es mucho peor.
  const timers = {
    setInterval: () => { throw new TypeError('Illegal invocation'); },
    clearInterval: () => {},
  };

  let detener;
  assert.doesNotThrow(() => {
    detener = crearSondeo({ activo: true, onTick: () => {}, timers });
  });
  assert.equal(typeof detener, 'function');
  assert.doesNotThrow(() => detener());
});
