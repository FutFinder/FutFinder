/**
 * El nivel de un encuentro entre clubes: que viaje, y que no se invente.
 *
 * EL FALLO QUE ESTO CIERRA. Un encuentro entre clubes no acordaba el nivel
 * en ninguna parte, así que `matches.nivel` quedaba con su `default
 * 'recreativo'` y la tarjeta del historial lo mostraba como «tipo de
 * partido»: un encuentro competitivo se leía «Recreativo». Era un valor por
 * omisión disfrazado de dato. En la 6.3 se dejó de pintar, que tapaba el
 * síntoma.
 *
 * DECISIÓN (2026-10-14): lo fija quien propone y no se negocia.
 *
 * LO QUE MÁS IMPORTA ACÁ es la diferencia entre `null` y `'recreativo'`.
 * `null` significa «no se eligió» —las propuestas viejas, y quien no toque
 * el campo— y NO se pinta. Si esto se perdiera, volveríamos exactamente al
 * fallo original con una migración de respaldo que lo haría parecer cierto.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { propuestaOficialPayload } = require('../clubChallengeRules.js');
const { normalizarPartido } = require('../../utils/historialClub.js');

// ─── Que viaje ───────────────────────────────────────────────────────

test('el nivel elegido viaja en el payload de la propuesta', () => {
  const p = propuestaOficialPayload({ nivel: 'competitivo' });
  assert.equal(p.nivel, 'competitivo');
});

test('sin elegir, viaja null — NO «recreativo»', () => {
  // Mandar 'recreativo' por omisión repetiría el fallo original: el
  // servidor no podría distinguir «no eligió» de «eligió recreativo».
  assert.equal(propuestaOficialPayload({}).nivel, null);
  assert.equal(propuestaOficialPayload({ nivel: null }).nivel, null);
  assert.equal(propuestaOficialPayload({ nivel: '' }).nivel, null);
  assert.equal(propuestaOficialPayload().nivel, null);
});

test('un nivel que no existe no viaja', () => {
  // La columna tiene una restricción `check`, así que esto llegaría como un
  // 23514 sin texto en español. Mejor no mandarlo.
  assert.equal(propuestaOficialPayload({ nivel: 'semiprofesional' }).nivel, null);
  assert.equal(propuestaOficialPayload({ nivel: 'COMPETITIVO' }).nivel, null);
  assert.equal(propuestaOficialPayload({ nivel: 42 }).nivel, null);
});

// ─── Que no se invente ───────────────────────────────────────────────

const FILA = {
  match_id: 'm1', club_local_id: 'c1', club_visitante_id: 'c2',
  club_local_nombre: 'A', club_visitante_nombre: 'B',
  goles_local: 2, goles_visitante: 1, fecha: '2026-10-01', hora: '2026-10-01T20:00:00Z',
  soy_integrante: true,
};

test('el historial pinta el nivel cuando lo hay', () => {
  const p = normalizarPartido({ ...FILA, nivel: 'competitivo' }, 'c1');
  assert.equal(p.tipoLabel, 'Competitivo');
});

test('y NO pinta nada cuando no lo hay', () => {
  // Es el caso de todos los encuentros anteriores a la migración 156.
  // `historial_club()` les devuelve null desde la 157 justamente para que
  // acá no haya nada que pintar.
  assert.equal(normalizarPartido({ ...FILA, nivel: null }, 'c1').tipoLabel, null);
  assert.equal(normalizarPartido({ ...FILA }, 'c1').tipoLabel, null);
});

test('un nivel desconocido tampoco se pinta', () => {
  // Si algún día la base trae un valor nuevo, es mejor no mostrar nada que
  // mostrar la cadena cruda en la tarjeta.
  assert.equal(normalizarPartido({ ...FILA, nivel: 'profesional' }, 'c1').tipoLabel, null);
});

test('los tres niveles tienen etiqueta en español', () => {
  for (const [valor, etiqueta] of [
    ['recreativo', 'Recreativo'],
    ['intermedio', 'Intermedio'],
    ['competitivo', 'Competitivo'],
  ]) {
    assert.equal(normalizarPartido({ ...FILA, nivel: valor }, 'c1').tipoLabel, etiqueta);
  }
});
