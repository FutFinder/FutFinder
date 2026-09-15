const test = require('node:test');
const assert = require('node:assert/strict');

const {
  accionesDeReserva, comoReserva, enlaceDeMapa, etiquetaDeEstado,
  separaReservas, textoDeCancelacion,
} = require('../misReservas.js');

const AHORA = new Date('2026-09-14T18:00:00Z');
const r = (extra) => ({
  id: extra.id || 'x', estado: 'confirmada', soyOrganizador: true,
  medioPago: 'tarjeta', puedeCancelar: true, ...extra,
});

test('«próxima» es que todavía va a pasar, no solo que la fecha sea futura', () => {
  // Una cancelada del sábado que viene no es una próxima: no hay que ir, y
  // ponerla ahí haría que alguien cuente con una cancha que no tiene.
  const lista = [
    r({ id: 'futura-viva', inicio: '2026-09-20T18:00:00Z', estado: 'confirmada' }),
    r({ id: 'futura-cancelada', inicio: '2026-09-21T18:00:00Z', estado: 'cancelada' }),
    r({ id: 'pasada', inicio: '2026-09-10T18:00:00Z', estado: 'confirmada' }),
  ];
  const { proximas, historial } = separaReservas(lista, AHORA);
  assert.deepEqual(proximas.map((x) => x.id), ['futura-viva']);
  assert.deepEqual(historial.map((x) => x.id), ['futura-cancelada', 'pasada']);
});

test('las próximas van de la más cercana; el historial, de la más reciente', () => {
  const lista = [
    r({ id: 'lejana', inicio: '2026-09-30T18:00:00Z' }),
    r({ id: 'cercana', inicio: '2026-09-15T18:00:00Z' }),
    r({ id: 'vieja', inicio: '2026-08-01T18:00:00Z', estado: 'cancelada' }),
    r({ id: 'menos-vieja', inicio: '2026-09-01T18:00:00Z', estado: 'cancelada' }),
  ];
  const { proximas, historial } = separaReservas(lista, AHORA);
  assert.deepEqual(proximas.map((x) => x.id), ['cercana', 'lejana']);
  assert.deepEqual(historial.map((x) => x.id), ['menos-vieja', 'vieja']);
});

test('una reserva sin fecha usable no se cuela entre las próximas', () => {
  const { proximas, historial } = separaReservas([r({ id: 'rota', inicio: null })], AHORA);
  assert.equal(proximas.length, 0);
  assert.equal(historial.length, 1);
});

test('lista vacía o con huecos no revienta', () => {
  assert.deepEqual(separaReservas([], AHORA), { proximas: [], historial: [] });
  assert.deepEqual(separaReservas([null, undefined], AHORA), { proximas: [], historial: [] });
  assert.deepEqual(separaReservas(undefined, AHORA), { proximas: [], historial: [] });
});

test('«procesando» se le muestra al jugador como «Falta pagar»', () => {
  // Nadie sabe qué es «procesando». Lo que hay que saber es que la hora NO
  // es suya hasta que pague.
  assert.equal(etiquetaDeEstado({ estado: 'procesando' }).texto, 'Falta pagar');
  assert.equal(etiquetaDeEstado({ estado: 'confirmada' }).texto, 'Confirmada');
  assert.equal(etiquetaDeEstado({ estado: 'rechazada' }).tono, 'red');
  assert.equal(etiquetaDeEstado({ estado: 'inventado' }).texto, 'inventado');
  assert.equal(etiquetaDeEstado(null).texto, '—');
});

test('a un invitado no se le ofrece pagar ni cancelar el partido de otro', () => {
  const invitado = r({ estado: 'procesando', soyOrganizador: false });
  assert.deepEqual(accionesDeReserva(invitado), []);
});

test('sin pagar se ofrece pagar y cancelar; confirmada, solo cancelar', () => {
  const sinPagar = accionesDeReserva(r({ estado: 'procesando' }));
  assert.deepEqual(sinPagar.map((a) => a.clave), ['pagar', 'cancelar']);
  const confirmada = accionesDeReserva(r({ estado: 'confirmada' }));
  assert.deepEqual(confirmada.map((a) => a.clave), ['cancelar']);
});

test('fuera de la ventana no se ofrece cancelar', () => {
  assert.deepEqual(accionesDeReserva(r({ estado: 'confirmada', puedeCancelar: false })), []);
});

test('una reserva por Balance no ofrece «continuar al pago» con tarjeta', () => {
  const porBalance = accionesDeReserva(r({ estado: 'armando', medioPago: 'balance' }));
  assert.deepEqual(porBalance.map((a) => a.clave), ['cancelar']);
});

