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
