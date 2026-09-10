/**
 * Pruebas de la traducción del lado del jugador.
 *
 * Lo que se prueba acá es sobre todo lo que NO debe pasar: que el precio de
 * una reserva no salga del precio base de la cancha cuando hay tarifas, y que
 * al jugador no se le sume ningún cargo de servicio.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  nombreDeTipo,
  jugadoresDeTipo,
  notaDeCancha,
  comoComplejoDeLista,
  comoCancha,
  totalDeReserva,
  reservaLista,
} = require('../reservasJugador.js');

test('nombreDeTipo traduce los tres tipos y no revienta con uno nuevo', () => {
  assert.equal(nombreDeTipo('futbol_5'), 'Fútbol 5');
  assert.equal(nombreDeTipo('futbol_7'), 'Fútbol 7');
  assert.equal(nombreDeTipo('futbol_11'), 'Fútbol 11');
  assert.equal(nombreDeTipo('futbol_9'), 'futbol 9');
  assert.equal(nombreDeTipo(null), '');
});

test('jugadoresDeTipo es una sugerencia, no un límite', () => {
  assert.equal(jugadoresDeTipo('futbol_5'), 10);
  assert.equal(jugadoresDeTipo('futbol_7'), 14);
  assert.equal(jugadoresDeTipo('futbol_11'), 22);
  // Un tipo desconocido cae en el más común en vez de quedar sin valor.
  assert.equal(jugadoresDeTipo('lo_que_sea'), 14);
});

test('notaDeCancha usa la duración real del bloque', () => {
  assert.equal(notaDeCancha({ tipo: 'futbol_7', duracion_slot_min: 90 }), 'bloques de 90 min');
  // Sin duración legible, al menos el tipo.
  assert.equal(notaDeCancha({ tipo: 'futbol_7' }), 'Fútbol 7');
  assert.equal(notaDeCancha(null), null);
});

test('comoComplejoDeLista traduce los tipos y conserva la próxima hora libre', () => {
  const fila = {
    id: 'c1', nombre: 'MaiClub', comuna: 'Maipú', region: 'Metropolitana',
    tipos: ['futbol_7'], canchas_activas: 6, desde: 14000,
    proxima_hora_libre: '20:00', distancia_km: 2, rating_avg: null, rating_count: 0,
    verificado_futfinder: false,
  };
  const c = comoComplejoDeLista(fila);
  assert.deepEqual(c.tipos, ['Fútbol 7']);
  assert.equal(c.sector, 'Maipú');
  assert.equal(c.desde, 14000);
  assert.equal(c.proximaHoraLibre, '20:00');
  assert.equal(c.distanciaKm, 2);
  assert.equal(c.reseñas, 0);
});

test('comoComplejoDeLista: sin precio deja null, no cero', () => {
  // Un recinto publicado sin canchas activas: el servidor lo permite. Mostrar
  // «$0» sería peor que no mostrar precio.
  const c = comoComplejoDeLista({ id: 'c1', nombre: 'X', desde: null, tipos: [] });
  assert.equal(c.desde, null);
  assert.deepEqual(c.tipos, []);
});

test('comoComplejoDeLista sin distancia no inventa una', () => {
  const c = comoComplejoDeLista({ id: 'c1', nombre: 'X', distancia_km: null });
  assert.equal(c.distanciaKm, null);
});

test('comoCancha: base y total son el precio BASE, no el de un bloque', () => {
  const k = comoCancha({ id: 'k1', nombre: 'Cancha 1', tipo: 'futbol_7', precio_hora: 28000, duracion_slot_min: 60 });
  assert.equal(k.base, 28000);
  assert.equal(k.total, 28000);
  assert.equal(k.tipo, 'Fútbol 7');
  assert.equal(k.tipoCrudo, 'futbol_7');
  assert.equal(k.jugadoresHabitual, 14);
});

test('totalDeReserva usa el precio del BLOQUE, no el de la cancha', () => {
  // MaiClub: la cancha base son $28.000, pero el bloque de las 13:00 tiene
  // una tarifa de $14.000. Cobrar el base sería cobrar el doble.
  const { cancha, extras, total } = totalDeReserva({ precioBloque: 14000 });
  assert.equal(cancha, 14000);
  assert.equal(extras, 0);
  assert.equal(total, 14000);
});

test('totalDeReserva suma los adicionales elegidos', () => {
  const { extras, total } = totalDeReserva({
    precioBloque: 28000,
    cobros: [{ nombre: 'Balón', precio: 3000 }, { nombre: 'Árbitro', precio: 12000 }],
  });
  assert.equal(extras, 15000);
  assert.equal(total, 43000);
});

test('al jugador NO se le suma ningún cargo de servicio', () => {
  // REGRESIÓN: `reservasRules` tenía un SERVICE_FEE_CLP de $1.500 sumado
  // arriba del precio. La comisión la paga el recinto (migración 62) y el
  // jugador nunca la ve. Si alguien la vuelve a sumar, esto lo caza.
  const { total } = totalDeReserva({ precioBloque: 28000, cobros: [] });
  assert.equal(total, 28000, 'el total es exactamente el precio del bloque');
});

test('totalDeReserva no revienta con entradas ausentes', () => {
  assert.deepEqual(totalDeReserva(), { cancha: 0, extras: 0, total: 0 });
  assert.deepEqual(totalDeReserva({ precioBloque: null, cobros: null }), { cancha: 0, extras: 0, total: 0 });
});

test('reservaLista exige lo mismo que el servidor: bloque, nombre y teléfono', () => {
  const base = { canchaId: 'k1', fecha: '2026-09-12', hora: '20:00', contactoNombre: 'Vicente', contactoTelefono: '987654321' };
  assert.equal(reservaLista(base), true);
  assert.equal(reservaLista({ ...base, hora: null }), false);
  assert.equal(reservaLista({ ...base, contactoNombre: 'V' }), false);
  assert.equal(reservaLista({ ...base, contactoTelefono: '  ' }), false);
  assert.equal(reservaLista({}), false);
});
