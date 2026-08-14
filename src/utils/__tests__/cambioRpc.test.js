/**
 * Pruebas de la parte del servicio de cambios que se puede probar sin abrir
 * Supabase: cómo se arman los argumentos de las dos RPC y cómo se traduce lo
 * que devuelven.
 *
 * POR QUÉ ESTO VIVE FUERA DEL SERVICIO. `services/clubMatchChanges.js` importa
 * el cliente de Supabase, y con él media aplicación; no se puede cargar en
 * `node --test`. Lo que sí se puede —y es justo lo que se rompe en silencio—
 * son los NOMBRES de los argumentos: PostgREST no avisa «te faltó un
 * parámetro», contesta 404 «function not found», y la pantalla muestra un
 * error genérico. Por eso los nombres se contrastan contra la firma real de la
 * migración 46, igual que `nominaQuery.test.js` contrasta las columnas.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  argumentosProponer,
  argumentosResponder,
  comoResultadoCambio,
  FALTA_MIGRACION,
} = require('../cambioRpc.js');

const { MARGEN_CAMBIO_HORAS } = require('../cambioPartido.js');
const { CAMBIO_LIMITE_HORAS } = require('../../services/clubChallengeRules.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const MIGRACION = fs.readFileSync(
  path.join(RAIZ, 'supabase', 'migrations', '46_cambios_de_partido.sql'),
  'utf8'
);

/** Los nombres de argumento que declara una función en la migración. */
function argumentosDe(nombre) {
  const inicio = MIGRACION.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nombre}\\s*\\(`, 'i')
  );
  assert.notEqual(inicio, -1, `la migración 46 debería declarar ${nombre}`);
  const desde = MIGRACION.indexOf('(', inicio);
  const hasta = MIGRACION.indexOf(')', desde);
  return MIGRACION.slice(desde + 1, hasta)
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Los nombres de los argumentos
// ---------------------------------------------------------------------------

test('proponer manda exactamente los argumentos que declara la migración', () => {
  const args = argumentosProponer('m1', { cuota: 8000 }, 'tok-1');
  assert.deepEqual(Object.keys(args).sort(), ['p_campos', 'p_client_token', 'p_match_id']);

  const declarados = argumentosDe('proponer_cambio_partido');
  for (const clave of Object.keys(args)) {
    assert.ok(declarados.includes(clave), `«${clave}» no existe en la firma de la migración`);
  }
});

test('responder manda exactamente los argumentos que declara la migración', () => {
  const args = argumentosResponder('cb1', false, 'no tenemos arquero');
  assert.deepEqual(Object.keys(args).sort(), ['p_aceptar', 'p_change_id', 'p_motivo']);

  const declarados = argumentosDe('responder_cambio_partido');
  for (const clave of Object.keys(args)) {
    assert.ok(declarados.includes(clave), `«${clave}» no existe en la firma de la migración`);
  }
});

test('los valores viajan con el tipo que espera PostgreSQL', () => {
  const args = argumentosProponer('m1', { cuota: 8000 }, null);
  assert.equal(args.p_match_id, 'm1');
  assert.deepEqual(args.p_campos, { cuota: 8000 });
  assert.equal(args.p_client_token, null);

  // `p_aceptar` es boolean en la firma: mandar 'false' o 0 haría que
  // `coalesce(p_aceptar, false)` recibiera algo que no puede castear.
  assert.equal(argumentosResponder('cb1', 1).p_aceptar, true);
  assert.equal(argumentosResponder('cb1', undefined).p_aceptar, false);
});

// ---------------------------------------------------------------------------
// El motivo del rechazo
// ---------------------------------------------------------------------------

test('el motivo viaja recortado, y vacío o en blanco viaja como null', () => {
  assert.equal(argumentosResponder('cb1', false, '  sin arquero  ').p_motivo, 'sin arquero');
  assert.equal(argumentosResponder('cb1', false, '   ').p_motivo, null);
  assert.equal(argumentosResponder('cb1', false, '').p_motivo, null);
  assert.equal(argumentosResponder('cb1', false).p_motivo, null);
});

test('aceptar nunca lleva motivo: no hay nada que explicar', () => {
  assert.equal(argumentosResponder('cb1', true, 'me da lo mismo').p_motivo, null);
});

// ---------------------------------------------------------------------------
// La traducción de la respuesta
// ---------------------------------------------------------------------------

test('un `ok:false` es una respuesta del negocio, no un error del sistema', () => {
  const { data, error } = comoResultadoCambio(
    { ok: false, reason: 'Faltan menos de 2 horas para el partido' },
    null
  );
  assert.equal(data, null);
  assert.equal(error.message, 'Faltan menos de 2 horas para el partido');
});

test('un `ok:true` devuelve la fila y ningún error', () => {
  const { data, error } = comoResultadoCambio({ ok: true, changeId: 'cb1' }, null);
  assert.equal(error, null);
  assert.equal(data.changeId, 'cb1');
});

test('PostgREST puede envolver el resultado en un arreglo de uno', () => {
  const { data } = comoResultadoCambio([{ ok: true, changeId: 'cb1' }], null);
  assert.equal(data.changeId, 'cb1');
});

test('la migración ausente se traduce a un mensaje que se puede accionar', () => {
  for (const code of ['42883', 'PGRST202', '42P01', '42703']) {
    const { error } = comoResultadoCambio(null, { code, message: 'x' });
    assert.equal(error.message, FALTA_MIGRACION.message, `el código ${code} debería avisarlo`);
  }
  const porTexto = comoResultadoCambio(null, {
    code: 'XXXXX',
    message: 'function public.responder_cambio_partido does not exist',
  });
  assert.equal(porTexto.error.message, FALTA_MIGRACION.message);
});

test('cualquier otro error conserva su mensaje: no se traga ni se disfraza', () => {
  const { data, error } = comoResultadoCambio(null, { code: '40001', message: 'deadlock' });
  assert.equal(data, null);
  assert.equal(error.message, 'deadlock');
});

test('un error sin mensaje igual produce algo legible, nunca «undefined»', () => {
  const { error } = comoResultadoCambio(null, { code: '40001' });
  assert.ok(error.message.length > 0);
  assert.doesNotMatch(error.message, /undefined|null/);
});

// ---------------------------------------------------------------------------
// El plazo vive en un solo sitio
// ---------------------------------------------------------------------------

test('el margen de 2 horas es el mismo del ciclo de desafíos, no una copia suelta', () => {
  // `CAMBIO_LIMITE_HORAS` está en `clubChallengeRules` desde la migración 41 y
  // su espejo en PostgreSQL es `desafio_reglas()`. Si alguien cambia uno de
  // los dos, esta prueba lo dice antes de que la app y la base discrepen.
  assert.equal(MARGEN_CAMBIO_HORAS, CAMBIO_LIMITE_HORAS);
  assert.match(MIGRACION, /interval '2 hours'/);
});
