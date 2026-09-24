/**
 * Pruebas de la presentación de TrueScore (fase 1).
 *
 * La lógica de puntaje vive en Postgres y se prueba en
 * `supabase/tests/134_truescore_fase1_test.sql`. Acá se prueba lo único que
 * hace la app: pintar el nivel con la tabla que manda el servidor, saber si
 * la nómina está completa y redactar los costos que el servidor calculó.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  nivelTrueScore,
  marcasCompletas,
  plazoAsistenciaAbierto,
  textoCostoSalida,
  textoCostoCancelacion,
  describirEvento,
  puedeReclamar,
  textoEstadoReclamo,
} = require('../trueScore.js');

// La misma tabla que siembra la migración 134 en `truescore_config`.
const NIVELES = [
  { desde: 90, clave: 'muy_confiable', nombre: 'Muy confiable', color: 'verde' },
  { desde: 75, clave: 'confiable', nombre: 'Confiable', color: 'verde' },
  { desde: 50, clave: 'en_observacion', nombre: 'En observación', color: 'amarillo' },
  { desde: 0, clave: 'poco_confiable', nombre: 'Poco confiable', color: 'rojo' },
];

test('los bordes de cada nivel caen del lado correcto', () => {
  const casos = [
    [100, 'muy_confiable'], [90, 'muy_confiable'], [89, 'confiable'], [75, 'confiable'],
    [74, 'en_observacion'], [50, 'en_observacion'], [49, 'poco_confiable'], [0, 'poco_confiable'],
  ];
  for (const [p, clave] of casos) {
    assert.equal(nivelTrueScore(p, NIVELES).clave, clave, `puntaje ${p}`);
  }
});

test('el orden en que llega la tabla no importa', () => {
  assert.equal(nivelTrueScore(60, [...NIVELES].reverse()).color, 'amarillo');
});

test('sin tabla (TrueScore apagado) no hay nivel', () => {
  assert.equal(nivelTrueScore(80, null), null);
  assert.equal(nivelTrueScore(80, []), null);
  assert.equal(nivelTrueScore(undefined, NIVELES), null);
});

test('la nómina está completa sólo si cada jugador tiene una marca válida', () => {
  const nomina = [{ user_id: 'a' }, { user_id: 'b' }];
  assert.deepEqual(marcasCompletas(nomina, { a: 'asistio' }), { completas: false, faltan: 1 });
  assert.deepEqual(marcasCompletas(nomina, { a: 'asistio', b: 'presente' }), { completas: false, faltan: 1 });
  assert.deepEqual(marcasCompletas(nomina, { a: 'tarde', b: 'no_fue' }), { completas: true, faltan: 0 });
  assert.equal(marcasCompletas([], {}).completas, false);
});

test('el plazo de asistencia corre desde el fin del partido', () => {
  const hora = '2026-09-24T20:00:00Z';
  const match = { hora, duracion_min: 90 };
  const fin = Date.parse(hora) + 90 * 60000;
  assert.equal(plazoAsistenciaAbierto(match, 24, fin - 1), false);
  assert.equal(plazoAsistenciaAbierto(match, 24, fin), true);
  assert.equal(plazoAsistenciaAbierto(match, 24, fin + 24 * 3600000), true);
  assert.equal(plazoAsistenciaAbierto(match, 24, fin + 24 * 3600000 + 1), false);
  assert.equal(plazoAsistenciaAbierto({ ...match, asistencia_confirmada_at: hora }, 24, fin), false);
  assert.equal(plazoAsistenciaAbierto({ ...match, asistencia_vencida_at: hora }, 24, fin), false);
});

test('el costo de salir dice los puntos que calculó el servidor', () => {
  assert.match(textoCostoSalida({ ok: true, puntos: 13, rompe_racha: true }), /13 puntos.*racha/);
  assert.match(textoCostoSalida({ ok: true, puntos: 1, rompe_racha: false }), /1 punto de/);
  assert.equal(textoCostoSalida({ ok: false }), null);
});

test('cancelar por lluvia o cierre no cuesta; con poco aviso sí', () => {
  const costo = { ok: true, puntos: 15, horas_sin_costo: 12 };
  assert.match(textoCostoCancelacion(costo, 'lluvia'), /no pierdes puntos/);
  assert.match(textoCostoCancelacion(costo, 'cierre_cancha'), /no pierdes puntos/);
  assert.match(textoCostoCancelacion(costo, 'otro'), /baja 15 puntos.*menos de 12 h/);
  assert.match(textoCostoCancelacion({ ...costo, puntos: 0 }, 'otro'), /12 h o más.*no pierdes/);
});

test('el historial muestra lo aplicado, y el inicio muestra el puntaje', () => {
  assert.deepEqual(
    pick(describirEvento({ tipo: 'asistio', puntos_aplicados: 8, puntaje_despues: 89 })),
    { titulo: 'Asististe a tiempo', cambio: '+8', tono: 'positivo' }
  );
  assert.deepEqual(
    pick(describirEvento({ tipo: 'salida', puntos_aplicados: -13, puntaje_despues: 62 })),
    { titulo: 'Te saliste del partido', cambio: '-13', tono: 'negativo' }
  );
  // En 100, asistir aplica 0: se muestra como neutro, no como «+12».
  assert.equal(describirEvento({ tipo: 'asistio', puntos_aplicados: 0, puntaje_despues: 100 }).tono, 'neutro');
  assert.deepEqual(
    pick(describirEvento({ tipo: 'inicio', puntos_aplicados: -25, puntaje_despues: 75 })),
    { titulo: 'Inicio de TrueScore', cambio: '75', tono: 'neutro' }
  );
});

test('se reclama una tardanza o ausencia de un partido, dentro de plazo y una vez', () => {
  const creado = '2026-09-24T12:00:00Z';
  const base = { tipo: 'planton', match_id: 'm1', created_at: creado };
  const t0 = Date.parse(creado);
  const opts = { fase2: true, plazoHoras: 48, ahora: t0 + 3600000 };
  assert.equal(puedeReclamar(base, opts), true);
  assert.equal(puedeReclamar({ ...base, tipo: 'tarde' }, opts), true);
  assert.equal(puedeReclamar({ ...base, tipo: 'salida' }, opts), false);
  assert.equal(puedeReclamar({ ...base, match_id: null }, opts), false);
  assert.equal(puedeReclamar(base, { ...opts, fase2: false }), false);
  assert.equal(puedeReclamar(base, { ...opts, reclamo: { estado: 'abierto' } }), false);
  assert.equal(puedeReclamar(base, { ...opts, ahora: t0 + 48 * 3600000 }), true);
  assert.equal(puedeReclamar(base, { ...opts, ahora: t0 + 48 * 3600000 + 1 }), false);
});

test('el estado del reclamo se lee en una frase', () => {
  assert.match(textoEstadoReclamo({ estado: 'abierto', confirmaciones: 1, necesarias: 2 }), /1 de 2/);
  assert.match(textoEstadoReclamo({ estado: 'aceptado' }), /aceptado/);
  assert.match(textoEstadoReclamo({ estado: 'vencido' }), /se cerró/);
  assert.equal(textoEstadoReclamo(null), null);
});

test('los eventos nuevos de la fase 2 tienen título', () => {
  assert.equal(describirEvento({ tipo: 'reversion', puntos_aplicados: 58 }).titulo, 'Reclamo aceptado');
  assert.equal(describirEvento({ tipo: 'bono_organizador', puntos_aplicados: 5 }).cambio, '+5');
  assert.equal(describirEvento({ tipo: 'reclamo_organizador', puntos_aplicados: -20 }).tono, 'negativo');
});

test('la inactividad (fase 4) se muestra con su cambio, que puede subir o bajar', () => {
  assert.deepEqual(pick(describirEvento({ tipo: 'inactividad', puntos_aplicados: -2 })),
    { titulo: 'Tiempo sin jugar', cambio: '-2', tono: 'negativo' });
  assert.equal(describirEvento({ tipo: 'inactividad', puntos_aplicados: 2 }).cambio, '+2');
});

function pick(e) {
  return { titulo: e.titulo, cambio: e.cambio, tono: e.tono };
}
