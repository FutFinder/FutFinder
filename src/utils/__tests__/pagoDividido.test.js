const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_JUGADORES, MIN_JUGADORES, avanceDeGrupo, comoDetalle, comoParticipante,
  cuotaPara, etiquetaDeParticipante, miAccion, motivoLegible, opcionesDeReparto,
  puedeQuitar, puedeRecordar, repartoDeCuotas,
} = require('../pagoDividido.js');
const { computeCuota } = require('../../services/reservasRules.js');

test('la cuota es la MISMA cuenta que hace el servidor', () => {
  // Si estas dos se separan un peso, el botón dice un monto y
  // `autorizar_cobro_reserva` contesta «El monto no coincide con la cuota
  // vigente». No hay forma de que el jugador entienda ese error.
  for (const [total, n] of [[18000, 3], [18001, 3], [25000, 7], [1, 2], [99999, 22]]) {
    assert.equal(cuotaPara(total, n), computeCuota(total, n), `${total}/${n}`);
  }
});

test('medidas imposibles no inventan una cuota', () => {
  // `null` y `''` incluidos a propósito: `Number()` los vuelve 0, y un 0 que
  // se cuela acá se muestra como «$0 cada uno», que parece un precio real.
  for (const [t, n] of [[null, 3], [undefined, 3], ['', 3], [18000, 1], [18000, 0],
                        [-5, 3], [NaN, 3], [18000, NaN], [18000, null]]) {
    assert.equal(cuotaPara(t, n), null, `${t}/${n}`);
  }
  assert.equal(repartoDeCuotas(null, 3), null);
});

test('el excedente del redondeo se devuelve, no se esconde', () => {
  // $18.001 entre 3 son $6.001 cada uno: $18.003, dos pesos de más. La
  // pantalla que muestra los dos números tiene que poder explicarlos.
  const r = repartoDeCuotas(18001, 3);
  assert.equal(r.cuota, 6001);
  assert.equal(r.suma, 18003);
  assert.equal(r.excedente, 2);
  // Y cuando divide exacto, no sobra nada.
  assert.equal(repartoDeCuotas(18000, 3).excedente, 0);
});

test('el redondeo nunca va contra el jugador: la suma nunca queda bajo el total', () => {
  for (let total = 9990; total <= 10010; total += 1) {
    for (let n = MIN_JUGADORES; n <= 12; n += 1) {
      assert.ok(repartoDeCuotas(total, n).suma >= total, `${total}/${n}`);
    }
  }
});

test('las opciones respetan el tope de la cancha y el mínimo de dos', () => {
  const o = opcionesDeReparto(20000, 5);
  assert.equal(o[0].n, MIN_JUGADORES);
  assert.equal(o[o.length - 1].n, 5);
  // Un tope absurdo se corta en el máximo, no explota.
  assert.equal(opcionesDeReparto(20000, 999).length, MAX_JUGADORES - MIN_JUGADORES + 1);
  assert.equal(opcionesDeReparto(20000, 0).length, 1);
});

const DET = (extra = {}) => comoDetalle({
  ok: true,
  reserva: {
    id: 'r1', fecha: '2026-09-20', hora_inicio: '19:00:00', hora_fin: '20:00:00',
    estado: 'armando', modalidad: 'jugadores', medio_pago: 'balance',
    precio_total: 18000, n_jugadores: 3, cuota: 6000, organizador_id: 'u1',
  },
  cancha: { nombre: 'Cancha 1', complejo_nombre: 'Los Mojojo' },
  soy_organizador: true, mi_estado: 'aceptado', mi_listo: true,
  participantes: [], cupos: 3, listos: 1, en_reserva: 3,
  faltan_invitar: 0, faltan_autorizar: 2,
  ...extra,
});

test('una respuesta que no viene ok no se convierte en un detalle a medias', () => {
  // Devolver un objeto con todo en `undefined` dejaría la pantalla pintando
  // «0 de 0» como si fuera un dato real.
  assert.equal(comoDetalle({ ok: false, reason: 'Esta reserva no es tuya' }), null);
  assert.equal(comoDetalle(null), null);
});

test('el avance se cuenta, y se dice de la forma que anima a seguir', () => {
  assert.equal(avanceDeGrupo(DET()).texto, '1 de 3 pusieron su parte');
  assert.equal(avanceDeGrupo(DET({ listos: 3, faltan_autorizar: 0 })).completo, true);
  assert.equal(avanceDeGrupo(DET({ listos: 3, faltan_autorizar: 0 })).texto, 'Todos pusieron su parte');
  // Recién creada: lo primero no es «0 de 3», es a cuánta gente invitar.
  assert.equal(
    avanceDeGrupo(DET({ listos: 0, en_reserva: 1, faltan_invitar: 2, faltan_autorizar: 3 })).texto,
    'Invita a 2 jugadores más',
  );
  assert.equal(
    avanceDeGrupo(DET({ listos: 0, en_reserva: 2, faltan_invitar: 1, faltan_autorizar: 3 })).texto,
    'Invita a 1 jugador más',
  );
});

