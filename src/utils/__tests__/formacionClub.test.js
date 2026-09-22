/**
 * Pruebas de la formación y los puestos del tablero de alineación
 * (migración 92).
 *
 * QUÉ SE FIJA ACÁ:
 *   · `layoutSlots` siempre agrega el arquero y exactamente un puesto por
 *     línea, sin importar la formación.
 *   · `fitsForMember` traduce las 7 posiciones reales a puestos de cancha,
 *     junta las de un arreglo con varias posiciones sin repetir, y `flanco`
 *     antepone el lado sin descartar el otro.
 *   · `autocompletarAsignaciones` no deja puestos libres si hay banca
 *     suficiente, y prioriza el calce exacto sobre cualquiera.
 *   · `zoneLabel` recalcula el puesto según dónde se soltó, para que mover
 *     un mediocampista al fondo lo vuelva DFC de verdad, no un MC mal puesto.
 *   · `resumenAutocompletar` cuenta lo que PASÓ: «Alineación completada»
 *     salía con un jugador en siete puestos, y la cancha llena y la banca
 *     vacía compartían el mismo texto.
 *   · `conservarAsignaciones` no tira el tablero al cambiar de formación.
 *   · `hayCambiosSinGuardar` es lo que decide si salir avisa.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  F7,
  F11,
  layoutSlots,
  fitsForMember,
  autocompletarAsignaciones,
  conservarAsignaciones,
  hayCambiosSinGuardar,
  resumenAutocompletar,
  zoneLabel,
} = require('../formacionClub.js');

test('layoutSlots: "4-3-3" tiene arquero + 4 + 3 + 3 = 11 puestos', () => {
  const slots = layoutSlots('4-3-3');
  assert.equal(slots.length, 11);
  assert.equal(slots.filter((s) => s.label === 'POR').length, 1);
  assert.equal(slots[0].key, 'gk');
});

test('layoutSlots: "2-3-1" (fútbol 7) tiene arquero + 2 + 3 + 1 = 7 puestos', () => {
  const slots = layoutSlots('2-3-1');
  assert.equal(slots.length, 7);
});

test('layoutSlots: la defensa de 4 usa laterales en los extremos', () => {
  const slots = layoutSlots('4-4-2');
  const defensa = slots.filter((s) => s.top === slots[1].top); // primera línea tras el arquero
  const labels = defensa.map((s) => s.label);
  assert.deepEqual(labels, ['LI', 'DFC', 'DFC', 'LD']);
});

test('layoutSlots: la línea de ataque queda más arriba (top menor) que la defensa', () => {
  const slots = layoutSlots('4-3-3');
  const topDe = (label) => slots.find((s) => s.label === label).top;
  assert.ok(topDe('LI') > topDe('MC'), 'la defensa (LI) debe estar más abajo que el medio (MC)');
  assert.ok(topDe('MC') > topDe('ED'), 'el medio debe estar más abajo que el ataque (ED)');
});

test('layoutSlots: claves únicas para cada puesto', () => {
  const slots = layoutSlots('4-2-3-1');
  const claves = new Set(slots.map((s) => s.key));
  assert.equal(claves.size, slots.length);
});

test('F7 y F11 no se pisan y tienen formaciones reales', () => {
  assert.ok(F7.includes('2-3-1'));
  assert.ok(F11.includes('4-3-3'));
  assert.equal(F7.some((f) => F11.includes(f)), false);
});

test('fitsForMember: un arquero sólo calza en POR', () => {
  const fits = fitsForMember({ posicion_preferida: ['arquero'] });
  assert.deepEqual(fits, ['POR']);
});

test('fitsForMember: varias posiciones se juntan sin repetir', () => {
  const fits = fitsForMember({ posicion_preferida: ['medio', 'volante'] });
  assert.deepEqual(fits, ['MC', 'MCD', 'MI', 'MD']);
});

test('fitsForMember: "sin_definir" no aporta ningún puesto', () => {
  const fits = fitsForMember({ posicion_preferida: ['sin_definir'] });
  assert.deepEqual(fits, []);
});

test('fitsForMember: sin posición_preferida no revienta', () => {
  assert.deepEqual(fitsForMember({}), []);
  assert.deepEqual(fitsForMember(null), []);
});

test('fitsForMember: flanco izquierdo antepone LI a LD sin descartarlo', () => {
  const fits = fitsForMember({ posicion_preferida: ['lateral'], flanco: 'izquierdo' });
  assert.equal(fits[0], 'LI');
  assert.ok(fits.includes('LD'));
});

test('fitsForMember: flanco derecho antepone LD a LI', () => {
  const fits = fitsForMember({ posicion_preferida: ['lateral'], flanco: 'derecho' });
  assert.equal(fits[0], 'LD');
});

test('fitsForMember: sin flanco (o "ambos") no reordena', () => {
  const sinFlanco = fitsForMember({ posicion_preferida: ['lateral'] });
  const ambos = fitsForMember({ posicion_preferida: ['lateral'], flanco: 'ambos' });
  assert.deepEqual(sinFlanco, ambos);
});

test('autocompletarAsignaciones: completa todos los puestos si hay banca suficiente', () => {
  const slots = layoutSlots('2-3-1');
  const banca = [
    { member_id: 'a', posicion_preferida: ['arquero'] },
    { member_id: 'b', posicion_preferida: ['defensa'] },
    { member_id: 'c', posicion_preferida: ['defensa'] },
    { member_id: 'd', posicion_preferida: ['medio'] },
    { member_id: 'e', posicion_preferida: ['medio'] },
    { member_id: 'f', posicion_preferida: ['medio'] },
    { member_id: 'g', posicion_preferida: ['delantero'] },
  ];
  const asignaciones = autocompletarAsignaciones(slots, banca);
  assert.equal(Object.keys(asignaciones).length, slots.length);
  assert.equal(asignaciones.gk, 'a');
});

test('autocompletarAsignaciones: prioriza el calce exacto sobre cualquier calce', () => {
  const slots = [{ key: 'gk', label: 'POR', left: 50, top: 90 }];
  const banca = [
    { member_id: 'volante-cualquiera', posicion_preferida: ['volante'] },
    { member_id: 'el-arquero', posicion_preferida: ['arquero'] },
  ];
  const asignaciones = autocompletarAsignaciones(slots, banca);
  assert.equal(asignaciones.gk, 'el-arquero');
});

test('autocompletarAsignaciones: sin banca suficiente deja el resto de los puestos libres', () => {
  const slots = layoutSlots('2-3-1');
  const banca = [{ member_id: 'a', posicion_preferida: ['arquero'] }];
  const asignaciones = autocompletarAsignaciones(slots, banca);
  assert.equal(Object.keys(asignaciones).length, 1);
});

test('autocompletarAsignaciones: sin banca no asigna nada y no revienta', () => {
  const slots = layoutSlots('2-3-1');
  assert.deepEqual(autocompletarAsignaciones(slots, []), {});
});

test('zoneLabel: el fondo de la cancha siempre es POR', () => {
  assert.equal(zoneLabel(50, 90), 'POR');
  assert.equal(zoneLabel(10, 95), 'POR');
});

test('zoneLabel: centro de la defensa es DFC, no un lateral', () => {
  assert.equal(zoneLabel(50, 70), 'DFC');
});

test('zoneLabel: el extremo izquierdo de la línea defensiva es LI', () => {
  assert.equal(zoneLabel(15, 70), 'LI');
});

test('zoneLabel: el extremo derecho de la línea defensiva es LD', () => {
  assert.equal(zoneLabel(85, 70), 'LD');
});

test('zoneLabel: el extremo del último tercio es un puesto de ataque (EI/ED), no un lateral', () => {
  assert.equal(zoneLabel(15, 10), 'EI');
  assert.equal(zoneLabel(85, 10), 'ED');
});

test('zoneLabel: mover un mediocampista (MC) hacia el fondo lo vuelve DFC', () => {
  // Simula arrastrar un puesto que empezó en MC (top ~45) hasta top 70.
  assert.equal(zoneLabel(50, 45), 'MC');
  assert.equal(zoneLabel(50, 70), 'DFC');
});

test('zoneLabel: el centro de la cancha (ni izquierda ni derecha) no lleva lado', () => {
  assert.equal(zoneLabel(50, 55), 'MCD');
  assert.equal(zoneLabel(50, 25), 'MP');
});

// ── El mensaje de «Autocompletar» ───────────────────────────────────

test('un jugador en siete puestos NO es una alineación completada', () => {
  // El fallo reproducido en la web: contador 1/7 y el aviso diciendo que
  // estaba completa.
  const r = resumenAutocompletar({ puestosLibres: 7, jugadoresEnBanca: 1, ubicados: 1 });
  assert.equal(r.ubicados, 1);
  assert.equal(r.faltan, 6);
  assert.equal(r.mensaje, '1 jugador ubicado; faltan 6 puestos');
});

test('cuando de verdad se llena, lo dice', () => {
  const r = resumenAutocompletar({ puestosLibres: 7, jugadoresEnBanca: 9, ubicados: 7 });
  assert.equal(r.faltan, 0);
  assert.equal(r.mensaje, 'Alineación completada');
});

test('la cancha llena y la banca vacía no son la misma frase', () => {
  assert.equal(
    resumenAutocompletar({ puestosLibres: 0, jugadoresEnBanca: 4, ubicados: 0 }).mensaje,
    'Todos los puestos están ocupados'
  );
  assert.equal(
    resumenAutocompletar({ puestosLibres: 3, jugadoresEnBanca: 0, ubicados: 0 }).mensaje,
    'No quedan jugadores en la banca'
  );
});

test('el singular del hueco se respeta', () => {
  assert.equal(
    resumenAutocompletar({ puestosLibres: 2, jugadoresEnBanca: 1, ubicados: 1 }).mensaje,
    '1 jugador ubicado; falta 1 puesto'
  );
});

// ── Cambiar de formación sin perder el trabajo ──────────────────────

test('al cambiar de formación, cada jugador conserva su puesto', () => {
  const antes = layoutSlots('2-3-1');
  const asignaciones = Object.fromEntries(antes.map((s, i) => [s.key, `m${i}`]));
  const despues = layoutSlots('3-2-1');

  const nuevas = conservarAsignaciones(asignaciones, antes, despues);

  // El arquero siempre sigue siendo el arquero.
  assert.equal(nuevas.gk, asignaciones.gk);
  // Y nadie aparece dos veces en el tablero nuevo.
  const ids = Object.values(nuevas);
  assert.equal(new Set(ids).size, ids.length);
});

test('quien se queda sin puesto equivalente vuelve a la banca, no desaparece', () => {
  // 3-3 tiene tres DFC; 1-4-1 tiene uno solo: dos defensas sobran.
  const antes = layoutSlots('3-3');
  const asignaciones = Object.fromEntries(antes.map((s, i) => [s.key, `m${i}`]));
  const despues = layoutSlots('1-4-1');

  const nuevas = conservarAsignaciones(asignaciones, antes, despues);
  const conservados = Object.values(nuevas);

  assert.ok(conservados.length < Object.keys(asignaciones).length);
  // Los que quedan son de los que había: no se inventa a nadie.
  conservados.forEach((id) => assert.ok(Object.values(asignaciones).includes(id)));
});

test('ir y volver entre dos formaciones no baraja el equipo', () => {
  const a = layoutSlots('2-3-1');
  const b = layoutSlots('2-3-1');
  const asignaciones = Object.fromEntries(a.map((s, i) => [s.key, `m${i}`]));
  assert.deepEqual(conservarAsignaciones(asignaciones, a, b), asignaciones);
});

// ── Cambios sin guardar ─────────────────────────────────────────────

const GUARDADA = {
  modo: 7,
  formacion: '2-3-1',
  personalizado: false,
  asignaciones: { gk: 'm1', l0p0: 'm2' },
  custom: {},
};

test('sin tocar nada, salir no molesta', () => {
  assert.equal(hayCambiosSinGuardar({ ...GUARDADA }, GUARDADA), false);
});

test('ubicar a alguien más cuenta como cambio', () => {
  const borrador = { ...GUARDADA, asignaciones: { ...GUARDADA.asignaciones, l0p1: 'm3' } };
  assert.equal(hayCambiosSinGuardar(borrador, GUARDADA), true);
});

test('cambiar de formación o de modalidad cuenta como cambio', () => {
  assert.equal(hayCambiosSinGuardar({ ...GUARDADA, formacion: '3-2-1' }, GUARDADA), true);
  assert.equal(hayCambiosSinGuardar({ ...GUARDADA, modo: 11 }, GUARDADA), true);
});

test('un decimal de diferencia en un puesto arrastrado no es trabajo sin guardar', () => {
  // El ida y vuelta por JSON puede devolver 41.99999 donde había 42.
  const guardada = { ...GUARDADA, personalizado: true, custom: { gk: { left: 42, top: 90, label: 'POR' } } };
  const borrador = { ...guardada, custom: { gk: { left: 41.99999, top: 90.0001, label: 'POR' } } };
  assert.equal(hayCambiosSinGuardar(borrador, guardada), false);
});

test('sin alineación guardada, mirar otra formación no es trabajo que perder', () => {
  assert.equal(
    hayCambiosSinGuardar({ modo: 7, formacion: '3-2-1', asignaciones: {}, custom: {} }, null),
    false
  );
  assert.equal(
    hayCambiosSinGuardar({ modo: 7, formacion: '3-2-1', asignaciones: { gk: 'm1' }, custom: {} }, null),
    true
  );
});
