const test = require('node:test');
const assert = require('node:assert/strict');

const {
  alcanzaPara, comoBalance, comoMovimiento, detalleDeMovimiento, fechaDeMovimiento,
} = require('../saldo.js');
const { fechaLarga } = require('../recintoPantallas.js');

const carga = {
  id: 'm1', tipo: 'carga', monto: 100000, metodo_carga: 'transferencia',
  reserva_id: null, created_at: '2026-09-15T02:10:25Z',
  cancha_nombre: null, complejo_nombre: null,
};
const cobro = {
  id: 'm2', tipo: 'cobro_reserva', monto: -9000, metodo_carga: null,
  reserva_id: 'r1', created_at: '2026-09-15T02:12:31Z',
  cancha_nombre: 'Cancha 1 · Baby', complejo_nombre: 'Cancha de Prueba FutFinder',
  reserva_fecha: '2026-09-17', reserva_hora: '21:00:00',
};

test('EL SIGNO SE LEE DEL LIBRO, NO SE DECIDE ACÁ', () => {
  // El CHECK de `balance_movimientos` ya obliga a que una carga sea
  // positiva y un cobro negativo. Si esto recalculara el signo por tipo, un
  // tipo nuevo aparecería sumando cuando en realidad resta.
  assert.equal(comoMovimiento(carga).entra, true);
  assert.equal(comoMovimiento(cobro).entra, false);
  // Un tipo que este archivo no conoce se orienta por el monto, no se traga.
  const raro = comoMovimiento({ ...cobro, tipo: 'algo_nuevo' });
  assert.equal(raro.entra, false);
  assert.equal(raro.titulo, 'Movimiento');
});

test('cada movimiento dice qué fue, en chileno', () => {
  assert.equal(comoMovimiento(carga).titulo, 'Cargaste saldo');
  assert.equal(comoMovimiento(cobro).titulo, 'Pagaste tu parte');
  assert.equal(
    comoMovimiento({ ...carga, tipo: 'devolucion_cancelacion' }).titulo,
    'Te devolvimos',
  );
});

test('EL DETALLE ES LO QUE HACE RECONOCIBLE UN «-$9.000»', () => {
  assert.equal(detalleDeMovimiento(cobro), 'Cancha 1 · Baby · Cancha de Prueba FutFinder');
  assert.equal(detalleDeMovimiento(carga), 'por transferencia');
  assert.equal(detalleDeMovimiento({ ...carga, metodo_carga: 'tarjeta' }), 'con tarjeta');
});

test('un cobro sin nombre de cancha no se queda mudo', () => {
  // Pasa si la reserva se borró. Decir «Reserva de cancha» es poco, pero es
  // cierto; dejarlo vacío haría pensar que el cobro no tiene explicación.
  assert.equal(
    detalleDeMovimiento({ ...cobro, cancha_nombre: null, complejo_nombre: null }),
    'Reserva de cancha',
  );
  // Y sin nada que agregar devuelve null, no un relleno que ocupa lugar.
  assert.equal(detalleDeMovimiento({ ...carga, metodo_carga: null }), null);
});

test('una respuesta que no viene ok no se convierte en un saldo de cero', () => {
  // Es el error que ya costó una vez: `Number(objeto)` daba NaN, `NaN || 0`
  // daba 0, y la pantalla decía «tu saldo es $0» con la cuenta llena y
  // apagaba el botón de pagar.
  assert.equal(comoBalance({ ok: false, reason: 'No autenticado' }), null);
  assert.equal(comoBalance(null), null);
  assert.equal(comoBalance(undefined), null);
});

test('el balance se traduce con su lista y si quedó recortada', () => {
  const b = comoBalance({ ok: true, saldo: 91000, movimientos: [cobro, carga], total_movimientos: 2 });
  assert.equal(b.saldo, 91000);
  assert.equal(b.movimientos.length, 2);
  assert.equal(b.hayMas, false);

  const cortado = comoBalance({ ok: true, saldo: 91000, movimientos: [cobro], total_movimientos: 40 });
  assert.equal(cortado.hayMas, true);
  assert.equal(cortado.totalMovimientos, 40);
});

test('un saldo de cero es un dato, no un error', () => {
  const b = comoBalance({ ok: true, saldo: 0, movimientos: [], total_movimientos: 0 });
  assert.equal(b.saldo, 0);
  assert.deepEqual(b.movimientos, []);
  assert.equal(b.hayMas, false);
});

test('NO SABER EL SALDO NO ES «NO TE ALCANZA»', () => {
  // Con `false` en vez de `null`, un error de red apagaría el botón de
  // pagar por una razón inventada. Ya pasó.
  assert.equal(alcanzaPara(null, 9000), null);
  assert.equal(alcanzaPara(undefined, 9000), null);
  assert.equal(alcanzaPara(NaN, 9000), null);
  assert.equal(alcanzaPara(9000, null), null);

  assert.equal(alcanzaPara(91000, 9000), true);
  assert.equal(alcanzaPara(9000, 9000), true);   // justo alcanza
  assert.equal(alcanzaPara(8999, 9000), false);
  assert.equal(alcanzaPara(0, 9000), false);
});

test('LA FECHA DEL MOVIMIENTO ES UN INSTANTE, Y SE LEE EN HORA DE CHILE', () => {
  // `fechaLarga` solo entiende 'YYYY-MM-DD': con una marca de tiempo completa
  // devuelve null y la línea desaparecía sin decir por qué. Así se encontró.
  assert.equal(fechaLarga('2026-09-15T02:12:31.245553+00:00'), null);

  // Y no es solo formato: 02:12 UTC del 15 son las 23:12 del 14 en Chile.
  // Interpretarlo en UTC le mostraría el día equivocado a cualquiera que
  // mueva plata de noche, que es cuando se arman los partidos.
  const t = fechaDeMovimiento('2026-09-15T02:12:31.245553+00:00');
  assert.match(t, /14 de septiembre/);
  assert.match(t, /23:12/);
});

test('una fecha ausente o rota no inventa un texto', () => {
  assert.equal(fechaDeMovimiento(null), null);
  assert.equal(fechaDeMovimiento(''), null);
  assert.equal(fechaDeMovimiento('cualquier cosa'), null);
});

test('el movimiento ya llega con su fecha lista para pintar', () => {
  assert.match(comoMovimiento(cobro).cuandoTexto, /14 de septiembre/);
});
