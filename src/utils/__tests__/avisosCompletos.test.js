/**
 * Ningún tipo de aviso se queda fuera de la bandeja, del destino ni de las
 * preferencias.
 *
 * POR QUÉ ESTA PRUEBA LEE ARCHIVOS Y MIGRACIONES. Los tres fallos que cubre
 * no están dentro de ninguna función: son AUSENCIAS. Un tipo que falta en
 * `CATEGORY` desaparece al filtrar, uno que falta en `resolveNotificationTarget`
 * responde «No pudimos abrir este aviso», y uno que falta en el mapa de
 * preferencias empuja siempre sin que nadie lo haya decidido. Las tres son
 * invisibles para una prueba de lógica: la función hace bien lo suyo con lo
 * que conoce.
 *
 * La lista de referencia es `notifications_type_check`, que es la autoridad
 * sobre qué tipos pueden existir de verdad. Se lee de la migración que la
 * declara por última vez.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const MIGRACIONES = path.join(RAIZ, '..', 'supabase', 'migrations');

const { NOTIF_TYPE_TO_PREFERENCE, PUSH_SIEMPRE } = require('../notificationPreferences.js');

/**
 * `CATEGORY` se lee del FUENTE y no se importa: `NotificationCard.js` es un
 * componente con JSX, y bajo `node --test` no hay quien lo transpile. Es el
 * mismo motivo por el que el resto de las pruebas de cableado leen archivos.
 */
function categorias() {
  const src = fs.readFileSync(
    path.join(RAIZ, 'components', 'notifications', 'NotificationCard.js'),
    'utf8'
  );
  const i = src.indexOf('export const CATEGORY');
  assert.notEqual(i, -1, 'desapareció el mapa CATEGORY');
  const bloque = src.slice(i, src.indexOf('};', i));
  const pares = [...bloque.matchAll(/^\s{2}([a-z_]+):\s*'([a-z]+)'/gm)];
  assert.ok(pares.length > 20, `sólo se leyeron ${pares.length} categorías`);
  return Object.fromEntries(pares.map((m) => [m[1], m[2]]));
}

const CATEGORY = categorias();

/**
 * Los tipos que la base admite, sacados del `check` más reciente.
 *
 * Se busca la ÚLTIMA migración que declara la restricción: varias la
 * reescriben entera al agregar tipos, y la que manda es la de número mayor.
 */
function tiposPermitidos() {
  const archivos = fs
    .readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  let ultima = null;
  for (const f of archivos) {
    const sql = fs.readFileSync(path.join(MIGRACIONES, f), 'utf8');
    if (sql.includes('notifications_type_check')) ultima = sql;
  }
  assert.ok(ultima, 'no se encontró ninguna migración con notifications_type_check');

  // Se ancla en el `array[` del check y se corta en su `]`: cortar por el
  // `));` de la sentencia arrastraba las comillas de cualquier otra cosa de
  // la misma migración.
  const i = ultima.lastIndexOf('notifications_type_check');
  const desde = ultima.indexOf('array[', i);
  assert.notEqual(desde, -1, 'el check no tiene la forma `type = any (array[...])`');
  const abre = desde + 'array['.length;
  const bloque = ultima.slice(abre, ultima.indexOf(']', abre));
  const tipos = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(tipos.length > 40, `sólo se leyeron ${tipos.length} tipos del check`);
  return [...new Set(tipos)];
}

const TIPOS = tiposPermitidos();

test('todo tipo de aviso tiene categoría, o desaparece al filtrar', () => {
  // `NotificationsScreen` filtra con `CATEGORY[n.type] === filtro`. Y no es
  // un filtro que el usuario siempre elija: la portada de Clubes entra con
  // la categoría FIJA en «clubes».
  const sinCategoria = TIPOS.filter((t) => !CATEGORY[t]);
  assert.deepEqual(sinCategoria, [], `sin categoría: ${sinCategoria.join(', ')}`);
});

test('las categorías son sólo las tres que tienen chip', () => {
  const validas = new Set(['clubes', 'partidos', 'social']);
  const raras = Object.entries(CATEGORY).filter(([, v]) => !validas.has(v));
  assert.deepEqual(raras, [], `categorías sin chip: ${JSON.stringify(raras)}`);
});

test('todo tipo decide su push a propósito: o tiene preferencia, o está en la lista de los que siempre empujan', () => {
  // `isPushAllowed` falla abierto, y para un tipo DESCONOCIDO está bien. Lo
  // que no puede pasar es que un tipo que la app crea caiga ahí por olvido.
  const siempre = new Set(PUSH_SIEMPRE);
  const huerfanos = TIPOS.filter((t) => !NOTIF_TYPE_TO_PREFERENCE[t] && !siempre.has(t));
  assert.deepEqual(huerfanos, [], `sin decisión de push: ${huerfanos.join(', ')}`);
});

test('el mapa de preferencias de la app y el de la Edge Function son el mismo', () => {
  // La Edge Function no puede importar el archivo de la app, así que son dos
  // copias; si se separan, una preferencia deja de respetarse en el push real.
  const edge = fs.readFileSync(
    path.join(RAIZ, '..', 'supabase', 'functions', 'send-push', 'pushLogic.ts'),
    'utf8'
  );
  const i = edge.indexOf('NOTIF_TYPE_TO_PREFERENCE');
  const bloque = edge.slice(i, edge.indexOf('};', i));
  const enEdge = new Set([...bloque.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]));
  const enApp = new Set(Object.keys(NOTIF_TYPE_TO_PREFERENCE));

  const faltanEnEdge = [...enApp].filter((t) => !enEdge.has(t));
  const faltanEnApp = [...enEdge].filter((t) => !enApp.has(t));
  assert.deepEqual(faltanEnEdge, [], `la Edge Function no conoce: ${faltanEnEdge.join(', ')}`);
  assert.deepEqual(faltanEnApp, [], `la app no conoce: ${faltanEnApp.join(', ')}`);
});
