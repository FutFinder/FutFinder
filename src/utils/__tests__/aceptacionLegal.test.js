/**
 * La aceptación de términos queda en el servidor con su versión, y la app
 * sigue funcionando mientras el servidor todavía no sepa guardarla.
 * Se ejecutan con: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  esFuncionInexistente, interpretarAceptacion, fechaLargaAVersion, MENSAJE_NO_GUARDADA,
} = require('../aceptacionLegal.js');
const { ACTUALIZADO, VERSION_LEGAL } = require('../../data/legal.js');

const RAIZ = path.join(__dirname, '..', '..', '..');

test('la versión que se registra es la fecha del texto', () => {
  assert.match(VERSION_LEGAL, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(fechaLargaAVersion(ACTUALIZADO), VERSION_LEGAL);
});

test('la fecha larga se convierte bien, y lo que no se entiende es null', () => {
  assert.equal(fechaLargaAVersion('26 de octubre de 2026'), '2026-10-26');
  assert.equal(fechaLargaAVersion('1 de enero de 2027'), '2027-01-01');
  assert.equal(fechaLargaAVersion('ayer'), null);
  assert.equal(fechaLargaAVersion('3 de brumario de 2026'), null);
});

test('la versión cumple lo que valida el servidor', () => {
  const sql = fs.readFileSync(path.join(RAIZ, 'supabase/migrations/181_aceptacion_de_terminos.sql'), 'utf8');
  assert.match(sql, /date '2026-01-01'/);
  assert.ok(VERSION_LEGAL >= '2026-01-01');
  // No es una fecha futura respecto de hoy (el servidor la rechazaría).
  const manana = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
  assert.ok(VERSION_LEGAL <= manana, 'VERSION_LEGAL está en el futuro');
});

test('aceptación guardada', () => {
  assert.deepEqual(interpretarAceptacion({ data: { ok: true, version: VERSION_LEGAL }, error: null }),
    { registrada: true, error: null });
});

test('sin la migración aplicada no hay error: la app sigue como antes', () => {
  const sinFuncion = { code: 'PGRST202', message: 'Could not find the function public.aceptar_terminos(p_version) in the schema cache' };
  assert.equal(esFuncionInexistente(sinFuncion), true);
  assert.deepEqual(interpretarAceptacion({ data: null, error: sinFuncion }), { registrada: false, error: null });
  assert.equal(esFuncionInexistente({ code: '42883', message: 'function public.aceptar_terminos(text) does not exist' }), true);
});

test('cualquier otro fallo sí es un error que se muestra', () => {
  for (const error of [{ message: 'Failed to fetch' }, { code: '42501', message: 'permission denied' }, { code: 'PGRST301' }]) {
    assert.equal(esFuncionInexistente(error), false);
    assert.deepEqual(interpretarAceptacion({ data: null, error }), { registrada: false, error: { message: MENSAJE_NO_GUARDADA } });
  }
  // El servidor contestó, pero que no.
  assert.equal(interpretarAceptacion({ data: { ok: false, reason: 'Versión inválida' }, error: null }).registrada, false);
  assert.ok(interpretarAceptacion({ data: { ok: false }, error: null }).error);
  assert.ok(interpretarAceptacion({ data: null, error: null }).error);
});

test('el paso de términos registra la aceptación antes de dar el onboarding por terminado', () => {
  // Sin comentarios: el de la pantalla nombra `await completeOnboarding()`.
  const src = fs.readFileSync(path.join(RAIZ, 'src/screens/TermsScreen.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const i = src.indexOf('await registrarAceptacionLegal()');
  const j = src.indexOf('await completeOnboarding()');
  assert.ok(i > 0 && j > i, 'registrarAceptacionLegal tiene que ir antes de completeOnboarding');
  const servicio = fs.readFileSync(path.join(RAIZ, 'src/services/aceptacionLegal.js'), 'utf8');
  assert.match(servicio, /rpc\('aceptar_terminos', \{ p_version: VERSION_LEGAL \}\)/);
});

test('las aceptaciones entran en «Exportar mis datos», y un servidor sin la tabla es lista vacía', () => {
  const { interpretarAceptaciones, esTablaInexistente } = require('../aceptacionLegal.js');
  assert.deepEqual(
    interpretarAceptaciones({ data: [{ version: '2026-11-14', aceptado_at: '2026-11-14T10:00:00Z', user_id: 'x' }], error: null }),
    { data: [{ version: '2026-11-14', aceptado_at: '2026-11-14T10:00:00Z' }], error: null }
  );
  const sinTabla = { code: 'PGRST205', message: "Could not find the table 'public.aceptaciones_legales' in the schema cache" };
  assert.equal(esTablaInexistente(sinTabla), true);
  assert.deepEqual(interpretarAceptaciones({ data: null, error: sinTabla }), { data: [], error: null });
  assert.ok(interpretarAceptaciones({ data: null, error: { message: 'Failed to fetch' } }).error);
  assert.deepEqual(interpretarAceptaciones({ data: null, error: null }), { data: [], error: null });

  const exportar = fs.readFileSync(path.join(RAIZ, 'src/services/dataExport.js'), 'utf8');
  assert.match(exportar, /terminos_aceptados: aceptaciones\.data \|\| \[\]/);
  // Sólo se piden columnas que la 181 concede.
  const servicio = fs.readFileSync(path.join(RAIZ, 'src/services/aceptacionLegal.js'), 'utf8');
  assert.match(servicio, /\.select\('version, aceptado_at'\)/);
  const sql = fs.readFileSync(path.join(RAIZ, 'supabase/migrations/181_aceptacion_de_terminos.sql'), 'utf8');
  assert.match(sql, /grant select \(version, aceptado_at, user_id\)/);
});

test('la política dice que se guarda la aceptación y que entra en el export', () => {
  const legal = fs.readFileSync(path.join(RAIZ, 'src/data/legal.js'), 'utf8');
  assert.match(legal, /la versión de los términos y de esta política que aceptaste/);
  assert.match(legal, /las versiones de los términos que aceptaste/);
});