test('LA ACCIÓN ES UNA SOLA, Y DEPENDE DE QUIÉN MIRA', () => {
  // La pantalla del organizador y la del invitado son la misma; esto es lo
  // único que cambia. Si devolviera varias, las dos mitades competirían por
  // el mismo botón de abajo.
  assert.equal(miAccion(DET({ mi_listo: false, mi_estado: 'pendiente' })).clave, 'autorizar');
  assert.match(miAccion(DET({ mi_listo: false, mi_estado: 'pendiente' })).label, /\$6\.000/);
  // Ya puso lo suyo y falta invitar: el organizador invita.
  assert.equal(miAccion(DET({ faltan_invitar: 1 })).clave, 'invitar');
  // Ya puso lo suyo y están todos invitados: solo queda esperar.
  assert.equal(miAccion(DET()).clave, 'esperar');
  // Al invitado nunca se le ofrece invitar, aunque falte gente.
  assert.equal(miAccion(DET({ soy_organizador: false, faltan_invitar: 1 })).clave, 'esperar');
});

test('una reserva confirmada o muerta no ofrece poner plata', () => {
  const conf = comoDetalle({ ok: true, reserva: { estado: 'confirmada', cuota: 6000 }, cancha: {},
    participantes: [], cupos: 3, listos: 3 });
  assert.equal(miAccion(conf).clave, 'listo');
  const vencida = comoDetalle({ ok: true, reserva: { estado: 'vencida', cuota: 6000 }, cancha: {},
    participantes: [], cupos: 3, listos: 1 });
  assert.equal(miAccion(vencida), null);
});

test('el que rechazó no vuelve a ver el botón de pagar', () => {
  assert.equal(miAccion(DET({ soy_organizador: false, mi_listo: false, mi_estado: 'rechazado' })).clave, 'esperar');
});

test('las etiquetas distinguen «no contestó» de «su monto ya no sirve»', () => {
  // Los dos están sin autorización vigente, pero uno no hizo nada y el otro
  // aceptó y quedó desactualizado por un recálculo de cuota. Decirles lo
  // mismo haría que el segundo no entienda por qué lo apuran.
  const p = (x) => comoParticipante({ user_id: 'u', username: 'a', rol: 'jugador', ...x });
  assert.equal(etiquetaDeParticipante(p({ estado: 'pendiente', listo: false })).texto, 'Falta que confirme');
  assert.equal(etiquetaDeParticipante(p({ estado: 'aceptado', listo: false })).texto, 'Falta reconfirmar');
  assert.equal(etiquetaDeParticipante(p({ estado: 'aceptado', listo: true })).texto, 'Puso su parte');
  assert.equal(etiquetaDeParticipante(p({ estado: 'rechazado', listo: false })).texto, 'No va');
});

test('empujar y sacar son del organizador, y solo mientras se arma', () => {
  assert.equal(puedeRecordar(DET()), true);
  assert.equal(puedeRecordar(DET({ soy_organizador: false })), false);
  assert.equal(puedeRecordar(DET({ faltan_autorizar: 0 })), false);
  // Solo, sin nadie a quien recordarle.
  assert.equal(puedeRecordar(DET({ en_reserva: 1 })), false);

  const otro = comoParticipante({ user_id: 'u2', username: 'b', rol: 'jugador', estado: 'pendiente' });
  const yo = comoParticipante({ user_id: 'u1', username: 'a', rol: 'organizador', soy_yo: true });
  assert.equal(puedeQuitar(DET(), otro), true);
  assert.equal(puedeQuitar(DET(), yo), false);
  assert.equal(puedeQuitar(DET({ soy_organizador: false }), otro), false);
});

test('«ocupado» dice primero lo único que tranquiliza', () => {
  // La persona hizo todo bien y perdió la hora igual. Lo primero que
  // necesita saber es que no le cobraron.
  assert.match(motivoLegible('ocupado'), /No se te cobró nada/);
  assert.match(motivoLegible('saldo_insuficiente'), /Todavía no se cobró nada/);
  assert.match(motivoLegible('error_al_confirmar'), /No se cobró nada/);
  // Un motivo que no está en la tabla se muestra tal cual, no se traga.
  assert.equal(motivoLegible('algo_nuevo_del_servidor'), 'algo_nuevo_del_servidor');
  assert.equal(motivoLegible(null), null);
});
