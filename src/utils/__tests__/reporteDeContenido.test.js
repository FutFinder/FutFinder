/**
 * Reportar club, foto de club y partido (migración 186).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TIPOS_DE_CONTENIDO, interpretarReporteDeContenido, YA_HAY_UNO } = require('../reporteDeContenido.js');

const RAIZ = path.join(__dirname, '..', '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

test('ok del servidor es éxito', () => {
  assert.deepEqual(interpretarReporteDeContenido({ data: { ok: true }, error: null }), { error: null });
});

test('un ok:false trae el motivo del servidor', () => {
  const r = interpretarReporteDeContenido({ data: { ok: false, reason: 'No puedes reportar tu propio contenido.' }, error: null });
  assert.equal(r.error.message, 'No puedes reportar tu propio contenido.');
});

test('un error de transporte no se muestra crudo', () => {
  const r = interpretarReporteDeContenido({ data: null, error: { code: '42501', message: 'permission denied for function reportar_contenido' } });
  assert.doesNotMatch(r.error.message, /permission|function/);
});

test('los tipos son los que entiende la RPC de la 186', () => {
  const sql = leer('supabase/migrations/186_reportar_contenido_y_edad_minima.sql');
  for (const t of TIPOS_DE_CONTENIDO) assert.match(sql, new RegExp(`p_tipo = '${t}'`));
});

test('cada pantalla reporta su propio tipo', () => {
  assert.match(leer('src/screens/ClubDetailScreen.js'), /reportarContenido\(\{ tipo: 'club'/);
  assert.match(leer('src/screens/ClubGalleryScreen.js'), /reportarContenido\(\{ tipo: 'foto_club'/);
  assert.match(leer('src/screens/MatchDetailScreen.js'), /reportarContenido\(\{ tipo: 'partido'/);
});

test('el reporte repetido no habla de «esta cuenta»', () => {
  const r = interpretarReporteDeContenido({
    data: { ok: false, reason: 'Ya enviaste un reporte sobre esta cuenta y sigue en revisión.' },
    error: null,
  });
  assert.equal(r.error.message, YA_HAY_UNO);
  assert.doesNotMatch(r.error.message, /esta cuenta/);
});

test('con la 191 el reporte repetido dice «esto», y la app lo muestra igual', () => {
  const r = interpretarReporteDeContenido({ data: { ok: false, reason: 'Ya reportaste esto y sigue en revisión.' }, error: null });
  assert.equal(r.error.message, YA_HAY_UNO);
});

test('«ya reporté esta cuenta» mira sólo el reporte de la cuenta, no los de su contenido', () => {
  const svc = leer('src/services/reports.js');
  const ini = svc.indexOf('export async function getMyPendingReportFor(');
  assert.match(svc.slice(ini), /\.is\('elemento', null\)/);
});

test('la 191 hace única la terna reportante, reportado y elemento', () => {
  const sql = leer('supabase/migrations/191_un_reporte_pendiente_por_elemento.sql');
  assert.match(sql, /\(reporter_id, reported_id, \(coalesce\(elemento, ''\)\)\)/);
});

// La hoja se quedaba abierta después de «Ya reportaste esto y sigue en
// revisión» (probado en producción el 2026-11-19): se podía volver a tocar
// «Enviar» para nada. Un rechazo DEFINITIVO del servidor cierra la hoja; uno
// de transporte la deja abierta para reintentar.
test('un rechazo del servidor cierra la hoja; un fallo de red no', () => {
  const { cierraLaHoja } = require('../reporteDeContenido.js');
  const repetido = interpretarReporteDeContenido({ data: { ok: false, reason: 'Ya reportaste esto y sigue en revisión.' }, error: null });
  const propio = interpretarReporteDeContenido({ data: { ok: false, reason: 'No puedes reportar tu propio contenido.' }, error: null });
  const red = interpretarReporteDeContenido({ data: null, error: { message: 'Failed to fetch' } });
  assert.equal(cierraLaHoja(null), true);
  assert.equal(cierraLaHoja(repetido.error), true);
  assert.equal(cierraLaHoja(propio.error), true);
  assert.equal(cierraLaHoja(red.error), false);
  assert.equal(cierraLaHoja({ message: 'Selecciona un motivo' }), false);
});

test('la hoja cierra con cierraLaHoja, y reportar una cuenta repetida también es definitivo', () => {
  assert.match(leer('src/components/player/ReportPlayerSheet.js'), /cierraLaHoja\(error\)/);
  const svc = leer('src/services/reports.js');
  const ini = svc.indexOf("if (error.code === '23505')");
  assert.ok(ini > 0);
  assert.match(svc.slice(ini, ini + 400), /definitivo: true/);
});
