/**
 * P01 (pendientes de calidad del 2026-09-23): el historial de Perfil traía
 * las últimas 20 inscripciones por `inscrito_at` y recién después las
 * ordenaba por la hora del partido.
 *
 *   · Una inscripción hecha hace semanas a un partido de mañana quedaba
 *     fuera si después hubo 20 inscripciones más.
 *   · «Ausencias acumuladas» y la tasa de asistencia se calculaban sobre
 *     esas 20 filas: quien faltó a 5 partidos hace tiempo veía 0.
 *
 * Ahora la consulta ordena por la hora del partido en el servidor
 * (`order=match(hora).desc`, comprobado contra PostgREST 16 local) y los
 * contadores salen de un conteo en el servidor, no de la página.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { attendanceDisplay, contadoresDeAsistencia } = require('../playerMeta.js');

const fila = (estado) => ({ estado, match: { hora: '2026-10-01T20:00:00Z' } });

test('P01: los contadores salen del conteo del servidor, no de las filas cargadas', () => {
  const veinte = Array.from({ length: 20 }, () => fila('confirmado_gps'));
  assert.deepEqual(contadoresDeAsistencia(veinte, { confirmadas: 31, ausencias: 5 }), {
    confirmadas: 31,
    ausencias: 5,
  });
  const a = attendanceDisplay(veinte, { confirmadas: 31, ausencias: 5 });
  assert.equal(a.pct, 86);
  assert.equal(a.cerradas, 36);
});

test('P01: sin conteo (falló), se usa lo cargado como antes', () => {
  const filas = [fila('confirmado_gps'), fila('no_asistio'), fila('inscrito')];
  assert.deepEqual(contadoresDeAsistencia(filas, null), { confirmadas: 1, ausencias: 1 });
  assert.equal(attendanceDisplay(filas).pct, 50);
});

test('P01: el servicio ordena por la hora del partido en la consulta', () => {
  const svc = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'profile.js'), 'utf8');
  const ini = svc.indexOf('export async function getAttendanceHistoryFor(');
  const cuerpo = svc.slice(ini, svc.indexOf('\n}\n', ini));
  assert.match(cuerpo, /\.order\('match\(hora\)'/, 'vuelve a cortar por inscrito_at antes de ordenar');
  assert.ok(
    cuerpo.indexOf(".order('match(hora)'") < cuerpo.indexOf('.limit(limit)'),
    'el orden por hora tiene que ir antes del límite'
  );
  assert.match(svc, /export async function getConteoDeAsistencias\(/);
});

test('P01: Perfil pide el conteo y lo pasa a los contadores', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'ProfileScreen.js'), 'utf8');
  assert.match(src, /getConteoDeAsistencias\(targetId\)/);
  assert.match(src, /deriveStats\(profile, history, conteoAsistencias\)/);
  assert.match(src, /attendanceDisplay\(history, conteoAsistencias\)/);
});
