/**
 * Pruebas de la lógica de las pantallas del recinto.
 *
 * Cuatro cosas que se prueban acá porque se rompen en silencio:
 *
 *   · Las fechas se arman en hora LOCAL. Un `toISOString()` a las 21:30 en
 *     Chile devuelve el día siguiente, y el bug se ve como «la agenda muestra
 *     mañana» solo después de las 21:00.
 *   · La regla semiabierta al ocupar horas: es la misma del servidor y de las
 *     tarifas, y confunde a todo el mundo la primera vez.
 *   · Una reserva sin confirmar NO ocupa el horario, así que no cuenta como
 *     choque.
 *   · El teléfono se normaliza igual que en Postgres.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fechaISO,
  desdeISO,
  hoyISO,
  sumarDias,
  semanaDe,
  diaCorto,
  numeroDeDia,
  fechaLarga,
  fechaRelativa,
  rotuloDeSemana,
  duracionEnMinutos,
  etiquetaDuracion,
  resumenDeAgenda,
  etiquetaDeReserva,
  haceCuanto,
  motivoDeCancelacionValido,
  horasElegibles,
  bloquesEnRango,
  reservasQueChocan,
  rangoSinChoque,
  etiquetaOcupar,
  DIAS_SEMANA,
  horasDelReloj,
  rangosSeCruzan,
  choqueDeHorario,
  horariosDelDia,
  rangoLegible,
  normalizaTelefonoCl,
  telefonoAceptable,
} = require('../recintoPantallas.js');

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

test('fechaISO usa la fecha LOCAL, no la UTC', () => {
  // 21:30 del 9 de septiembre en un huso negativo ya es el 10 en UTC. Si esto
  // usara toISOString(), la agenda de la noche mostraría el día siguiente.
  const nocheDelNueve = new Date(2026, 8, 9, 21, 30, 0);
  assert.equal(fechaISO(nocheDelNueve), '2026-09-09');
});

test('fechaISO rellena mes y día con cero', () => {
  assert.equal(fechaISO(new Date(2026, 0, 5)), '2026-01-05');
});

test('fechaISO no revienta con basura', () => {
  assert.equal(fechaISO(null), null);
  assert.equal(fechaISO(new Date('nada')), null);
});

test('desdeISO devuelve medianoche local, no medianoche UTC', () => {
  const d = desdeISO('2026-09-09');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 9);
  assert.equal(d.getHours(), 0);
});

test('fechaISO y desdeISO son inversas', () => {
  assert.equal(fechaISO(desdeISO('2026-02-28')), '2026-02-28');
});

test('sumarDias cruza el fin de mes', () => {
  assert.equal(sumarDias('2026-09-30', 1), '2026-10-01');
  assert.equal(sumarDias('2026-01-01', -1), '2025-12-31');
});

test('sumarDias cruza el cambio de hora de Chile sin correrse un día', () => {
  // El horario de verano chileno arranca en septiembre. Sumar un día sobre el
  // cambio tiene que dar el día siguiente, no el mismo con otra hora.
  assert.equal(sumarDias('2026-09-05', 1), '2026-09-06');
  assert.equal(sumarDias('2026-09-06', 1), '2026-09-07');
});

test('semanaDe empieza el lunes, no el domingo', () => {
  // 2026-09-09 es miércoles.
  const semana = semanaDe('2026-09-09');
  assert.equal(semana.length, 7);
  assert.equal(semana[0], '2026-09-07');
  assert.equal(semana[6], '2026-09-13');
});

test('semanaDe: un domingo pertenece a la semana que TERMINA, no a la que empieza', () => {
  // 2026-09-13 es domingo: su semana es la del 7 al 13.
  const semana = semanaDe('2026-09-13');
  assert.equal(semana[0], '2026-09-07');
  assert.equal(semana[6], '2026-09-13');
});

test('semanaDe con un lunes se queda donde está', () => {
  assert.equal(semanaDe('2026-09-07')[0], '2026-09-07');
});

test('diaCorto y numeroDeDia arman la tira', () => {
  assert.equal(diaCorto('2026-09-07'), 'lun');
  assert.equal(diaCorto('2026-09-13'), 'dom');
  assert.equal(numeroDeDia('2026-09-07'), 7);
});

test('fechaLarga va en español y sin año', () => {
  assert.equal(fechaLarga('2026-09-07'), 'Lunes 7 de septiembre');
  assert.equal(fechaLarga('2026-12-25'), 'Viernes 25 de diciembre');
});

test('fechaRelativa dice Hoy y Mañana, y después la fecha', () => {
  const ahora = new Date(2026, 8, 9, 10, 0, 0);
  assert.equal(fechaRelativa('2026-09-09', ahora), 'Hoy');
  assert.equal(fechaRelativa('2026-09-10', ahora), 'Mañana');
  assert.equal(fechaRelativa('2026-09-11', ahora), 'Viernes 11 de septiembre');
});

test('fechaRelativa NO le pone rótulo a ayer', () => {
  // «Ayer» se confunde con «Hoy» de un vistazo; la fecha se lee mejor.
  const ahora = new Date(2026, 8, 9, 10, 0, 0);
  assert.equal(fechaRelativa('2026-09-08', ahora), 'Martes 8 de septiembre');
});

test('rotuloDeSemana nombra los dos meses cuando la semana los cruza', () => {
  assert.equal(rotuloDeSemana('2026-09-09'), 'Semana del 7 al 13 de septiembre');
  // La semana del 28 de septiembre al 4 de octubre.
  assert.equal(
    rotuloDeSemana('2026-09-30'),
    'Semana del 28 de septiembre al 4 de octubre',
  );
});

// ---------------------------------------------------------------------------
// Duraciones
// ---------------------------------------------------------------------------

test('duracionEnMinutos con un bloque normal', () => {
  assert.equal(duracionEnMinutos('18:00', '19:30'), 90);
});

test('duracionEnMinutos: un bloque que cruza la medianoche no dura -23 horas', () => {
  // Postgres devuelve el fin de un bloque 23:00–24:00 como '00:00'.
  assert.equal(duracionEnMinutos('23:00', '00:00'), 60);
});

test('etiquetaDuracion se lee en castellano', () => {
  assert.equal(etiquetaDuracion(60), '1 hora');
  assert.equal(etiquetaDuracion(120), '2 horas');
  assert.equal(etiquetaDuracion(90), '1 h 30 min');
  assert.equal(etiquetaDuracion(45), '45 min');
  assert.equal(etiquetaDuracion(0), null);
});

// ---------------------------------------------------------------------------
// Rótulos de la agenda
// ---------------------------------------------------------------------------

test('resumenDeAgenda separa las horas por fuera de las cerradas', () => {
  const agenda = {
    reservas: [{ estado: 'confirmada' }, { estado: 'armando' }, { estado: 'confirmada' }],
    bloqueos: [{ tipo: 'externo' }, { tipo: 'cerrado' }, { tipo: 'cerrado' }],
  };
  assert.equal(resumenDeAgenda(agenda), '3 reservas, 1 hora por fuera y 2 horas cerradas');
});

test('resumenDeAgenda no cuenta las canceladas', () => {
  const agenda = { reservas: [{ estado: 'confirmada' }, { estado: 'cancelada' }], bloqueos: [] };
  assert.equal(resumenDeAgenda(agenda), '1 reserva');
});

test('resumenDeAgenda con el día vacío dice algo, no queda en blanco', () => {
  assert.equal(resumenDeAgenda({ reservas: [], bloqueos: [] }), 'Sin reservas ni horas ocupadas');
  assert.equal(resumenDeAgenda(null), 'Sin reservas ni horas ocupadas');
});

test('etiquetaDeReserva: una sin confirmar NO se rotula como reservada', () => {
  // La regla central del vertical: mientras se arma, la hora sigue disponible.
  const { texto } = etiquetaDeReserva('en_curso');
  assert.equal(texto, 'Sin confirmar');
  assert.ok(!/reservad|tomad/i.test(texto));
});

test('etiquetaDeReserva cubre los cuatro estados operativos', () => {
  assert.equal(etiquetaDeReserva('confirmada').texto, 'Pagada');
  assert.equal(etiquetaDeReserva('jugada').texto, 'Jugada');
  assert.equal(etiquetaDeReserva('cancelada').texto, 'Cancelada');
  assert.equal(etiquetaDeReserva(undefined).texto, 'Sin confirmar');
});

test('haceCuanto se lee como lo diría una persona', () => {
  const ahora = new Date(2026, 8, 9, 20, 0, 0);
  assert.equal(haceCuanto(new Date(2026, 8, 9, 19, 40, 0), ahora), 'hace 20 min');
  assert.equal(haceCuanto(new Date(2026, 8, 9, 16, 0, 0), ahora), 'hace 4 h');
  assert.equal(haceCuanto(new Date(2026, 8, 8, 16, 0, 0), ahora), 'hace 1 día');
  assert.equal(haceCuanto(new Date(2026, 8, 7, 16, 0, 0), ahora), 'hace 2 días');
});

test('haceCuanto no revienta con una fecha ilegible', () => {
  assert.equal(haceCuanto(null), null);
  assert.equal(haceCuanto(new Date('nada')), null);
});

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

test('motivoDeCancelacionValido exige lo mismo que el servidor: diez caracteres', () => {
  assert.equal(motivoDeCancelacionValido('lluvia'), false);
  assert.equal(motivoDeCancelacionValido('         '), false);
  assert.equal(motivoDeCancelacionValido('Se cortó la luz del sector'), true);
});

test('motivoDeCancelacionValido no cuenta los espacios del borde', () => {
  assert.equal(motivoDeCancelacionValido('   lluvia   '), false);
});

// ---------------------------------------------------------------------------
// Ocupar un horario
// ---------------------------------------------------------------------------

const SLOTS = [
  { hora_inicio: '11:00', hora_fin: '12:00', estado: 'libre', reserva: null },
  { hora_inicio: '12:00', hora_fin: '13:00', estado: 'libre', reserva: null },
  { hora_inicio: '13:00', hora_fin: '14:00', estado: 'reservada', reserva: { id: 'r1', organizador_username: 'matico7' } },
  { hora_inicio: '14:00', hora_fin: '15:00', estado: 'libre', reserva: null },
  { hora_inicio: '15:00', hora_fin: '16:00', estado: 'libre', grupos_en_curso: 2, reserva: null },
];

test('horasElegibles ofrece el cierre como término pero no como inicio', () => {
  const { inicios, terminos } = horasElegibles(SLOTS);
  assert.deepEqual(inicios, ['11:00', '12:00', '13:00', '14:00', '15:00']);
  assert.deepEqual(terminos, ['12:00', '13:00', '14:00', '15:00', '16:00']);
});

test('horasElegibles con la cancha cerrada ese día no ofrece nada', () => {
  const { inicios, terminos } = horasElegibles([]);
  assert.deepEqual(inicios, []);
  assert.deepEqual(terminos, []);
});

test('bloquesEnRango aplica la regla semiabierta: el de la hora de término queda afuera', () => {
  // 11:00 a 13:00 son DOS bloques, no tres. Es la misma regla de las tarifas.
  const dentro = bloquesEnRango(SLOTS, '11:00', '13:00');
  assert.deepEqual(dentro.map((s) => s.hora_inicio), ['11:00', '12:00']);
});

test('bloquesEnRango con un rango invertido o vacío devuelve nada', () => {
  assert.deepEqual(bloquesEnRango(SLOTS, '14:00', '12:00'), []);
  assert.deepEqual(bloquesEnRango(SLOTS, '12:00', '12:00'), []);
});

test('reservasQueChocan encuentra la reserva confirmada del rango', () => {
  const choques = reservasQueChocan(SLOTS, '12:00', '15:00');
  assert.equal(choques.length, 1);
  assert.equal(choques[0].hora_inicio, '13:00');
  assert.equal(choques[0].reserva.organizador_username, 'matico7');
});

test('un bloque con gente juntando la plata NO choca: la hora sigue libre', () => {
  // El bloque de las 15:00 tiene grupos_en_curso = 2 y estado 'libre'. Marcarlo
  // como choque sería tratar una reserva a medio armar como si ocupara la hora.
  assert.deepEqual(reservasQueChocan(SLOTS, '15:00', '16:00'), []);
});

test('reservasQueChocan no mira fuera del rango', () => {
  assert.deepEqual(reservasQueChocan(SLOTS, '11:00', '13:00'), []);
});

test('rangoSinChoque propone empezar después de la reserva', () => {
  // 13:00 a 16:00 choca con la de las 13:00; lo que queda limpio es 14:00–16:00.
  assert.deepEqual(rangoSinChoque(SLOTS, '13:00', '16:00'), { desde: '14:00', hasta: '16:00' });
});

test('rangoSinChoque no propone nada si el choque está en medio', () => {
  // Recortar por delante dejaría la reserva adentro igual: proponer sería adivinar.
  assert.equal(rangoSinChoque(SLOTS, '12:00', '16:00'), null);
});

test('rangoSinChoque no propone nada si no queda ningún bloque', () => {
  assert.equal(rangoSinChoque(SLOTS, '13:00', '14:00'), null);
});

test('etiquetaOcupar dice cuánto se está marcando', () => {
  assert.equal(etiquetaOcupar('11:00', '13:00'), 'Ocupar 2 horas');
  assert.equal(etiquetaOcupar('11:00', '12:00'), 'Ocupar 1 hora');
  assert.equal(etiquetaOcupar('11:00', '12:30'), 'Ocupar 1 h 30 min');
});

// ---------------------------------------------------------------------------
// Horarios de atención
// ---------------------------------------------------------------------------

test('DIAS_SEMANA va de lunes a domingo pero conserva la numeración de Postgres', () => {
  // El orden es para mostrar; el número es el de extract(dow), 0 = domingo.
  // Renumerar rompería las reglas ya cargadas.
  assert.deepEqual(DIAS_SEMANA.map((d) => d.dia), [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(DIAS_SEMANA[0].corto, 'Lun');
  assert.equal(DIAS_SEMANA[6].corto, 'Dom');
});

test('horasDelReloj ofrece medias horas y puede incluir la medianoche', () => {
  const sinMedianoche = horasDelReloj();
  assert.equal(sinMedianoche[0], '00:00');
  assert.equal(sinMedianoche[1], '00:30');
  assert.equal(sinMedianoche[sinMedianoche.length - 1], '23:30');
  assert.equal(sinMedianoche.length, 48);

  // '24:00' solo para el cierre: Postgres lo acepta y es la única forma de
  // cargar una cancha abierta hasta la medianoche sin perder la última hora.
  const conMedianoche = horasDelReloj({ incluirMedianoche: true });
  assert.equal(conMedianoche[conMedianoche.length - 1], '24:00');
});

test('rangosSeCruzan: pegados NO se cruzan', () => {
  // 14:00-16:00 justo después de 10:00-14:00 es válido, y el servidor también
  // lo acepta. Si esto diera true, la pantalla bloquearía horarios legítimos.
  assert.equal(rangosSeCruzan('14:00', '16:00', '10:00', '14:00'), false);
  assert.equal(rangosSeCruzan('10:00', '14:00', '14:00', '16:00'), false);
});

test('rangosSeCruzan: solapados sí', () => {
  assert.equal(rangosSeCruzan('12:00', '16:00', '10:00', '14:00'), true);
  assert.equal(rangosSeCruzan('11:00', '12:00', '10:00', '14:00'), true); // contenido
  assert.equal(rangosSeCruzan('09:00', '23:00', '10:00', '14:00'), true); // contiene
});

const REGLAS = [
  { id: 'r1', dia_semana: 1, hora_apertura: '10:00', hora_cierre: '14:00' },
  { id: 'r2', dia_semana: 1, hora_apertura: '16:00', hora_cierre: '23:00' },
  { id: 'r3', dia_semana: 2, hora_apertura: '09:00', hora_cierre: '23:00' },
];

test('choqueDeHorario encuentra la regla que se cruza, en su propio día', () => {
  const choque = choqueDeHorario(REGLAS, 1, '12:00', '17:00');
  assert.equal(choque.id, 'r1');
});

test('choqueDeHorario no mira los otros días', () => {
  // El mismo rango que choca el lunes está libre el jueves.
  assert.equal(choqueDeHorario(REGLAS, 4, '12:00', '17:00'), null);
});

test('choqueDeHorario: una regla no choca consigo misma al editarla', () => {
  assert.equal(choqueDeHorario(REGLAS, 1, '10:00', '15:00', 'r1'), null);
});

test('choqueDeHorario: un hueco entre dos reglas no choca', () => {
  assert.equal(choqueDeHorario(REGLAS, 1, '14:00', '16:00'), null);
});

test('horariosDelDia ordena por hora de apertura', () => {
  const desordenadas = [REGLAS[1], REGLAS[0]];
  assert.deepEqual(horariosDelDia(desordenadas, 1).map((r) => r.id), ['r1', 'r2']);
  assert.deepEqual(horariosDelDia(REGLAS, 4), []);
});

test('rangoLegible recorta los segundos que devuelve Postgres', () => {
  assert.equal(rangoLegible('09:00:00', '14:00:00'), '09:00\u201314:00');
  assert.equal(rangoLegible(null, '14:00'), null);
});

// ---------------------------------------------------------------------------
// Teléfono
// ---------------------------------------------------------------------------

test('normalizaTelefonoCl acepta las formas en que se escribe un móvil en Chile', () => {
  assert.equal(normalizaTelefonoCl('9 8765 4321'), '+56987654321');
  assert.equal(normalizaTelefonoCl('+56 9 8765 4321'), '+56987654321');
  assert.equal(normalizaTelefonoCl('56987654321'), '+56987654321');
  assert.equal(normalizaTelefonoCl('056987654321'), '+56987654321');
});

test('normalizaTelefonoCl rechaza lo que no es un móvil', () => {
  assert.equal(normalizaTelefonoCl('223456789'), null); // fijo de Santiago
  assert.equal(normalizaTelefonoCl('98765432'), null);  // le falta un dígito
  assert.equal(normalizaTelefonoCl(''), null);
  assert.equal(normalizaTelefonoCl(null), null);
});

test('telefonoAceptable deja pasar el vacío: el contacto del bloqueo es opcional', () => {
  assert.equal(telefonoAceptable(''), true);
  assert.equal(telefonoAceptable('   '), true);
  assert.equal(telefonoAceptable('9 8765 4321'), true);
  assert.equal(telefonoAceptable('123'), false);
});

test('hoyISO es la fecha local de ahora', () => {
  const ahora = new Date();
  assert.equal(hoyISO(ahora), fechaISO(ahora));
});
