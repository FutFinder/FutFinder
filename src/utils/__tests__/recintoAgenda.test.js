/**
 * Pruebas de la lógica pura del lado del recinto (migraciones 60, 61 y 62).
 *
 * Tres cosas que se prueban acá porque el servidor las delegó al cliente a
 * propósito, o porque el diseño ya se equivocó con ellas una vez:
 *
 *   · Una reserva sin confirmar NO ocupa el horario. Es la regla central del
 *     vertical y el diseño la contó al revés dos veces.
 *   · «Ya se jugó» se calcula en hora LOCAL: la migración 61 no lo resuelve en
 *     Postgres porque `now()` es UTC y en Chile eso corre el corte un día.
 *   · La comisión se LEE congelada, nunca se recalcula.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  comoResultadoRecinto,
  comoListaRecinto,
  fechaHoraLocal,
  terminoLocal,
  yaSeJugo,
  estadoOperativo,
  avancePago,
  desgloseComision,
  intercalarAgenda,
  estadoDeBloque,
  resumenDelPanel,
} = require('../recintoAgenda.js');

// ---------------------------------------------------------------------------
// Normalización de respuestas
// ---------------------------------------------------------------------------

test('comoResultadoRecinto: un error de excepción conserva el mensaje del servidor', () => {
  // Las RPC admin_* levantan `raise exception` con el texto ya redactado en
  // español; hay que mostrarlo tal cual, no reemplazarlo por uno genérico.
  const { data, error } = comoResultadoRecinto(null, { message: 'No administras este complejo' });
  assert.equal(data, null);
  assert.equal(error.message, 'No administras este complejo');
});

test('comoResultadoRecinto: un error sin mensaje igual produce algo legible', () => {
  const { error } = comoResultadoRecinto(null, {});
  assert.ok(error.message.length > 0);
  assert.ok(!error.message.includes('undefined'));
});

test('comoResultadoRecinto: un {ok:false} se lee como rechazo de negocio', () => {
  const { data, error } = comoResultadoRecinto({ ok: false, reason: 'Cancha no existe' }, null);
  assert.equal(data, null);
  assert.equal(error.message, 'Cancha no existe');
});

test('comoResultadoRecinto: un {ok:true} devuelve la fila y ningún error', () => {
  const { data, error } = comoResultadoRecinto({ ok: true, slots: [] }, null);
  assert.equal(error, null);
  assert.deepEqual(data.slots, []);
});

test('comoListaRecinto: una tabla con varios recintos NO se recorta al primero', () => {
  // REGRESIÓN: usar comoResultadoRecinto acá devolvería solo data[0], y el
  // síntoma sería "administro un recinto" en vez de un error visible.
  const { data, error } = comoListaRecinto([{ id: 'a' }, { id: 'b' }, { id: 'c' }], null);
  assert.equal(error, null);
  assert.equal(data.length, 3);
});

test('comoListaRecinto: sin recintos devuelve lista vacía, no un error', () => {
  const { data, error } = comoListaRecinto([], null);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

// ---------------------------------------------------------------------------
// Hora local: la parte que la migración 61 dejó al cliente
// ---------------------------------------------------------------------------

test('fechaHoraLocal: construye la fecha en hora LOCAL y no en UTC', () => {
  // `new Date('2027-03-01')` sería medianoche UTC — en Chile, el 28 de febrero
  // a las 21:00. Este es el error que se está evitando.
  const d = fechaHoraLocal('2027-03-01', '18:00');
  assert.equal(d.getFullYear(), 2027);
  assert.equal(d.getMonth(), 2); // marzo
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 18);
  assert.equal(d.getMinutes(), 0);
});

test('fechaHoraLocal: datos incompletos o basura devuelven null, no una fecha inválida', () => {
  assert.equal(fechaHoraLocal(null, '18:00'), null);
  assert.equal(fechaHoraLocal('2027-03-01', null), null);
  assert.equal(fechaHoraLocal('no-es-fecha', '18:00'), null);
});

test('terminoLocal: un bloque normal termina el mismo día', () => {
  const fin = terminoLocal({ fecha: '2027-03-01', hora_inicio: '18:00', hora_fin: '19:00' });
  assert.equal(fin.getDate(), 1);
  assert.equal(fin.getHours(), 19);
});

test('terminoLocal: un bloque que cruza la medianoche termina al día SIGUIENTE', () => {
  // Postgres devuelve '00:00' para un bloque de 23:00 que dura una hora
  // (`time '23:00' + interval '1 hour'` da '00:00', no '24:00'). Sin este
  // ajuste el partido se consideraría terminado 23 horas antes de empezar.
  const fin = terminoLocal({ fecha: '2027-03-01', hora_inicio: '23:00', hora_fin: '00:00' });
  assert.equal(fin.getDate(), 2);
  assert.equal(fin.getHours(), 0);
});

test('yaSeJugo: antes del término, no', () => {
  const r = { fecha: '2027-03-01', hora_inicio: '18:00', hora_fin: '19:00' };
  assert.equal(yaSeJugo(r, new Date(2027, 2, 1, 18, 30)), false);
});

test('yaSeJugo: después del término, sí', () => {
  const r = { fecha: '2027-03-01', hora_inicio: '18:00', hora_fin: '19:00' };
  assert.equal(yaSeJugo(r, new Date(2027, 2, 1, 19, 1)), true);
});

test('yaSeJugo: exactamente en el minuto de término todavía NO se jugó', () => {
  const r = { fecha: '2027-03-01', hora_inicio: '18:00', hora_fin: '19:00' };
  assert.equal(yaSeJugo(r, new Date(2027, 2, 1, 19, 0)), false);
});

test('yaSeJugo: el partido que cruza la medianoche no se marca jugado antes de tiempo', () => {
  const r = { fecha: '2027-03-01', hora_inicio: '23:00', hora_fin: '00:00' };
  assert.equal(yaSeJugo(r, new Date(2027, 2, 1, 23, 30)), false);
  assert.equal(yaSeJugo(r, new Date(2027, 2, 2, 0, 30)), true);
});

// ---------------------------------------------------------------------------
// Estado operativo
// ---------------------------------------------------------------------------

test('estadoOperativo: una confirmada que ya terminó es «jugada»', () => {
  const r = { estado: 'confirmada', fecha: '2027-03-01', hora_inicio: '18:00', hora_fin: '19:00' };
  assert.equal(estadoOperativo(r, new Date(2027, 2, 2, 10, 0)), 'jugada');
});

test('estadoOperativo: una confirmada futura sigue «confirmada»', () => {
  const r = { estado: 'confirmada', fecha: '2027-03-01', hora_inicio: '18:00', hora_fin: '19:00' };
  assert.equal(estadoOperativo(r, new Date(2027, 1, 20, 10, 0)), 'confirmada');
});

test('estadoOperativo: armando y procesando son ambas «en_curso»', () => {
  const base = { fecha: '2027-03-01', hora_inicio: '18:00', hora_fin: '19:00' };
  assert.equal(estadoOperativo({ ...base, estado: 'armando' }), 'en_curso');
  assert.equal(estadoOperativo({ ...base, estado: 'procesando' }), 'en_curso');
});

test('estadoOperativo: una cancelada queda cancelada aunque la hora ya pasó', () => {
  const r = { estado: 'cancelada', fecha: '2027-03-01', hora_inicio: '18:00', hora_fin: '19:00' };
  assert.equal(estadoOperativo(r, new Date(2027, 2, 5, 10, 0)), 'cancelada');
});

// ---------------------------------------------------------------------------
// LA REGLA CENTRAL: sin confirmar no ocupa el horario
// ---------------------------------------------------------------------------

test('estadoDeBloque: un bloque con un grupo juntando la plata SIGUE DISPONIBLE', () => {
  // Es la regla central del vertical (migración 55) y el diseño la contó al
  // revés dos veces («la hora queda tomada»). El servidor devuelve
  // estado 'libre' con grupos_en_curso > 0 justamente para poder decir la
  // verdad: hay gente armando, pero cualquiera puede tomar esa hora.
  const b = estadoDeBloque({ estado: 'libre', grupos_en_curso: 1 });
  assert.equal(b.disponible, true, 'la hora sigue disponible para otros grupos');
  assert.equal(b.hayGrupoArmando, true, 'y además hay que avisar que hay un grupo armando');
});

test('estadoDeBloque: un bloque libre sin nadie armando no muestra el aviso', () => {
  const b = estadoDeBloque({ estado: 'libre', grupos_en_curso: 0 });
  assert.equal(b.disponible, true);
  assert.equal(b.hayGrupoArmando, false);
});

test('estadoDeBloque: reservada no está disponible', () => {
  const b = estadoDeBloque({ estado: 'reservada', reserva: { id: 'r1' } });
  assert.equal(b.disponible, false);
  assert.equal(b.reserva.id, 'r1');
});

test('estadoDeBloque: bloqueada no está disponible y conserva el motivo', () => {
  const b = estadoDeBloque({ estado: 'bloqueada', bloqueo: { motivo: 'Mantención' } });
  assert.equal(b.disponible, false);
  assert.equal(b.bloqueo.motivo, 'Mantención');
});

test('avancePago: 8 de 10 deja 2 por pagar y no está completo', () => {
  const a = avancePago({ participantes_total: 10, participantes_aceptados: 8 });
  assert.deepEqual(a, { aceptados: 8, total: 10, faltan: 2, completo: false });
});

test('avancePago: en pago único no aplica', () => {
  assert.equal(avancePago({ participantes_total: 0 }), null);
});

// ---------------------------------------------------------------------------
// Comisión: se lee congelada, nunca se recalcula
// ---------------------------------------------------------------------------

test('desgloseComision: lee los números congelados y no aplica ningún porcentaje', () => {
  // El monto viene de la fila (migración 62). Si esto calculara 5% por su
  // cuenta, el día que la tasa cambie las reservas viejas mostrarían un
  // número que nunca se cobró.
  const d = desgloseComision({ estado: 'confirmada', comision_base: 43000, comision: 2150 });
  assert.deepEqual(d, { bruto: 43000, comision: 2150, neto: 40850, cobrada: true });
});

test('desgloseComision: respeta un monto que NO es el 5% (piso o techo aplicados)', () => {
  // $12.000 paga el piso de $1.000, que es 8,3% — no el 5%.
  const piso = desgloseComision({ estado: 'confirmada', comision_base: 12000, comision: 1000 });
  assert.equal(piso.comision, 1000);
  assert.equal(piso.neto, 11000);
  // $60.000 topa en $2.500, que es 4,2%.
  const techo = desgloseComision({ estado: 'confirmada', comision_base: 60000, comision: 2500 });
  assert.equal(techo.comision, 2500);
  assert.equal(techo.neto, 57500);
});

test('desgloseComision: una reserva cancelada no cobra comisión', () => {
  const d = desgloseComision({ estado: 'cancelada', comision_base: 28000, comision: 1400 });
  assert.equal(d.comision, 0, 'si se cancela no se cobra, sin importar quién canceló');
  assert.equal(d.neto, 28000);
  assert.equal(d.cobrada, false);
});

test('desgloseComision: una reserva anterior a la migración 62 cae en precio_total', () => {
  const d = desgloseComision({ estado: 'confirmada', precio_total: 28000 });
  assert.equal(d.bruto, 28000);
  assert.equal(d.comision, 0);
});

// ---------------------------------------------------------------------------
// Armado de la agenda
// ---------------------------------------------------------------------------

test('intercalarAgenda: mezcla reservas y bloqueos en orden cronológico', () => {
  const items = intercalarAgenda(
    [{ hora_inicio: '18:00', id: 'r1' }, { hora_inicio: '10:00', id: 'r2' }],
    [{ hora_inicio: '14:00', id: 'b1' }]
  );
  assert.deepEqual(items.map((i) => i.hora), ['10:00', '14:00', '18:00']);
  assert.deepEqual(items.map((i) => i.tipo), ['reserva', 'bloqueo', 'reserva']);
});

test('intercalarAgenda: a la misma hora, la reserva va antes que el bloqueo', () => {
  const items = intercalarAgenda([{ hora_inicio: '14:00' }], [{ hora_inicio: '14:00' }]);
  assert.deepEqual(items.map((i) => i.tipo), ['reserva', 'bloqueo']);
});

test('intercalarAgenda: sin nada devuelve lista vacía y no revienta', () => {
  assert.deepEqual(intercalarAgenda(), []);
  assert.deepEqual(intercalarAgenda(null, null), []);
});

test('resumenDelPanel: traduce los contadores y el dinero del resumen', () => {
  const r = resumenDelPanel({
    reservas_confirmadas: 3, reservas_en_curso: 1, reservas_canceladas: 0,
    bloqueos: 2, canchas_activas: 3, canchas_total: 4,
    monto_confirmado: 84000, comision_confirmada: 4200, neto_confirmado: 79800,
  });
  assert.equal(r.reservasConfirmadas, 3);
  assert.equal(r.canchasActivas, 3);
  assert.equal(r.bruto, 84000);
  assert.equal(r.comision, 4200);
  assert.equal(r.neto, 79800);
});

test('resumenDelPanel: un resumen en cero no produce NaN en ninguna parte', () => {
  const r = resumenDelPanel({});
  Object.entries(r).forEach(([k, v]) => {
    assert.ok(Number.isFinite(v), `${k} debería ser un número, es ${v}`);
  });
});

// ---------------------------------------------------------------------------
// Tarifas por franja: el borde semiabierto
// ---------------------------------------------------------------------------

const { horaAMinutos, minutosAHora, bloquesDeTarifa } = require('../recintoAgenda.js');

test('horaAMinutos y minutosAHora son inversas', () => {
  assert.equal(horaAMinutos('11:00'), 660);
  assert.equal(horaAMinutos('21:30'), 1290);
  assert.equal(minutosAHora(660), '11:00');
  assert.equal(minutosAHora(1290), '21:30');
  assert.equal(minutosAHora(540), '09:00');
});

test('horaAMinutos: basura devuelve null y no NaN', () => {
  assert.equal(horaAMinutos(null), null);
  assert.equal(horaAMinutos('no-es-hora'), null);
});

test('bloquesDeTarifa: MaiClub · la tarifa barata son cinco bloques, 11 a 15', () => {
  // El caso real: abre 11:00, cierra 22:00, bloques de 60 min, tarifa
  // 11:00-16:00. El bloque de las 16:00 queda AFUERA aunque la tarifa llegue
  // hasta las 16:00 — es el borde semiabierto de la migración 64.
  const r = bloquesDeTarifa({
    horaDesde: '11:00', horaHasta: '16:00',
    horaApertura: '11:00', horaCierre: '22:00', duracionSlotMin: 60,
  });
  assert.deepEqual(r.dentro, ['11:00', '12:00', '13:00', '14:00', '15:00']);
  assert.equal(r.elDelBorde, '16:00', 'el de las 16:00 es el que se muestra en punteado');
});

test('bloquesDeTarifa: MaiClub · la tarifa de noche son seis bloques, 16 a 21', () => {
  const r = bloquesDeTarifa({
    horaDesde: '16:00', horaHasta: '22:00',
    horaApertura: '11:00', horaCierre: '22:00', duracionSlotMin: 60,
  });
  assert.deepEqual(r.dentro, ['16:00', '17:00', '18:00', '19:00', '20:00', '21:00']);
  assert.equal(r.elDelBorde, null, 'termina donde cierra la cancha: no hay bloque del borde');
});

test('bloquesDeTarifa: los dos tramos suman los 11 bloques del día, sin repetir ninguno', () => {
  const base = { horaApertura: '11:00', horaCierre: '22:00', duracionSlotMin: 60 };
  const barata = bloquesDeTarifa({ ...base, horaDesde: '11:00', horaHasta: '16:00' }).dentro;
  const noche = bloquesDeTarifa({ ...base, horaDesde: '16:00', horaHasta: '22:00' }).dentro;
  assert.equal(barata.length + noche.length, 11);
  assert.equal(new Set([...barata, ...noche]).size, 11, 'ningún bloque en dos tarifas a la vez');
});

test('bloquesDeTarifa: con bloques de 90 min cambian qué bloques caen en cada tarifa', () => {
  // Es la pregunta que dejó abierta el diseño: cambiar la duración mueve el
  // reparto. Con 90 min desde las 11:00 los inicios son 11:00, 12:30, 14:00,
  // 15:30, 17:00, 18:30, 20:00 — y el de 15:30 sigue siendo barato.
  const r = bloquesDeTarifa({
    horaDesde: '11:00', horaHasta: '16:00',
    horaApertura: '11:00', horaCierre: '22:00', duracionSlotMin: 90,
  });
  assert.deepEqual(r.dentro, ['11:00', '12:30', '14:00', '15:30']);
  assert.equal(r.elDelBorde, null, 'ningún bloque empieza exactamente a las 16:00');
});

test('bloquesDeTarifa: el último bloque tiene que TERMINAR antes del cierre', () => {
  // Cierra 22:00 con bloques de 60: el último empieza 21:00, no 22:00.
  const r = bloquesDeTarifa({
    horaDesde: '11:00', horaHasta: '23:00',
    horaApertura: '11:00', horaCierre: '22:00', duracionSlotMin: 60,
  });
  assert.equal(r.dentro[r.dentro.length - 1], '21:00');
  assert.equal(r.dentro.length, 11);
});

test('bloquesDeTarifa: una tarifa fuera del horario de la cancha no cubre nada', () => {
  const r = bloquesDeTarifa({
    horaDesde: '06:00', horaHasta: '09:00',
    horaApertura: '11:00', horaCierre: '22:00', duracionSlotMin: 60,
  });
  assert.deepEqual(r.dentro, []);
});

test('bloquesDeTarifa: datos incompletos devuelven vacío y no revientan', () => {
  assert.deepEqual(bloquesDeTarifa(), { dentro: [], elDelBorde: null });
  assert.deepEqual(bloquesDeTarifa({ horaDesde: '11:00' }), { dentro: [], elDelBorde: null });
  assert.deepEqual(
    bloquesDeTarifa({ horaDesde: '11:00', horaHasta: '16:00', horaApertura: '11:00', horaCierre: '22:00', duracionSlotMin: 0 }),
    { dentro: [], elDelBorde: null }
  );
});

// ---------------------------------------------------------------------------
// Contacto de la reserva
// ---------------------------------------------------------------------------

const { formatoTelefono, enlacesDeContacto } = require('../recintoAgenda.js');

test('formatoTelefono: el guardado se muestra como se lee en Chile', () => {
  assert.equal(formatoTelefono('+56987654321'), '+56 9 8765 4321');
});

test('formatoTelefono: sin teléfono devuelve null, y algo raro se muestra tal cual', () => {
  assert.equal(formatoTelefono(null), null);
  assert.equal(formatoTelefono(''), null);
  assert.equal(formatoTelefono('+1 555 0100'), '+1 555 0100', 'mejor un número raro que «undefined»');
});

test('enlacesDeContacto: arma el tel: y el de WhatsApp desde el número guardado', () => {
  const c = enlacesDeContacto({ contacto_nombre: 'Matías Correa', contacto_telefono: '+56987654321' });
  assert.equal(c.nombre, 'Matías Correa');
  assert.equal(c.telefonoLegible, '+56 9 8765 4321');
  assert.equal(c.llamar, 'tel:+56987654321');
  assert.equal(c.whatsapp, 'https://wa.me/56987654321', 'wa.me va sin el + ni espacios');
});

test('enlacesDeContacto: fuera de la ventana de 12 h no hay contacto, y eso NO es un error', () => {
  // El servidor devuelve el contacto en null cuando la ventana se cerró o la
  // reserva se canceló. La pantalla ahí muestra solo el @usuario.
  assert.equal(enlacesDeContacto({ contacto_nombre: null, contacto_telefono: null }), null);
  assert.equal(enlacesDeContacto({}), null);
  assert.equal(enlacesDeContacto(null), null);
});
