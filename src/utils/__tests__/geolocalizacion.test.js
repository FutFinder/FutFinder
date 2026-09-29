/**
 * Pruebas del reloj propio de la ubicación (G01 del listado de calidad).
 *
 * EL FALLO, REPRODUCIDO: un `geolocation` que **no llama a ninguno de sus dos
 * callbacks**. No es un caso inventado: es lo que hizo el Chrome de la Mac de
 * pruebas el 2026-09-29 con el permiso en `denied`, medido con 12 s de espera
 * sin una sola respuesta, y su propia opción `timeout` tampoco se disparó.
 * Con la versión anterior esa promesa no terminaba nunca, se llevaba por
 * delante el `Promise.all` de las pantallas y dejaba el detalle del partido y
 * Partidos cargando para siempre.
 *
 * El reloj se inyecta para no esperar de verdad: `programar` guarda la
 * función y la prueba la dispara cuando quiere.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLAZO_UBICACION_MS,
  UBICACION_VENCIDA,
  conPlazo,
  posicionDelNavegador,
} = require('../geolocalizacion.js');

/** Un reloj de mentira: la prueba decide cuándo vence el plazo. */
function relojFalso() {
  const pendientes = new Map();
  let id = 0;
  return {
    programar: (fn, ms) => {
      pendientes.set(++id, { fn, ms });
      return id;
    },
    cancelar: (i) => pendientes.delete(i),
    vencer: () => {
      for (const { fn } of [...pendientes.values()]) fn();
    },
    get pendientes() {
      return pendientes.size;
    },
    get plazos() {
      return [...pendientes.values()].map((p) => p.ms);
    },
  };
}

/** El navegador del fallo: acepta los callbacks y no llama a ninguno. */
const GEO_MUDA = { getCurrentPosition() {} };

const POSICION = { coords: { latitude: -33.45, longitude: -70.66, accuracy: 12 } };

// ---------------------------------------------------------------- conPlazo

test('G01: una promesa que no termina nunca deja de colgar a quien la espera', async () => {
  const reloj = relojFalso();
  const colgada = new Promise(() => {}); // jamás resuelve ni rechaza
  const espera = conPlazo(colgada, { programar: reloj.programar, cancelar: reloj.cancelar });

  reloj.vencer();

  assert.deepEqual(await espera, UBICACION_VENCIDA);
  assert.equal(UBICACION_VENCIDA.ok, false, 'vencer nunca puede parecer un éxito');
});

test('si la promesa contesta a tiempo, manda ella y el reloj se cancela', async () => {
  const reloj = relojFalso();
  const buena = { ok: true, latitude: -33.45, longitude: -70.66 };
  const r = await conPlazo(Promise.resolve(buena), {
    programar: reloj.programar,
    cancelar: reloj.cancelar,
  });
  assert.deepEqual(r, buena);
  // Sin cancelar, el reloj quedaría vivo hasta vencer en cada llamada.
  assert.equal(reloj.pendientes, 0);
});

test('una promesa que falla se traduce a «no hay ubicación», no revienta a quien llama', async () => {
  const reloj = relojFalso();
  const r = await conPlazo(Promise.reject(new Error('GPS apagado')), {
    programar: reloj.programar,
    cancelar: reloj.cancelar,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'GPS apagado');
});

test('una respuesta tardía no pisa la que ya se entregó', async () => {
  const reloj = relojFalso();
  let resolverTarde;
  const tarde = new Promise((res) => {
    resolverTarde = res;
  });
  const espera = conPlazo(tarde, { programar: reloj.programar, cancelar: reloj.cancelar });

  reloj.vencer();
  assert.deepEqual(await espera, UBICACION_VENCIDA);

  // El navegador despierta después: su punto llega tarde y se descarta.
  resolverTarde({ ok: true, latitude: 1, longitude: 2 });
  assert.deepEqual(await espera, UBICACION_VENCIDA);
});

test('el plazo por defecto es el de la app, y se puede acortar', async () => {
  const reloj = relojFalso();
  conPlazo(new Promise(() => {}), { programar: reloj.programar, cancelar: reloj.cancelar });
  assert.deepEqual(reloj.plazos, [PLAZO_UBICACION_MS]);

  const otro = relojFalso();
  conPlazo(new Promise(() => {}), {
    plazoMs: 1500,
    programar: otro.programar,
    cancelar: otro.cancelar,
  });
  assert.deepEqual(otro.plazos, [1500]);
});

// ------------------------------------------------------- posicionDelNavegador

test('G01: el navegador mudo, envuelto con su plazo, termina', async () => {
  const reloj = relojFalso();
  const espera = conPlazo(posicionDelNavegador(GEO_MUDA), {
    programar: reloj.programar,
    cancelar: reloj.cancelar,
  });
  reloj.vencer();
  assert.deepEqual(await espera, UBICACION_VENCIDA);
});

test('una posición buena llega con sus tres datos', async () => {
  const geo = { getCurrentPosition: (ok) => ok(POSICION) };
  assert.deepEqual(await posicionDelNavegador(geo), {
    ok: true,
    latitude: -33.45,
    longitude: -70.66,
    accuracy: 12,
  });
});

test('el permiso denegado conserva el motivo del navegador', async () => {
  const geo = { getCurrentPosition: (_ok, err) => err({ code: 1, message: 'User denied Geolocation' }) };
  const r = await posicionDelNavegador(geo);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'User denied Geolocation');
});

test('sin geolocalización en el navegador se dice, no se revienta', async () => {
  for (const geo of [undefined, null, {}, { getCurrentPosition: 'no soy función' }]) {
    const r = await posicionDelNavegador(geo);
    assert.equal(r.ok, false, String(geo));
    assert.match(r.reason, /\S/);
  }
});

test('un navegador que LANZA en vez de llamar al callback tampoco cuelga', async () => {
  const geo = {
    getCurrentPosition() {
      throw new Error('SecurityError: solo en contextos seguros');
    },
  };
  const r = await posicionDelNavegador(geo);
  assert.equal(r.ok, false);
  assert.match(r.reason, /SecurityError/);
});

test('un navegador que llama a los dos callbacks entrega una sola respuesta', async () => {
  const geo = {
    getCurrentPosition: (ok, err) => {
      ok(POSICION);
      err({ message: 'y además falló' });
    },
  };
  const r = await posicionDelNavegador(geo);
  assert.equal(r.ok, true, 'gana la primera respuesta, no la última');
  assert.equal(r.latitude, -33.45);
});
