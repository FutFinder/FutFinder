const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FASES, accionDeFase, esperaSiguiente, faseDePago, seAcaboLaEspera,
  sigueEsperando, textoDeFase, MINUTOS_MAX_ESPERA,
} = require('../pagosCliente.js');

test('una reserva confirmada manda, venga como venga el pago', () => {
  assert.equal(faseDePago({ estado: 'pagado' }, { estado: 'confirmada' }), 'confirmada');
  // Confirmada por otro camino (saldo, o el recinto): igual es suya.
  assert.equal(faseDePago(null, { estado: 'confirmada' }), 'confirmada');
});

test('pagado pero la reserva todavía no dice nada NO es un fracaso', () => {
  // Es el instante entre las dos escrituras de `confirmar_pago`, o el aviso
  // que aún no llega. Mostrar «no se pudo» acá sería mentirle a alguien a
  // quien ya le cobraron.
  assert.equal(faseDePago({ estado: 'pagado' }, { estado: 'armando' }), 'esperando');
  assert.equal(faseDePago({ estado: 'pendiente' }, { estado: 'armando' }), 'pagando');
  assert.equal(faseDePago(null, { estado: 'armando' }), 'esperando');
});

test('pagado con la reserva rechazada es plata que hay que devolver', () => {
  assert.equal(faseDePago({ estado: 'pagado' }, { estado: 'rechazada' }), 'devolver');
  assert.equal(faseDePago({ estado: 'reversar' }, { estado: 'rechazada' }), 'devolver');
  assert.equal(faseDePago({ estado: 'reversado' }, { estado: 'rechazada' }), 'devolver');
});

test('los fracasos de verdad vienen escritos en el pago', () => {
  assert.equal(faseDePago({ estado: 'fallido' }, { estado: 'armando' }), 'rechazada');
  assert.equal(faseDePago({ estado: 'expirado' }, { estado: 'armando' }), 'expirada');
});

test('sin pago y sin reserva no hay nada que mostrar', () => {
  assert.equal(faseDePago(null, null), 'error');
});

test('solo se sigue preguntando mientras puede cambiar', () => {
  assert.equal(sigueEsperando('pagando'), true);
  assert.equal(sigueEsperando('esperando'), true);
  assert.equal(sigueEsperando('preparando'), true);
  for (const f of ['confirmada', 'devolver', 'rechazada', 'expirada', 'nodisponible', 'error']) {
    assert.equal(sigueEsperando(f), false, f);
  }
});

test('la espera arranca corta y se va soltando hasta 10 s', () => {
  assert.equal(esperaSiguiente(0), 2000);
  assert.equal(esperaSiguiente(1), 3000);
  assert.equal(esperaSiguiente(8), 10000);
  assert.equal(esperaSiguiente(500), 10000);
  // Nada de esperas negativas ni NaN por una cuenta rara.
  assert.equal(esperaSiguiente(-3), 2000);
  assert.equal(esperaSiguiente(undefined), 2000);
});

test('la espera se corta a los cinco minutos', () => {
  assert.equal(seAcaboLaEspera(0), false);
  assert.equal(seAcaboLaEspera(MINUTOS_MAX_ESPERA * 60 * 1000 - 1), false);
  assert.equal(seAcaboLaEspera(MINUTOS_MAX_ESPERA * 60 * 1000), true);
});

test('toda fase tiene texto, y el texto nunca queda vacío', () => {
  for (const f of FASES) {
    const t = textoDeFase(f);
    assert.ok(t.titulo && t.cuerpo && t.tono, f);
  }
  assert.equal(textoDeFase('inventada').titulo, textoDeFase('error').titulo);
});

test('mientras se espera no se ofrece ningún botón', () => {
  assert.equal(accionDeFase('pagando'), null);
  assert.equal(accionDeFase('esperando'), null);
  assert.equal(accionDeFase('confirmada').accion, 'inicio');
  assert.equal(accionDeFase('rechazada').accion, 'reintentar');
  assert.equal(accionDeFase('expirada').accion, 'reintentar');
  // Ojo: después de «te devolvemos» NO se ofrece reintentar el mismo
  // horario. Ya no es suyo.
  assert.equal(accionDeFase('devolver').accion, 'buscar');
});

test('el texto de «te devolvemos» dice que es completo y sin descuentos', () => {
  const t = textoDeFase('devolver');
  assert.match(t.cuerpo, /completo/i);
  assert.match(t.cuerpo, /sin descuentos/i);
});

test('el texto de rechazada dice que no se cobró nada', () => {
  assert.match(textoDeFase('rechazada').cuerpo, /no se te descontó nada/i);
  assert.match(textoDeFase('expirada').cuerpo, /no se te descontó nada/i);
});
