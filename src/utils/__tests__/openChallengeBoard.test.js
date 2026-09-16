/**
 * Pruebas del tablero abierto de desafíos (migración 112).
 *
 * QUÉ SE FIJA ACÁ:
 *   · `parseFechaHora` acepta sólo fechas y horas reales, futuras exigidas
 *     aparte por `borradorListo`.
 *   · `ordenarPublicaciones` no muestra las de otra modalidad, deja sin
 *     distancia al final en vez de tratarlas como "0 km", y ordena por fecha
 *     próxima cuando se pide — nunca por nivel, que no existe.
 *   · `cierraEnLabel` usa el mismo plazo de 7 días que el desafío 1 a 1.
 *   · `esCerca` no marca «Cerca» sin distancia conocida.
 *   · `cierraPronto` marca urgencia sólo dentro de las 24 h antes de expirar.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseFechaHora,
  formatFecha,
  formatHora,
  cierraEnLabel,
  esCerca,
  cierraPronto,
  borradorListo,
  ordenarPublicaciones,
} = require('../openChallengeBoard.js');

test('parseFechaHora: una fecha y hora válidas se interpretan bien', () => {
  const d = parseFechaHora('25/12/2026', '20:30');
  assert.ok(d instanceof Date);
  assert.equal(d.getDate(), 25);
  assert.equal(d.getMonth(), 11);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getHours(), 20);
  assert.equal(d.getMinutes(), 30);
});

test('parseFechaHora: rechaza una fecha inexistente (31 de febrero)', () => {
  assert.equal(parseFechaHora('31/02/2026', '20:00'), null);
});

test('parseFechaHora: rechaza formato incompleto o vacío', () => {
  assert.equal(parseFechaHora('', ''), null);
  assert.equal(parseFechaHora('25/12/2026', ''), null);
  assert.equal(parseFechaHora('2026', '20:00'), null);
});

test('parseFechaHora: rechaza mes u hora fuera de rango', () => {
  assert.equal(parseFechaHora('10/13/2026', '20:00'), null);
  assert.equal(parseFechaHora('10/10/2026', '25:00'), null);
});

test('formatFecha/formatHora: ida y vuelta con parseFechaHora', () => {
  const original = new Date(2026, 5, 3, 9, 5);
  const d = parseFechaHora(formatFecha(original), formatHora(original));
  assert.equal(formatFecha(d), '03/06/2026');
  assert.equal(formatHora(d), '09:05');
});

test('borradorListo: fecha futura válida está lista', () => {
  const ahora = new Date(2026, 0, 1, 12, 0);
  const listo = borradorListo({ fechaStr: '02/01/2026', horaStr: '10:00' }, ahora);
  assert.equal(listo, true);
});

test('borradorListo: fecha pasada no está lista', () => {
  const ahora = new Date(2026, 0, 10, 12, 0);
  const listo = borradorListo({ fechaStr: '01/01/2026', horaStr: '10:00' }, ahora);
  assert.equal(listo, false);
});

test('borradorListo: fecha inválida no está lista', () => {
  assert.equal(borradorListo({ fechaStr: '', horaStr: '' }), false);
});

test('ordenarPublicaciones: filtra por modalidad cuando se pide', () => {
  const rows = [
    { modalidad: 'futbol7', distanciaKm: 1 },
    { modalidad: 'futbol11', distanciaKm: 2 },
  ];
  const out = ordenarPublicaciones(rows, { modalidad: 'futbol7' });
  assert.equal(out.length, 1);
  assert.equal(out[0].modalidad, 'futbol7');
});

test('ordenarPublicaciones: sin modalidad, no filtra nada', () => {
  const rows = [{ modalidad: 'futbol7' }, { modalidad: 'futbol11' }];
  assert.equal(ordenarPublicaciones(rows, {}).length, 2);
});

test('ordenarPublicaciones: "cerca" ordena por distancia ascendente', () => {
  const rows = [
    { id: 'a', distanciaKm: 8.1 },
    { id: 'b', distanciaKm: 1.1 },
    { id: 'c', distanciaKm: 4.6 },
  ];
  const out = ordenarPublicaciones(rows, { sort: 'cerca' });
  assert.deepEqual(out.map((r) => r.id), ['b', 'c', 'a']);
});

test('ordenarPublicaciones: sin distancia conocida va al final, no se trata como 0 km', () => {
  const rows = [
    { id: 'sin-dato', distanciaKm: null },
    { id: 'lejos', distanciaKm: 10 },
    { id: 'cerca', distanciaKm: 1 },
  ];
  const out = ordenarPublicaciones(rows, { sort: 'cerca' });
  assert.deepEqual(out.map((r) => r.id), ['cerca', 'lejos', 'sin-dato']);
});

test('ordenarPublicaciones: "pronto" ordena por fecha propuesta más próxima', () => {
  const rows = [
    { id: 'tarde', fecha_propuesta: '2026-09-20T20:00:00Z' },
    { id: 'pronto', fecha_propuesta: '2026-09-16T20:00:00Z' },
    { id: 'media', fecha_propuesta: '2026-09-18T20:00:00Z' },
  ];
  const out = ordenarPublicaciones(rows, { sort: 'pronto' });
  assert.deepEqual(out.map((r) => r.id), ['pronto', 'media', 'tarde']);
});

test('ordenarPublicaciones: no revienta con lista vacía o ausente', () => {
  assert.deepEqual(ordenarPublicaciones([], {}), []);
  assert.deepEqual(ordenarPublicaciones(undefined, {}), []);
});

test('cierraEnLabel: recién publicada, cierra en 7 días', () => {
  const ahora = new Date('2026-09-16T12:00:00Z');
  const label = cierraEnLabel('2026-09-16T12:00:00Z', ahora);
  assert.equal(label, 'Cierra en 7 días');
});

test('cierraEnLabel: a horas de expirar, avisa en horas', () => {
  const ahora = new Date('2026-09-22T20:00:00Z');
  const label = cierraEnLabel('2026-09-16T12:00:00Z', ahora); // vence 23/09 12:00
  assert.match(label, /^Cierra en \d+ h/);
});

test('cierraEnLabel: pasado el plazo, dice Expiró', () => {
  const ahora = new Date('2026-09-25T12:00:00Z');
  assert.equal(cierraEnLabel('2026-09-16T12:00:00Z', ahora), 'Expiró');
});

test('cierraEnLabel: fecha inválida no revienta', () => {
  assert.equal(cierraEnLabel(null), '');
  assert.equal(cierraEnLabel('no-es-una-fecha'), '');
});

test('esCerca: dentro del umbral es cerca, fuera no', () => {
  assert.equal(esCerca(1.1), true);
  assert.equal(esCerca(5), true);
  assert.equal(esCerca(5.1), false);
  assert.equal(esCerca(20), false);
});

test('esCerca: sin distancia conocida, nunca es cerca', () => {
  assert.equal(esCerca(null), false);
  assert.equal(esCerca(undefined), false);
  assert.equal(esCerca(NaN), false);
});

test('cierraPronto: a horas de expirar, es urgente', () => {
  const ahora = new Date('2026-09-22T20:00:00Z');
  assert.equal(cierraPronto('2026-09-16T12:00:00Z', ahora), true);
});

test('cierraPronto: recién publicada, no es urgente', () => {
  const ahora = new Date('2026-09-16T12:00:00Z');
  assert.equal(cierraPronto('2026-09-16T12:00:00Z', ahora), false);
});

test('cierraPronto: ya expiró, no es "urgente" (ya cerró)', () => {
  const ahora = new Date('2026-09-25T12:00:00Z');
  assert.equal(cierraPronto('2026-09-16T12:00:00Z', ahora), false);
});

test('cierraPronto: fecha inválida no revienta', () => {
  assert.equal(cierraPronto(null), false);
  assert.equal(cierraPronto('no-es-una-fecha'), false);
});
