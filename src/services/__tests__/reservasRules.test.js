/**
 * Pruebas de las reglas puras del vertical Reservas: formato CLP, cargo de
 * servicio fijo, redondeo de cuota, límites de jugadores y validación de
 * carga de Balance — los mismos números que usa `Reservas.dc.html`.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_FEE_CLP,
  JUGADORES_LIMITS,
  MIN_TOPUP_CLP,
  formatCLP,
  roundToNearest50,
  computeTotal,
  clampJugadores,
  computeCuota,
  computeMitad,
  isValidTopupAmount,
  buildFechaOptions,
  fechaLabel,
  addMinutesToHora,
} = require('../reservasRules.js');

test('formatCLP: separa miles con punto y antepone $, sin decimales', () => {
  assert.equal(formatCLP(28000), '$28.000');
  assert.equal(formatCLP(1500), '$1.500');
  assert.equal(formatCLP(0), '$0');
});

test('formatCLP: redondea antes de formatear', () => {
  assert.equal(formatCLP(1999.6), '$2.000');
});

test('roundToNearest50: redondea al múltiplo de 50 más cercano', () => {
  assert.equal(roundToNearest50(2032), 2050);
  assert.equal(roundToNearest50(2010), 2000);
  assert.equal(roundToNearest50(2025), 2050); // Math.round redondea .5 hacia arriba
});

test('computeTotal: suma el cargo de servicio fijo de $1.500 al precio base', () => {
  assert.equal(computeTotal(28500), 28500 + SERVICE_FEE_CLP);
  assert.equal(computeTotal(28500), 30000);
});

test('clampJugadores: usa el valor pasado si está dentro del rango', () => {
  assert.equal(clampJugadores(14, 10), 14);
});

test('clampJugadores: nunca baja de 2, aunque se pida menos', () => {
  assert.equal(clampJugadores(1, 10), JUGADORES_LIMITS.min);
});

test('clampJugadores: nunca sube de 30, aunque se pida más', () => {
  assert.equal(clampJugadores(99, 10), JUGADORES_LIMITS.max);
});

test('clampJugadores: sin valor, usa el "habitual" de la cancha (fallback)', () => {
  assert.equal(clampJugadores(undefined, 14), 14);
  assert.equal(clampJugadores(null, 22), 22);
  assert.equal(clampJugadores(0, 14), 14); // 0 es falsy: cae al fallback, no se interpreta como "0 jugadores"
});

test('computeCuota: total 30.000 entre 14 jugadores redondea a $50', () => {
  // 30000 / 14 = 2142.86 → redondeado a 2150
  assert.equal(computeCuota(30000, 14), 2150);
});

test('computeCuota: coincide con el ejemplo del handoff (cancha 1, 14 jugadores habituales)', () => {
  const total = computeTotal(28500); // 30.000
  assert.equal(computeCuota(total, 14), 2150);
});

test('computeMitad: exactamente la mitad, sin redondear a $50', () => {
  assert.equal(computeMitad(30000), 15000);
  assert.equal(computeMitad(28501), 14250.5);
});

test('isValidTopupAmount: rechaza montos bajo la carga mínima', () => {
  assert.equal(isValidTopupAmount(999), false);
  assert.equal(isValidTopupAmount(0), false);
});

test('isValidTopupAmount: acepta la carga mínima exacta y montos mayores', () => {
  assert.equal(isValidTopupAmount(MIN_TOPUP_CLP), true);
  assert.equal(isValidTopupAmount(20000), true);
});

// ---------------------------------------------------------------------------
// Recalculo de cuota al sumar/restar un jugador (pantallas 28 "jugador
// rechazó" y 31 "nueva cuota avisada" del prototipo)
// ---------------------------------------------------------------------------

test('computeCuota: al bajar un jugador, la cuota de los que quedan sube', () => {
  const total = 30000;
  const jugadoresOriginal = 14;
  const cuotaOriginal = computeCuota(total, jugadoresOriginal);
  const cuotaConUnoMenos = computeCuota(total, jugadoresOriginal - 1);
  assert.ok(cuotaConUnoMenos > cuotaOriginal, 'con menos jugadores, cada uno paga más');
});

test('computeCuota: la cuota previa (con un jugador más) era menor que la actual', () => {
  const total = 30000;
  const jugadoresActual = 14;
  const cuotaActual = computeCuota(total, jugadoresActual);
  const cuotaPrevia = computeCuota(total, jugadoresActual + 1);
  assert.ok(cuotaPrevia < cuotaActual, 'con un jugador más, la cuota anterior era menor');
});

// ---------------------------------------------------------------------------
// Tira de fechas y hora de término (pantalla 7 "Fecha y horario")
// ---------------------------------------------------------------------------

test('buildFechaOptions: la primera es "HOY", el resto trae fecha real consecutiva', () => {
  const base = new Date(2026, 7, 20); // 20 ago 2026, hora local
  const opciones = buildFechaOptions(base, 6);
  assert.equal(opciones.length, 6);
  assert.equal(opciones[0].dow, 'HOY');
  assert.equal(opciones[0].esHoy, true);
  assert.equal(opciones[0].num, '20');
  assert.equal(opciones[0].iso, '2026-08-20');
  assert.equal(opciones[1].esHoy, false);
  assert.equal(opciones[1].num, '21');
  assert.equal(opciones[1].iso, '2026-08-21');
  assert.equal(opciones[5].iso, '2026-08-25');
});

test('buildFechaOptions: usa la fecha LOCAL, no UTC — no se corre un día cerca de medianoche', () => {
  // 23:59 hora local: si se serializara con toISOString() en un huso
  // negativo (Chile, UTC-3/-4) esto ya sería el día siguiente en UTC.
  const base = new Date(2026, 7, 20, 23, 59);
  const opciones = buildFechaOptions(base, 1);
  assert.equal(opciones[0].iso, '2026-08-20');
});

test('fechaLabel: "Hoy" para la primera opción', () => {
  const opciones = buildFechaOptions(new Date(2026, 7, 20), 2);
  assert.equal(fechaLabel(opciones[0]), 'Hoy');
});

test('fechaLabel: día de semana + número + mes en minúsculas para el resto', () => {
  const opciones = buildFechaOptions(new Date(2026, 7, 20), 2);
  assert.match(fechaLabel(opciones[1]), /^[a-zé]{3} 21 [a-z]{3}$/);
});

test('addMinutesToHora: 60 minutos suma una hora exacta', () => {
  assert.equal(addMinutesToHora('19:00', 60), '20:00');
});

test('addMinutesToHora: 90 minutos suma hora y media', () => {
  assert.equal(addMinutesToHora('19:00', 90), '20:30');
});

test('addMinutesToHora: cruza la medianoche', () => {
  assert.equal(addMinutesToHora('23:00', 90), '00:30');
});