test('el texto de cancelación dice la regla entera cuando ya se cerró', () => {
  // Es donde alguien reclama, así que no puede quedar en «no se puede».
  const cerrada = textoDeCancelacion(r({ estado: 'confirmada', puedeCancelar: false }));
  assert.match(cerrada, /12 horas/);
  const abierta = textoDeCancelacion(r({ estado: 'confirmada', puedeCancelar: true }));
  assert.match(abierta, /devolución/);
  const sinPagar = textoDeCancelacion(r({ estado: 'procesando', puedeCancelar: true }));
  assert.match(sinPagar, /no pagas/i);
  assert.equal(textoDeCancelacion(r({ estado: 'cancelada', puedeCancelar: false })), null);
});

test('el enlace del mapa usa las coordenadas y, si no hay, la dirección', () => {
  assert.match(enlaceDeMapa({ latitud: -33.5, longitud: -70.7 }), /query=-33\.5,-70\.7/);
  const porTexto = enlaceDeMapa({ complejoNombre: 'Cancha Norte', direccion: 'Calle 1', comuna: 'Maipú' });
  assert.match(porTexto, /Cancha%20Norte/);
  assert.equal(enlaceDeMapa({}), null);
  assert.equal(enlaceDeMapa(null), null);
});

test('la fila del servidor se traduce sin perder nada importante', () => {
  const fila = comoReserva({
    id: 'a', fecha: '2026-09-20', hora_inicio: '19:00:00', hora_fin: '20:00:00',
    inicio: '2026-09-20T23:00:00Z', estado: 'confirmada', modalidad: 'completa',
    medio_pago: 'tarjeta', precio_total: 18000, soy_organizador: true,
    cancha_nombre: 'Cancha 1', complejo_nombre: 'Norte', complejo_direccion: 'Calle 1',
    pago_estado: 'pagado', cobros: [{ nombre: 'Petos', precio: 2000 }],
    puede_cancelar: true, cancelacion_hasta: '2026-09-20T11:00:00Z',
  });
  assert.equal(fila.horaInicio, '19:00');
  assert.equal(fila.horaFin, '20:00');
  assert.equal(fila.soyOrganizador, true);
  assert.equal(fila.pagoEstado, 'pagado');
  assert.deepEqual(fila.cobros, [{ nombre: 'Petos', precio: 2000 }]);
  assert.equal(comoReserva(null), null);
  // Sin cobros, una lista vacía y no `undefined`: la pantalla la recorre.
  assert.deepEqual(comoReserva({ id: 'b' }).cobros, []);
});

/* ── Reservas divididas (migración 90) ─────────────────────────── */

const dividida = (extra) => ({
  id: 'd1', estado: 'armando', soyOrganizador: true, medioPago: 'balance',
  puedeCancelar: true, cupos: 3, listos: 1, miEstado: 'aceptado', ...extra,
});

test('en una dividida la insignia muestra el avance, no la palabra', () => {
  // «Armando el grupo» no dice si falta uno o faltan cinco. «1 de 3» sí, y es
  // lo único que la persona quiere saber de un vistazo en la lista.
  assert.equal(etiquetaDeEstado(dividida()).texto, '1 de 3');
  assert.equal(etiquetaDeEstado(dividida({ listos: 3 })).texto, '3 de 3');
  // Una reserva normal en 'armando' no tiene avance que mostrar.
  assert.equal(etiquetaDeEstado(dividida({ cupos: 1 })).texto, 'Armando el grupo');
  // Y una ya confirmada muestra su estado, no el conteo.
  assert.equal(etiquetaDeEstado(dividida({ estado: 'confirmada' })).texto, 'Confirmada');
});

test('EL INVITADO TAMBIÉN ENTRA AL GRUPO, aunque no organice', () => {
  // Es la única acción que no es del organizador. Sin ella el invitado ve la
  // reserva en su lista y no tiene por dónde poner su parte: el flujo entero
  // se corta ahí.
  const inv = dividida({ soyOrganizador: false, miEstado: 'pendiente' });
  const claves = accionesDeReserva(inv).map((a) => a.clave);
  assert.deepEqual(claves, ['grupo']);
  assert.equal(accionesDeReserva(inv)[0].label, 'Poner mi parte');
  // Y al que ya puso lo suyo se le ofrece mirar, no pagar de nuevo.
  assert.equal(accionesDeReserva(dividida({ soyOrganizador: false }))[0].label, 'Ver el grupo');
});

test('al organizador de una dividida se le ofrece el grupo y cancelar', () => {
  const claves = accionesDeReserva(dividida()).map((a) => a.clave);
  assert.deepEqual(claves, ['grupo', 'cancelar']);
  // Confirmada ya no se entra a armar nada.
  assert.deepEqual(
    accionesDeReserva(dividida({ estado: 'confirmada' })).map((a) => a.clave),
    ['cancelar'],
  );
});

test('una reserva normal no cambió: el invitado sigue sin acciones', () => {
  assert.deepEqual(accionesDeReserva(r({ soyOrganizador: false })), []);
});
