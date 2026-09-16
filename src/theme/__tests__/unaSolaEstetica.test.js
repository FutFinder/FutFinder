const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tema = require('../colors.js');

/**
 * Que la app tenga UNA sola estética, y que unificarla no deje tokens muertos.
 *
 * POR QUÉ EXISTE ESTA PRUEBA. `src/theme/colors.js` llegó a exportar siete
 * familias de tokens —`colors`, `dsColors`, `clubColors`, `chatColors`,
 * `tactical`, `partidos` y `reservas`— con cuatro verdes y tres fondos
 * distintos. La decisión del 2026-09-16 es dejar una sola: `reservas`
 * (`#55DF69` + Manrope). Las demás pasan a derivarse de ella.
 *
 * EL PELIGRO DE ESE CAMBIO NO ES EL COLOR, ES EL HUECO. En React Native un
 * token que no existe no avisa: `undefined` como `backgroundColor` pinta
 * transparente y como `color` pinta negro. No lo ve el lint, no lo ve el
 * empaquetador y no lo ve ninguna prueba de lógica — solo se nota abriendo la
 * pantalla. Con ~100 archivos repartidos en seis familias, comprobarlo a mano
 * es abrir la app cien veces.
 *
 * Así que la primera prueba NO parte de lo que el theme declara, sino de lo
 * que el código REFERENCIA de verdad: recorre `src/`, mira qué familias
 * importa cada archivo y con qué nombre local, y junta cada `X.clave` que
 * aparece. Si alguna de esas claves deja de tener valor, falla acá y no en el
 * teléfono.
 *
 * LO QUE NO CUBRE, dicho de frente: solo ve el acceso por punto
 * (`C.green`). Un `const { green } = C` o un `C[variable]` se le escapan. Es
 * el patrón dominante del repositorio y cubrirlo entero pediría un analizador
 * de sintaxis; se eligió la red que atrapa el 99% en veinte líneas.
 */

const RAIZ = path.resolve(__dirname, '../..');

/** Las familias de color que el rediseño unifica. Sin radios ni tipografías. */
const FAMILIAS = [
  'tactical',
  'clubsExplorer',
  'reservas',
];

function archivosDeFuente(dir = RAIZ, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name !== '__tests__' && entrada.name !== 'node_modules') {
        archivosDeFuente(completo, acc);
      }
    } else if (entrada.name.endsWith('.js')) {
      acc.push(completo);
    }
  }
  return acc;
}

/**
 * Las claves que el código usa de cada familia.
 *
 * Hay que seguir el nombre LOCAL y no el exportado: casi todo el repositorio
 * importa `reservas as C`, así que buscar `reservas.` no encontraría nada.
 */
function clavesUsadas() {
  const usadas = new Map(FAMILIAS.map((f) => [f, new Set()]));

  for (const archivo of archivosDeFuente()) {
    const codigo = fs.readFileSync(archivo, 'utf8');
    // El patrón acepta `theme/colors` Y `./colors.js`: `theme/clubThemes.js`
    // importa por la ruta corta, y con el patrón que sólo miraba `theme/colors`
    // este recorrido no lo veía. Se descubrió al borrar `dsColors` — la prueba
    // pasó y el empaquetado falló, que es exactamente al revés de lo que esta
    // prueba existe para lograr.
    const imports = codigo.matchAll(
      /import\s*\{([^}]+)\}\s*from\s*['"][^'"]*colors(?:\.js)?['"]/g
    );
    for (const imp of imports) {
      for (const parte of imp[1].split(',')) {
        const limpio = parte.trim();
        if (!limpio) continue;
        const trozos = limpio.split(/\s+as\s+/);
        const exportado = trozos[0].trim();
        const local = trozos[trozos.length - 1].trim();
        if (!usadas.has(exportado)) continue;
        const accesos = codigo.matchAll(
          new RegExp(`\\b${local}\\.([A-Za-z0-9_]+)`, 'g')
        );
        for (const acceso of accesos) usadas.get(exportado).add(acceso[1]);
      }
    }
  }
  return usadas;
}

test('ninguna clave de color que el código usa se quedó sin valor', () => {
  const usadas = clavesUsadas();
  const huecos = [];

  for (const [familia, claves] of usadas) {
    for (const clave of claves) {
      if (tema[familia]?.[clave] === undefined) {
        huecos.push(`${familia}.${clave}`);
      }
    }
  }

  assert.deepEqual(
    huecos,
    [],
    `Estos tokens se usan en el código y no tienen valor. En React Native eso `
      + `no avisa: pinta transparente o negro.\n  ${huecos.join('\n  ')}`
  );
});

test('el recorrido del código toca las familias que quedan, no solo una', () => {
  // Si esta prueba deja de encontrar una familia es porque ya nadie la usa:
  // ahí toca borrarla de `FAMILIAS` y del theme, no relajar la comprobación.
  const usadas = clavesUsadas();
  const vivas = [...usadas].filter(([, claves]) => claves.size > 0);
  assert.ok(
    vivas.length >= 1,
    'El recorrido no encontró ninguna familia: el analizador se rompió.'
  );
});

// ─────────────────────────────── la unificación propiamente tal

/**
 * El verde de acción de cada familia, con el nombre que usa cada una.
 *
 * `tactical` lo llama `neon` y el resto `green`. Que se llamen distinto es
 * exactamente la deuda que estas pruebas cierran.
 */
const VERDE_DE = {
  tactical: 'neon',
  clubsExplorer: 'green',
  reservas: 'green',
};

const FONDO_DE = {
  tactical: 'bg',
  clubsExplorer: 'bg',
  reservas: 'bg',
};

test('todas las familias comparten el mismo verde de acción', () => {
  const esperado = tema.reservas.green;
  for (const [familia, clave] of Object.entries(VERDE_DE)) {
    assert.equal(
      tema[familia][clave],
      esperado,
      `${familia}.${clave} no es el verde único (${esperado}). `
        + `Un segundo verde en la app es la deuda que este rediseño cierra.`
    );
  }
});

test('todas las familias comparten el mismo fondo de página', () => {
  const esperado = tema.reservas.bg;
  for (const [familia, clave] of Object.entries(FONDO_DE)) {
    assert.equal(
      tema[familia][clave],
      esperado,
      `${familia}.${clave} no es el fondo único (${esperado}).`
    );
  }
});

test('los cinco rojos de la app son uno solo', () => {
  // Existían con cinco valores distintos en cinco familias: `colors.error`
  // (#E5484D), `clubColors.loss` y `partidos.coral` (#E8737B),
  // `chatColors.danger` (#FF7A6B) y `reservas.red` (#ED6B76). Las familias se
  // van borrando a medida que su módulo migra, así que esta lista ENCOGE: lo
  // que no puede pasar es que alguna de las que quedan se desvíe.
  const esperado = tema.reservas.red;
  assert.equal(tema.tactical.danger, esperado);
});

test('el texto principal no se volvió verde en ninguna familia', () => {
  // La garantía que se le dio a Vicente: el verde cambia de tono, no se
  // expande. Si el texto principal de alguna familia terminara en el verde de
  // acción, el mapeo por rol se hizo mal.
  const verde = tema.reservas.green;
  for (const familia of FAMILIAS) {
    const paleta = tema[familia];
    const texto = paleta.textPrimary ?? paleta.text;
    assert.notEqual(
      texto,
      verde,
      `${familia}: el texto principal quedó del color de acción.`
    );
  }
});
