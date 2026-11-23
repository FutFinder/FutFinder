/**
 * Pruebas de la capa de observabilidad (Sentry).
 *
 * LO QUE ESTAS PRUEBAS PROTEGEN NO ES QUE SENTRY FUNCIONE —eso lo dice el
 * panel de Sentry— sino **qué sale de la app y qué no**. Mandar errores a un
 * servicio de terceros es publicar datos, y en FutFinder las URL llevan
 * identificadores de persona: `/rest/v1/profiles?id=eq.<uuid>`,
 * `/rest/v1/matches?...&or=(titulo.ilike.%<lo que la persona escribió>%)`.
 * Una miga de pan con la query entera es una filtración silenciosa.
 *
 * Por eso lo que se fija acá es:
 *   · sin DSN no se inicializa nada y la app se comporta como antes;
 *   · las URL se recortan antes de salir, siempre;
 *   · no se adjunta identidad de nadie.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  debeActivarse,
  limpiarUrl,
  limpiarEvento,
  DSN_DE_EJEMPLO,
} = require('../observabilidad.js');

// ─── Cuándo se enciende ──────────────────────────────────────────────

test('sin DSN no se activa: la app queda exactamente como antes', () => {
  assert.equal(debeActivarse({ dsn: undefined, dev: false }), false);
  assert.equal(debeActivarse({ dsn: '', dev: false }), false);
  assert.equal(debeActivarse({ dsn: '   ', dev: false }), false);
});

test('en desarrollo no se manda nada, aunque haya DSN', () => {
  // Los errores de desarrollo ya se ven en la consola y en el boundary, que
  // muestra el stack. Mandarlos ensucia el panel y gasta la cuota con ruido
  // que nadie va a mirar.
  assert.equal(debeActivarse({ dsn: 'https://abc@o1.ingest.sentry.io/1', dev: true }), false);
});

test('con DSN y fuera de desarrollo, sí', () => {
  assert.equal(debeActivarse({ dsn: 'https://abc@o1.ingest.sentry.io/1', dev: false }), true);
});

test('el DSN del archivo de ejemplo no enciende nada', () => {
  // `.env.example` trae un marcador. Si alguien copia el archivo sin
  // reemplazarlo, Sentry no tiene que arrancar con un DSN inventado: eso
  // produce errores de red en bucle en el teléfono de la persona.
  assert.equal(debeActivarse({ dsn: DSN_DE_EJEMPLO, dev: false }), false);
});

// ─── Qué sale, y qué no ──────────────────────────────────────────────

test('la URL pierde la query: ahí viven los uuid y lo que la persona escribió', () => {
  assert.equal(
    limpiarUrl('https://xyz.supabase.co/rest/v1/profiles?select=*&id=eq.6494036a-9ab2-443e'),
    'https://xyz.supabase.co/rest/v1/profiles'
  );
  assert.equal(
    limpiarUrl('https://xyz.supabase.co/rest/v1/matches?or=(titulo.ilike.%pichanga%)'),
    'https://xyz.supabase.co/rest/v1/matches'
  );
});

test('la URL conserva el camino, que es lo único que sirve para depurar', () => {
  // Sin el camino el informe no dice NADA: «falló una petición» no se puede
  // arreglar. Con él se sabe qué endpoint y eso basta.
  assert.equal(
    limpiarUrl('https://xyz.supabase.co/rest/v1/rpc/buscar_jugadores?x=1'),
    'https://xyz.supabase.co/rest/v1/rpc/buscar_jugadores'
  );
});

test('un identificador metido en el CAMINO también se borra', () => {
  // `clubes/<uuid>/editar` y `p/<uuid>` son rutas reales de esta app desde
  // que el editor de club tiene URL propia. Recortar sólo la query las
  // dejaría pasar enteras.
  assert.equal(
    limpiarUrl('http://localhost:8081/clubes/5af67b4a-b889-40a4-a1bd-8ea04397dc3c/editar'),
    'http://localhost:8081/clubes/<id>/editar'
  );
  assert.equal(limpiarUrl('https://futfinder.cl/p/4ebfbe6a-dc50-4f4e-9c88-15149b75eb16'),
    'https://futfinder.cl/p/<id>');
});

test('limpiarUrl nunca lanza, pase lo que pase', () => {
  // Corre dentro del envío de un error. Si revienta acá, el error original
  // se pierde y además aparece uno nuevo y falso.
  assert.equal(limpiarUrl(null), null);
  assert.equal(limpiarUrl(undefined), undefined);
  assert.equal(limpiarUrl(''), '');
  assert.equal(typeof limpiarUrl('no es una url'), 'string');
  assert.equal(typeof limpiarUrl(12345), 'string');
});

test('el evento sale sin identidad de nadie', () => {
  const evento = {
    user: { id: 'abc', email: 'alguien@ejemplo.cl', username: 'vicentee' },
    request: { url: 'https://x.supabase.co/rest/v1/profiles?id=eq.abc', headers: { a: 1 } },
    message: 'boom',
  };
  const limpio = limpiarEvento(evento);
  assert.equal(limpio.user, undefined, 'se fue con el usuario adjunto');
  assert.equal(limpio.request.url, 'https://x.supabase.co/rest/v1/profiles');
  assert.equal(limpio.message, 'boom', 'el mensaje del error tiene que sobrevivir');
});

test('las migas de pan salen recortadas una por una', () => {
  const limpio = limpiarEvento({
    breadcrumbs: [
      { category: 'fetch', data: { url: 'https://x.co/rest/v1/matches?titulo=ilike.%algo%' } },
      { category: 'xhr', data: { url: 'https://x.co/rest/v1/rpc/mis_ajustes?x=1' } },
      { category: 'console', message: 'hola' },
    ],
  });
  assert.equal(limpio.breadcrumbs[0].data.url, 'https://x.co/rest/v1/matches');
  assert.equal(limpio.breadcrumbs[1].data.url, 'https://x.co/rest/v1/rpc/mis_ajustes');
  assert.equal(limpio.breadcrumbs[2].message, 'hola', 'una miga sin url no debería tocarse');
});

test('limpiarEvento aguanta un evento con cualquier forma', () => {
  // Sentry cambia la forma de sus eventos entre versiones. Este gancho corre
  // en el camino de salida de TODOS los errores: si lanza, la app pierde el
  // informe y gana una excepción.
  assert.doesNotThrow(() => limpiarEvento({}));
  assert.doesNotThrow(() => limpiarEvento({ breadcrumbs: null }));
  assert.doesNotThrow(() => limpiarEvento({ breadcrumbs: [null, {}, { data: null }] }));
  assert.doesNotThrow(() => limpiarEvento({ request: null }));
  assert.doesNotThrow(() => limpiarEvento(null));
});

// ─── El cableado ─────────────────────────────────────────────────────
// Se lee el TEXTO de los archivos, como hacen `avisosCompletos.test.js` y
// `enlaceEditarClub.test.js`: no hay renderizador de React en estas pruebas,
// y lo que importa fijar es que el gancho siga enchufado. Un informe de
// errores desconectado es peor que no tenerlo, porque se cree que está.

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../..');

test('ErrorBoundary informa, y es el único sitio donde hace falta', () => {
  const boundary = fs.readFileSync(path.join(RAIZ, 'components', 'ErrorBoundary.js'), 'utf8');
  assert.match(boundary, /import \{ reportarError \}/, 'ErrorBoundary ya no importa reportarError');
  assert.match(boundary, /componentDidCatch[\s\S]{0,600}reportarError\(/,
    'reportarError no se llama desde componentDidCatch');
  // Y sigue dejando la traza local: sin DSN, es lo único que queda.
  assert.match(boundary, /componentDidCatch[\s\S]{0,600}console\.error\(/,
    'se perdió el console.error, que es la única traza cuando Sentry está apagado');
});

test('todas las pantallas pasan por ese boundary', () => {
  // Es lo que hace que enchufarlo en UN archivo alcance. Si `withAuthGuard`
  // dejara de envolver con el boundary, el informe de errores se quedaría
  // cubriendo sólo la raíz sin que nadie lo note.
  const guard = fs.readFileSync(path.join(RAIZ, 'navigation', 'withAuthGuard.js'), 'utf8');
  assert.match(guard, /withErrorBoundary\(/,
    'withAuthGuard dejó de envolver las pantallas con el boundary');
});

test('la app lo arranca, y antes de montar nada', () => {
  const app = fs.readFileSync(path.resolve(RAIZ, '..', 'App.js'), 'utf8');
  assert.match(app, /iniciarObservabilidad\(\)/, 'App.js no arranca la observabilidad');
  // Al nivel del módulo, no dentro del componente: un error durante el
  // montaje también tiene que llegar.
  assert.match(app, /^iniciarObservabilidad\(\);$/m,
    'iniciarObservabilidad() tiene que correr al cargar el módulo, no dentro de App()');
});
