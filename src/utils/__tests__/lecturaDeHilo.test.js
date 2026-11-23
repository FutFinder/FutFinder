/**
 * Cuándo el chat da un hilo por leído (C01 y C02 de la auditoría de chats y
 * avisos del 2026-09-23).
 *
 *   C01  La carga inicial marcaba leído aunque la consulta de mensajes
 *        hubiera fallado: el remitente veía «leído» algo que nunca se mostró.
 *   C02  Cada mensaje que llegaba por Realtime se marcaba leído aunque el
 *        hilo estuviera tapado por otra pantalla, la app en segundo plano o
 *        la persona leyendo historial más arriba.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  appEstaActiva,
  cargaPermiteMarcarLeido,
  crearAcuseDeLectura,
  puedeAcusarLectura,
} = require('../lecturaDeHilo.js');

const PANTALLA = fs.readFileSync(
  path.join(__dirname, '..', '..', 'screens', 'ChatThreadScreen.js'),
  'utf8'
);

// ---------------------------------------------------------------------------
// C01 — una carga fallida no marca leído
// ---------------------------------------------------------------------------

test('C01: una carga con error no autoriza a marcar leído', () => {
  assert.equal(
    cargaPermiteMarcarLeido({ data: [], hasMore: false, error: { message: 'red caída' } }),
    false
  );
  assert.equal(cargaPermiteMarcarLeido(null), false);
  assert.equal(cargaPermiteMarcarLeido(undefined), false);
});

test('C01: una carga buena sí, aunque el hilo esté vacío', () => {
  assert.equal(cargaPermiteMarcarLeido({ data: [{ id: 'm1' }], hasMore: false, error: null }), true);
  assert.equal(cargaPermiteMarcarLeido({ data: [], hasMore: false, error: null }), true);
});

test('C01: la carga inicial de la pantalla pasa por la regla antes de marcar', () => {
  // Bloque de la carga inicial: desde que pide la primera página hasta el
  // catch. Ahí no puede quedar un markThreadAsRead suelto.
  const ini = PANTALLA.indexOf('listThreadMessages(threadKey, { limit: PAGE_SIZE })');
  assert.ok(ini > 0, 'no se encontró la carga inicial del hilo');
  const fin = PANTALLA.indexOf("console.error('[FutFinder] ChatThread load:'", ini);
  assert.ok(fin > ini, 'no se encontró el final de la carga inicial');
  const bloque = PANTALLA.slice(ini, fin);
  assert.match(
    bloque,
    /if \(cargaPermiteMarcarLeido\(page\)\)\s*\{?\s*markThreadAsRead\(/,
    'la carga inicial vuelve a marcar leído sin mirar si los mensajes llegaron'
  );
  const sueltas = bloque.match(/markThreadAsRead\(/g) || [];
  assert.equal(sueltas.length, 1, 'hay más de una llamada a markThreadAsRead en la carga inicial');
});

// ---------------------------------------------------------------------------
// C02 — el acuse espera a que el mensaje se vea
// ---------------------------------------------------------------------------

const A_LA_VISTA = { enfocado: true, appActiva: true, cercaDelFinal: true };

test('C02: sólo se acusa lectura con el hilo enfocado, la app activa y la lista al final', () => {
  assert.equal(puedeAcusarLectura(A_LA_VISTA), true);
  assert.equal(puedeAcusarLectura({ ...A_LA_VISTA, enfocado: false }), false, 'tapado por Detalles');
  assert.equal(puedeAcusarLectura({ ...A_LA_VISTA, appActiva: false }), false, 'app en segundo plano');
  assert.equal(puedeAcusarLectura({ ...A_LA_VISTA, cercaDelFinal: false }), false, 'leyendo historial');
  assert.equal(puedeAcusarLectura(), false);
});

test('C02: los estados de AppState que cuentan como app activa', () => {
  assert.equal(appEstaActiva('active'), true);
  assert.equal(appEstaActiva('unknown'), true, 'al arrancar iOS dice unknown y la pantalla se ve');
  assert.equal(appEstaActiva('background'), false);
  assert.equal(appEstaActiva('inactive'), false);
});

test('C02: un mensaje que llega con el hilo tapado queda pendiente y se marca al volver', () => {
  let marcas = 0;
  const acuse = crearAcuseDeLectura(() => { marcas += 1; });

  acuse.llegoAjeno({ ...A_LA_VISTA, enfocado: false });
  assert.equal(marcas, 0, 'se marcó leído con Detalles del chat encima');
  assert.equal(acuse.pendiente, true);

  acuse.revisar({ ...A_LA_VISTA, cercaDelFinal: false });
  assert.equal(marcas, 0, 'volvió el foco, pero la persona sigue más arriba');

  acuse.revisar(A_LA_VISTA);
  assert.equal(marcas, 1, 'al quedar a la vista se marca');
  acuse.revisar(A_LA_VISTA);
  assert.equal(marcas, 1, 'una sola vez: sin pendientes no vuelve a marcar');
});

test('C02: un mensaje que llega a la vista se marca en el acto', () => {
  let marcas = 0;
  const acuse = crearAcuseDeLectura(() => { marcas += 1; });
  acuse.llegoAjeno(A_LA_VISTA);
  assert.equal(marcas, 1);
  assert.equal(acuse.pendiente, false);
});

test('C02: el Realtime de la pantalla pasa por el acuse, no por markThreadAsRead directo', () => {
  const ini = PANTALLA.indexOf('const unsubscribe = subscribeToMessages(');
  assert.ok(ini > 0, 'no se encontró la suscripción Realtime del hilo');
  const fin = PANTALLA.indexOf('{ onStatus: reportChannelStatus }', ini);
  assert.ok(fin > ini);
  const bloque = PANTALLA.slice(ini, fin);
  assert.ok(!/markThreadAsRead\(/.test(bloque), 'el Realtime vuelve a marcar leído sin mirar si se ve');
  assert.match(bloque, /acuseRef\.current\??\.llegoAjeno\(estadoDeLectura\(\)\)/);
});

test('C02: la pantalla revisa lo pendiente al volver el foco, la app y el scroll', () => {
  assert.match(PANTALLA, /navigation\??\.addListener\??\.?\('focus'/, 'falta escuchar el foco');
  assert.match(PANTALLA, /navigation\??\.addListener\??\.?\('blur'/, 'falta escuchar la pérdida de foco');
  assert.match(PANTALLA, /AppState\.addEventListener\('change'/, 'falta escuchar AppState');
  const scroll = PANTALLA.slice(PANTALLA.indexOf('onScroll={(e) => {'));
  assert.match(
    scroll.slice(0, 600),
    /acuseRef\.current\??\.revisar\(estadoDeLectura\(\)\)/,
    'llegar al final de la lista no revisa lo pendiente'
  );
});
