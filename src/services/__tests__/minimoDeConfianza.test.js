/**
 * El mínimo de puntaje que se ofrece al publicar un partido no calzaba con
 * los niveles del servidor.
 *
 * EL FALLO. `TRUST_OPTS` ofrecía 50 / 70 / 85, pero TrueScore (migración
 * 134, `truescore_config.niveles`) corta en 50 «En observación», 75
 * «Confiable» y 90 «Muy confiable». Un organizador que pedía «70 o más»
 * dejaba entrar a gente que el resto de la app rotula «En observación», y
 * «85 o más» dejaba fuera a «Confiables» sin llegar a ser «Muy confiable».
 *
 * Ahora las opciones salen de la tabla de niveles cuando está cargada, y la
 * lista fija de respaldo usa los mismos cortes que el servidor.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const R = require('../matchRules.js');

const MIGRACION_134 = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '134_truescore_fase1.sql'),
  'utf8'
);

/** Los cortes que siembra la migración 134, leídos del propio SQL. */
function cortesDelServidor() {
  const m = MIGRACION_134.match(/\('niveles', '(\[[\s\S]*?\])',/);
  assert.ok(m, 'no se encontró la siembra de niveles en la migración 134');
  return JSON.parse(m[1].replace(/\s+/g, ' '));
}

test('la lista de respaldo corta donde corta el servidor', () => {
  const niveles = cortesDelServidor();
  const cortes = niveles.map((n) => n.desde).filter((d) => d > 0).sort((a, b) => a - b);
  assert.deepEqual(cortes, [50, 75, 90]);
  assert.deepEqual(
    R.TRUST_OPTS.map((t) => t.value),
    [0, ...cortes],
    'TRUST_OPTS ofrece mínimos que no son un nivel del servidor'
  );
});

test('con la tabla de niveles cargada, las opciones salen de ella', () => {
  const opciones = R.opcionesDeTrustMinimo(cortesDelServidor());
  assert.deepEqual(opciones.map((o) => o.value), [0, 50, 75, 90]);
  assert.match(opciones.find((o) => o.value === 75).desc, /Confiable/);
  assert.match(opciones.find((o) => o.value === 90).desc, /Muy confiable/);
});

test('si el servidor cambia un corte, la pantalla lo sigue', () => {
  const opciones = R.opcionesDeTrustMinimo([
    { desde: 80, nombre: 'Confiable' },
    { desde: 40, nombre: 'En observación' },
    { desde: 0, nombre: 'Poco confiable' },
  ]);
  assert.deepEqual(opciones.map((o) => o.value), [0, 40, 80]);
  assert.equal(R.validateDraft({ ...BORRADOR, minTrust: 80 }, 1).minTrust, undefined,
    'un corte nuevo del servidor no pasa la validación');
});

test('sin tabla de niveles se usa el respaldo', () => {
  assert.deepEqual(R.opcionesDeTrustMinimo([]).map((o) => o.value), [0, 50, 75, 90]);
  assert.deepEqual(R.opcionesDeTrustMinimo(null).map((o) => o.value), [0, 50, 75, 90]);
});

test('un partido viejo con 70 u 85 sigue mostrando su mínimo al editarlo', () => {
  const opciones = R.opcionesDeTrustMinimo(cortesDelServidor(), 70);
  assert.deepEqual(opciones.map((o) => o.value), [0, 50, 70, 75, 90]);
  assert.match(opciones.find((o) => o.value === 70).desc, /ya tenía/);
});

const BORRADOR = {
  nivel: 'intermedio',
  duracion: 90,
  cuota: '0',
  edadMin: null,
  edadMax: null,
  descripcion: '',
};

test('la validación acepta cualquier mínimo entre 0 y 100, y nada fuera', () => {
  for (const v of [0, 50, 75, 90, 70]) {
    assert.equal(R.validateDraft({ ...BORRADOR, minTrust: v }, 1).minTrust, undefined, `rechazó ${v}`);
  }
  for (const v of [-1, 101, 'x', 12.5]) {
    assert.ok(R.validateDraft({ ...BORRADOR, minTrust: v }, 1).minTrust, `aceptó ${v}`);
  }
});

test('Publicar y Editar piden las opciones a la tabla de niveles', () => {
  for (const archivo of ['PublishMatchScreen.js', 'EditMatchScreen.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', archivo), 'utf8');
    assert.match(src, /opcionesDeTrustMinimo\(/, `${archivo} vuelve a usar la lista fija`);
    assert.ok(!/TRUST_OPTS\.map\(/.test(src), `${archivo} pinta TRUST_OPTS directo`);
  }
});
