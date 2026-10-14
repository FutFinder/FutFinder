/**
 * Qué variables de entorno necesita un build, de verdad.
 *
 * POR QUÉ ESTA PRUEBA EXISTE. `.env` está en `.gitignore` y EAS no lo sube,
 * así que cada perfil de build tiene que declarar las suyas **a mano** en la
 * nube de Expo. Si falta una, el build no falla: sale y se comporta distinto
 * —sin backend, sin mapa, sin informes de error— y eso se descubre con el
 * teléfono en la mano.
 *
 * La lista estaba escrita a mano en `docs/memoria/arquitectura/despliegue-y-entornos.md`
 * y ya se había quedado corta: decía tres y el código lee cuatro. Esta
 * prueba la saca del CÓDIGO, que es la única fuente que no se desactualiza,
 * y falla si aparece una variable nueva que nadie documentó.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');

/** Todo archivo .js de `src/`, más los de la raíz que lee el bundler. */
function fuentes(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '__tests__') fuentes(completo, acc);
    } else if (e.name.endsWith('.js')) {
      acc.push(completo);
    }
  }
  return acc;
}

function variablesLeidas() {
  const archivos = [
    ...fuentes(path.join(RAIZ, 'src')),
    path.join(RAIZ, 'App.js'),
    path.join(RAIZ, 'app.config.js'),
  ].filter((f) => fs.existsSync(f));

  const vistas = new Set();
  for (const f of archivos) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const m of txt.matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)) {
      vistas.add(m[1]);
    }
  }
  return [...vistas].sort();
}

/**
 * Las que el código lee hoy, con lo que pasa si faltan. Cuando alguien
 * agregue una, esta prueba lo obliga a decidir —y a escribir— qué pasa sin
 * ella, que es la pregunta que de verdad importa.
 */
const CONOCIDAS = {
  EXPO_PUBLIC_SUPABASE_URL: 'sin ella la app entra en modo de demostración: pantallas sin backend',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'lo mismo que la anterior',
  EXPO_PUBLIC_MAPBOX_TOKEN: 'sin ella no hay mapa ni autocompletado de direcciones; la lista y los filtros siguen',
  EXPO_PUBLIC_SENTRY_DSN: 'sin ella no se manda ningún informe de error; la app funciona igual',
};

test('no hay ninguna variable de entorno que nadie haya documentado', () => {
  const leidas = variablesLeidas();
  const sinDocumentar = leidas.filter((v) => !(v in CONOCIDAS));
  assert.deepEqual(sinDocumentar, [],
    'Hay variables EXPO_PUBLIC_* que el código lee y que no están en CONOCIDAS. '
    + 'Agrégalas acá con lo que pasa si faltan, y a `despliegue-y-entornos.md`: '
    + 'una variable que falta en un perfil de EAS no rompe el build, lo cambia.');
});

test('y ninguna documentada dejó de usarse sin que nadie lo note', () => {
  const leidas = variablesLeidas();
  const muertas = Object.keys(CONOCIDAS).filter((v) => !leidas.includes(v));
  assert.deepEqual(muertas, [],
    'Estas están documentadas pero ya no las lee nadie: quítalas de la nube de EAS también');
});

test('`.env.example` las nombra todas', () => {
  // Es lo primero que mira quien clona el repositorio. Si falta una, la
  // descubre cuando algo no funciona y no sabe por qué.
  const ejemplo = fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8');
  for (const v of Object.keys(CONOCIDAS)) {
    assert.ok(ejemplo.includes(v), `${v} no está en .env.example`);
  }
});

test('la versión de Sentry NO sale de una variable de entorno', () => {
  // Lo fue durante unas horas el 2026-10-14 y era un fallo: el `release`
  // habría llegado vacío a Sentry —nadie define esa variable— y todos los
  // informes se habrían mezclado. Sale de `app.config.js`, que es el número
  // que de verdad se publica.
  const obs = fs.readFileSync(path.join(RAIZ, 'src', 'services', 'observabilidad.js'), 'utf8');
  assert.match(obs, /release:\s*APP_VERSION/, 'el release de Sentry dejó de salir de APP_VERSION');
  // Se miran sólo las líneas de CÓDIGO: el archivo explica en un comentario
  // por qué esa variable no se usa, y una aserción que no distinga tomaría
  // la explicación por el fallo. Mismo criterio que `avisosCompletos.test.js`.
  const codigo = obs
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  assert.doesNotMatch(codigo, /EXPO_PUBLIC_APP_VERSION/,
    'volvió `EXPO_PUBLIC_APP_VERSION`, que no la define nadie');
});
