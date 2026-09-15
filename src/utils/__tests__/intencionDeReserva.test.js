const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VIGENCIA_MS, calzaConElPartido, guardarIntencion, leerIntencion, olvidarIntencion,
} = require('../intencionDeReserva.js');

const T0 = 1_757_900_000_000;
const partido = { matchId: 'm1', titulo: 'chatgpt vs chatgpt2', clubRival: 'chatgpt2' };

test('la intención se guarda y se lee tal cual', () => {
  olvidarIntencion();
  assert.equal(leerIntencion(T0), null);
  guardarIntencion(partido, T0);
  assert.equal(leerIntencion(T0).matchId, 'm1');
  assert.equal(leerIntencion(T0).clubRival, 'chatgpt2');
});

test('sin partido no se guarda nada', () => {
  olvidarIntencion();
  assert.equal(guardarIntencion(null, T0), null);
  assert.equal(guardarIntencion({ titulo: 'sin id' }, T0), null);
  assert.equal(leerIntencion(T0), null);
});

test('CADUCA A LA MEDIA HORA', () => {
  // Si alguien empieza desde el desafío, se distrae y después reserva una
  // cancha cualquiera, esa reserva NO tiene por qué ser del partido.
  olvidarIntencion();
  guardarIntencion(partido, T0);
  assert.ok(leerIntencion(T0 + VIGENCIA_MS - 1));
  assert.equal(leerIntencion(T0 + VIGENCIA_MS + 1), null);
  // Y una vez caducada no revive.
  assert.equal(leerIntencion(T0), null);
});

test('se suelta a mano', () => {
  olvidarIntencion();
  guardarIntencion(partido, T0);
  olvidarIntencion();
  assert.equal(leerIntencion(T0), null);
});

test('AVISA SI LA HORA NO CALZA CON EL PARTIDO', () => {
  // No bloquea: el recinto puede no tener libre la hora exacta. Pero
  // reservar las 20:00 para un partido de las 19:00 y enterarse el día del
  // encuentro es peor que cualquier aviso.
  const hora = new Date(2026, 8, 19, 20, 0).toISOString();
  assert.equal(calzaConElPartido(hora, '2026-09-19', '20:00'), true);
  assert.equal(calzaConElPartido(hora, '2026-09-19', '21:00'), false);
  assert.equal(calzaConElPartido(hora, '2026-09-20', '20:00'), false);
});

test('sin datos para comparar no inventa un veredicto', () => {
  // `null` es «no sé», y la pantalla no debe mostrar aviso: decir «no calza»
  // sin saberlo mandaría a corregir algo que quizá está bien.
  assert.equal(calzaConElPartido(null, '2026-09-19', '20:00'), null);
  assert.equal(calzaConElPartido('2026-09-19T23:00:00Z', null, '20:00'), null);
  assert.equal(calzaConElPartido('cualquier cosa', '2026-09-19', '20:00'), null);
  assert.equal(calzaConElPartido('2026-09-19T23:00:00Z', '2026-09-19', 'tarde'), null);
});
