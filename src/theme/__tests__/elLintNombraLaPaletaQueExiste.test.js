const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * El mensaje de `no-restricted-imports` es lo que lee quien choca con la
 * regla, y mandaba a usar `reservas`/`reservasRadius`/`reservasSizes`/
 * `reservasFonts`: nombres que ya no existen (hoy `paleta`, `radios`,
 * `medidas` y `fuentes`). Un mensaje de error que manda a un import roto.
 *
 * Esta prueba exige que todo lo que el mensaje recomienda sea un export real
 * de `src/theme/colors.js`, y que los prohibidos no lo sean.
 */

const RAIZ = path.join(__dirname, '..', '..', '..');
const LINT = fs.readFileSync(path.join(RAIZ, 'eslint.config.mjs'), 'utf8');
const tema = require('../colors.js');

function reglaDePaleta() {
  const ini = LINT.indexOf("'no-restricted-imports'");
  assert.ok(ini > 0, 'no se encontró la regla de la paleta');
  return LINT.slice(ini, LINT.indexOf('}],', ini));
}

test('el mensaje del lint recomienda exports que existen', () => {
  const regla = reglaDePaleta();
  const ini = regla.indexOf('message:');
  assert.ok(ini > 0, 'no se encontró el mensaje');
  const texto = regla.slice(ini);
  const recomendados = [...texto.matchAll(/`(\w+)`/g)].map((x) => x[1]);
  assert.ok(recomendados.length > 0, 'el mensaje no nombra la paleta');
  for (const nombre of recomendados) {
    assert.ok(nombre in tema, `el mensaje manda a usar «${nombre}», que colors.js no exporta`);
  }
});

test('los nombres prohibidos no son exports vivos', () => {
  const regla = reglaDePaleta();
  const lista = regla.match(/importNames:\s*\[([\s\S]*?)\]/);
  assert.ok(lista);
  const prohibidos = [...lista[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
  for (const nombre of prohibidos) {
    assert.ok(!(nombre in tema), `«${nombre}» está prohibido pero colors.js lo exporta`);
  }
});

test('el mensaje no manda a un documento que no existe', () => {
  const rutas = reglaDePaleta().match(/docs\/[\w./-]+\.md/g) || [];
  for (const r of rutas) {
    assert.ok(fs.existsSync(path.join(RAIZ, r)), `el mensaje cita ${r}, que no existe`);
  }
});
