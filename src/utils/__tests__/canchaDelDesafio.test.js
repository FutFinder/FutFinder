const test = require('node:test');
const assert = require('node:assert/strict');

const {
  vistaDeLaCancha,
  restanteDelPlazo,
  formatoReloj,
  bloqueDeLaPropuesta,
  bloqueALaHora,
} = require('../canchaDelDesafio.js');

// La tarjeta «¿Dónde juegan?» del chat del desafío (migración 202). Lo que se
// protege: que cada club vea lo suyo —el local, los botones; el visitante, el
// estado— y que el reloj de 15 minutos no mienta.

const base = {
  ok: true,
  estado_desafio: 'negociacion',
  soy_local: false,
  soy_visitante: false,
  club_local: { id: 'l', nombre: 'SixSiete' },
  club_visitante: { id: 'v', nombre: 'Club prueba' },
  puedo_elegir: false,
  puedo_reservar: false,
  soy_capitan_rival: false,
  cancha_elegida: null,
  reserva: null,
};

const elegida = {
  propuesta_id: 'p', propuesta_estado: 'pendiente', fecha: '2026-12-05T23:00:00Z',
  cancha_id: 'k', cancha_nombre: 'Cancha 2', complejo_id: 'c', complejo_nombre: 'Monte Carlo',
};

test('negociación: el local que dirige ve los dos atajos', () => {
  const v = vistaDeLaCancha({ ...base, soy_local: true, puedo_elegir: true });
  assert.equal(v.tipo, 'elegir');
});

test('negociación: el visitante ve que reserva el local, sin botones', () => {
  const v = vistaDeLaCancha({ ...base, soy_visitante: true });
  assert.equal(v.tipo, 'espera_local');
  assert.match(v.texto, /SixSiete/);
});

test('negociación: un integrante del local sin permiso ve solo el estado', () => {
  const v = vistaDeLaCancha({ ...base, soy_local: false, soy_visitante: false });
  assert.equal(v.tipo, 'solo_lectura');
});

test('propuesta enviada con cancha de FutFinder: elegida, sin reservar', () => {
  const v = vistaDeLaCancha({ ...base, estado_desafio: 'esperando_aprobacion', soy_local: true, cancha_elegida: elegida });
  assert.equal(v.tipo, 'cancha_elegida');
});

test('publicado: el local reserva ahora con la cancha de la propuesta', () => {
  const v = vistaDeLaCancha({
    ...base, estado_desafio: 'publicado', soy_local: true, puedo_reservar: true,
    cancha_elegida: { ...elegida, propuesta_estado: 'aprobada' },
  });
  assert.equal(v.tipo, 'reservar_ahora');
});

test('publicado sin cancha elegida: el local reserva buscando', () => {
  const v = vistaDeLaCancha({ ...base, estado_desafio: 'publicado', soy_local: true, puedo_reservar: true });
  assert.equal(v.tipo, 'reservar');
});

const reserva = {
  id: 'r', estado: 'armando', mitad: 42000, pago_local: true, pago_rival: false,
  plazo_at: '2026-11-26T20:15:00Z', complejo_nombre: 'Monte Carlo', cancha_nombre: 'Cancha 2',
};

test('reserva viva: el local espera el pago del rival', () => {
  const v = vistaDeLaCancha({ ...base, estado_desafio: 'publicado', soy_local: true, reserva });
  assert.equal(v.tipo, 'falta_rival');
});

test('reserva viva: el capitán rival tiene que pagar su mitad', () => {
  const v = vistaDeLaCancha({ ...base, estado_desafio: 'publicado', soy_visitante: true, soy_capitan_rival: true, reserva });
  assert.equal(v.tipo, 'pagar_mi_mitad');
});

test('reserva sin el pago del local todavía: el local tiene que pagar', () => {
  const v = vistaDeLaCancha({
    ...base, estado_desafio: 'publicado', soy_local: true, reserva: { ...reserva, pago_local: false },
  });
  assert.equal(v.tipo, 'pagar_local');
});

test('reserva confirmada: lo dice, para todos', () => {
  const v = vistaDeLaCancha({ ...base, estado_desafio: 'publicado', soy_visitante: true, reserva: { ...reserva, estado: 'confirmada', pago_rival: true } });
  assert.equal(v.tipo, 'confirmada');
});

