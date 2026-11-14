const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Enlaces universales: que `https://www.futfinder.cl/p/<id>` abra la app en
 * el teléfono en vez del navegador.
 *
 * Funciona sólo si cuatro piezas dicen lo mismo, y ninguna avisa cuando no:
 * - la app declara el dominio (`app.config.js`: `associatedDomains` en iOS,
 *   `intentFilters` con `autoVerify` en Android);
 * - el dominio publica dos archivos que nombran a la app
 *   (`/.well-known/apple-app-site-association` y `/.well-known/assetlinks.json`);
 * - esos archivos se sirven SIN redirección (ni Apple ni Google la siguen:
 *   por eso el dominio es `www`, porque `futfinder.cl` redirige a `www`);
 * - y lo que se comparte apunta a ese mismo dominio.
 * Si una no calza, el enlace abre el navegador sin ningún error.
 */

const RAIZ = path.join(__dirname, '..', '..');
const {
  DOMINIO,
  RUTAS,
  generarAppleAppSiteAssociation,
  generarAssetLinks,
} = require('../enlacesUniversales.js');
const { expo } = require(path.join(RAIZ, 'app.config.js'));

const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');

const TEAM_ID = 'ABCDE12345';
const HUELLA = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':');

test('el dominio es www: el de la raíz redirige y ni Apple ni Google siguen redirecciones', () => {
  assert.equal(DOMINIO, 'www.futfinder.cl');
});

test('iOS declara el dominio en associatedDomains', () => {
  assert.deepEqual(expo.ios?.associatedDomains, [`applinks:${DOMINIO}`]);
});

test('Android declara el dominio con autoVerify y las mismas rutas', () => {
  const filtros = expo.android?.intentFilters || [];
  const conDominio = filtros.filter((f) => (f.data || []).some((d) => d.host === DOMINIO));
  assert.equal(conDominio.length, 1, 'tiene que haber un solo intentFilter para el dominio');
  const [f] = conDominio;
  assert.equal(f.autoVerify, true, 'sin autoVerify Android pregunta con qué abrir el enlace');
  assert.deepEqual(f.action, 'VIEW');
  assert.deepEqual([...f.category].sort(), ['BROWSABLE', 'DEFAULT']);
  for (const d of f.data) {
    assert.equal(d.scheme, 'https');
    assert.equal(d.host, DOMINIO);
  }
  // Cada ruta de la app aparece en Android con el mismo comienzo.
  const prefijos = f.data.map((d) => d.pathPrefix || d.path).sort();
  assert.deepEqual(prefijos, RUTAS.map((r) => r.replace(/\/\*$/, '/')).sort());
});

test('las rutas salen de las URL que de verdad entiende la navegación', () => {
  const nav = leer('src', 'navigation', 'AppNavigator.js');
  for (const ruta of RUTAS) {
    const primera = ruta.replace(/^\//, '').split('/')[0];
    assert.match(nav, new RegExp(`: '${primera}(/|')`), `${ruta} no existe en el linking de AppNavigator`);
  }
  // Términos, políticas y la galería de QA se leen en el navegador: no se
  // reclaman para la app.
  for (const fuera of ['terminos', 'privacidad', 'cookies', 'ui-reservas']) {
    assert.ok(!RUTAS.some((r) => r.includes(fuera)), `${fuera} no debería abrir la app`);
  }
});

test('el linking acepta el dominio de los enlaces', () => {
  const nav = leer('src', 'navigation', 'AppNavigator.js');
  assert.match(nav, new RegExp(`'https://${DOMINIO.replace(/\./g, '\\.')}'`));
});

test('lo que se comparte apunta al dominio sin redirección', () => {
  const share = leer('src', 'components', 'partidos', 'ShareSheet.js');
  assert.match(share, /BASE_URL = 'https:\/\/www\.futfinder\.cl\/p\/'/);
});

test('apple-app-site-association nombra a la app y a sus rutas', () => {
  const aasa = generarAppleAppSiteAssociation(TEAM_ID, expo.ios.bundleIdentifier);
  assert.deepEqual(aasa.applinks.details[0].appIDs, [`${TEAM_ID}.${expo.ios.bundleIdentifier}`]);
  assert.deepEqual(aasa.applinks.details[0].components.map((c) => c['/']), RUTAS);
});

test('el Team ID de Apple tiene que tener la forma de uno', () => {
  assert.throws(() => generarAppleAppSiteAssociation('PENDIENTE', 'com.futfinder.app'), /Team ID/);
  assert.throws(() => generarAppleAppSiteAssociation('abcde12345', 'com.futfinder.app'), /Team ID/);
});

test('assetlinks.json nombra al paquete y a la huella, en mayúsculas', () => {
  const [enlace] = generarAssetLinks(expo.android.package, [HUELLA]);
  assert.deepEqual(enlace.relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(enlace.target.namespace, 'android_app');
  assert.equal(enlace.target.package_name, expo.android.package);
  assert.deepEqual(enlace.target.sha256_cert_fingerprints, [HUELLA.toUpperCase()]);
});

test('una huella que no es SHA-256 se rechaza', () => {
  assert.throws(() => generarAssetLinks('com.futfinder.app', ['PENDIENTE']), /SHA-256/);
  assert.throws(() => generarAssetLinks('com.futfinder.app', []), /huella/);
  assert.throws(() => generarAssetLinks('com.futfinder.app', ['AA:BB']), /SHA-256/);
});

test('Vercel sirve el archivo de Apple como JSON', () => {
  const vercel = JSON.parse(leer('vercel.json'));
  const regla = (vercel.headers || []).find((h) => h.source === '/.well-known/apple-app-site-association');
  assert.ok(regla, 'falta la regla de cabeceras para apple-app-site-association');
  const tipo = regla.headers.find((h) => h.key.toLowerCase() === 'content-type');
  assert.equal(tipo?.value, 'application/json');
});

test('si los archivos ya están publicados, coinciden con lo que declara la app', () => {
  const aasaRuta = path.join(RAIZ, 'public', '.well-known', 'apple-app-site-association');
  const assetRuta = path.join(RAIZ, 'public', '.well-known', 'assetlinks.json');
  if (fs.existsSync(aasaRuta)) {
    const aasa = JSON.parse(fs.readFileSync(aasaRuta, 'utf8'));
    const [appId] = aasa.applinks.details[0].appIDs;
    const teamId = appId.split('.')[0];
    assert.deepEqual(aasa, generarAppleAppSiteAssociation(teamId, expo.ios.bundleIdentifier));
  }
  if (fs.existsSync(assetRuta)) {
    const [enlace] = JSON.parse(fs.readFileSync(assetRuta, 'utf8'));
    assert.deepEqual(
      [enlace],
      generarAssetLinks(expo.android.package, enlace.target.sha256_cert_fingerprints)
    );
  }
});
