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

test('el reporte pendiente contra la misma persona no habla de «esta cuenta»', () => {
  const r = interpretarReporteDeContenido({
    data: { ok: false, reason: 'Ya enviaste un reporte sobre esta cuenta y sigue en revisión.' },
    error: null,
  });
  assert.equal(r.error.message, YA_HAY_UNO);
  assert.doesNotMatch(r.error.message, /esta cuenta/);
});