test('desafío cerrado o en juego: no hay tarjeta', () => {
  for (const estado of ['expirado', 'sin_acuerdo', 'cancelado', 'bloqueado_sancion', 'esperando_resultado']) {
    assert.equal(vistaDeLaCancha({ ...base, estado_desafio: estado, soy_local: true }), null, estado);
  }
  assert.equal(vistaDeLaCancha(null), null);
  assert.equal(vistaDeLaCancha({ ok: false }), null);
});

test('el reloj cuenta lo que queda y no baja de cero', () => {
  const ahora = Date.parse('2026-11-26T20:02:20Z');
  assert.equal(restanteDelPlazo('2026-11-26T20:15:00Z', ahora), 760);
  assert.equal(formatoReloj(760), '12:40');
  assert.equal(restanteDelPlazo('2026-11-26T20:00:00Z', ahora), 0);
  assert.equal(formatoReloj(0), '00:00');
  assert.equal(restanteDelPlazo(null, ahora), null);
});

test('la fecha de la propuesta se lee en hora local, como la grilla del recinto', () => {
  const d = new Date(2026, 11, 5, 20, 0); // 5 dic, 20:00 local
  assert.deepEqual(bloqueDeLaPropuesta(d.toISOString()), { fecha: '2026-12-05', hora: '20:00' });
  assert.equal(bloqueDeLaPropuesta(null), null);
  assert.equal(bloqueDeLaPropuesta('no es fecha'), null);
});

test('el bloque de la hora conversada, aunque la base traiga segundos', () => {
  const horas = [{ hora: '19:00:00', disponible: true }, { hora: '20:00:00', disponible: false }];
  assert.equal(bloqueALaHora(horas, '20:00').disponible, false);
  assert.equal(bloqueALaHora(horas, '21:00'), null);
});

test('la duración del bloque elegido pasa a la propuesta', () => {
  const { minutosEntre } = require('../canchaDelDesafio.js');
  assert.equal(minutosEntre('20:00', '21:00'), 60);
  assert.equal(minutosEntre('20:00:00', '21:30:00'), 90);
  assert.equal(minutosEntre('23:00', '00:00'), 60);
  assert.equal(minutosEntre('20:00', null), null);
  assert.equal(minutosEntre('20:00', '20:00'), null);
});

test('la cancha de la propuesta se lee de texto u objeto, y lo roto es null', () => {
  const { leerCanchaFutFinder } = require('../canchaDelDesafio.js');
  const c = { canchaId: 'k', fecha: '2026-11-28', hora: '20:00', duracionMin: 60 };
  assert.deepEqual(leerCanchaFutFinder(JSON.stringify(c)), c);
  assert.deepEqual(leerCanchaFutFinder(c), c);
  assert.equal(leerCanchaFutFinder('[object Object]'), null);
  assert.equal(leerCanchaFutFinder('{}'), null);
  assert.equal(leerCanchaFutFinder(null), null);
});

test('la tarjeta dice el día y la hora de la cancha', () => {
  const { cuandoDeLaCancha } = require('../canchaDelDesafio.js');
  assert.equal(cuandoDeLaCancha('2026-11-28', '20:00:00'), 'sáb 28 nov · 20:00');
  const instante = new Date(2026, 11, 5, 21, 30).toISOString();
  assert.equal(cuandoDeLaCancha(instante), 'sáb 5 dic · 21:30');
  assert.equal(cuandoDeLaCancha(null), null);
});

test('con el horario ocupado, la grilla marca la hora libre más cercana', () => {
  const { horaLibreMasCercana } = require('../canchaDelDesafio.js');
  const horas = [
    { hora: '08:00:00', disponible: true },
    { hora: '19:00:00', disponible: true },
    { hora: '20:00:00', disponible: false },
    { hora: '21:00:00', disponible: true },
  ];
  assert.equal(horaLibreMasCercana(horas, '20:00'), 1); // 19 y 21 empatan: la más temprana
  assert.equal(horaLibreMasCercana(horas, '21:30'), 3);
  assert.equal(horaLibreMasCercana(horas, null), 0);
  assert.equal(horaLibreMasCercana([{ hora: '20:00', disponible: false }], '20:00'), -1);
});
