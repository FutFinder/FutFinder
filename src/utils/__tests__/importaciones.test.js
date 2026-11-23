const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Que todo lo que una pantalla importa de `src/utils` o `src/services`
 * exista de verdad.
 *
 * POR QUÉ ESTA PRUEBA. `TarifasScreen` importaba `horaAMinutos` y
 * `bloquesDeTarifa` de `recintoPantallas`, y las dos viven en
 * `recintoAgenda`. En JavaScript eso no es un error: los nombres llegan como
 * `undefined` y la pantalla revienta recién al dibujarse, con un mensaje que
 * no nombra el archivo equivocado. La app quedaba en blanco al tocar
 * «Tarifas» y nada lo avisaba antes — ni el lint, ni las pruebas, ni el
 * empaquetado.
 *
 * Es el mismo agujero que `no-undef` cubre para las variables sueltas y que
 * nadie cubría para los imports.
 *
 * TAMBIÉN MIRA `src/services` DESDE EL 2026-10-21, y no por simetría: sólo
 * se cubría `utils`, y el mismo fallo volvió a pasar una carpeta más allá.
 * `ClubProposalScreen` pedía `NIVELES` a `services/clubChallengeRules`, que
 * lo IMPORTA de `matchRules` para validar pero no lo reexporta: llegaba
 * `undefined` y «Crear propuesta oficial» —el paso que convierte un desafío
 * en partido— reventaba al dibujarse, cada vez, para todos. Los módulos de
 * reglas de `services` son tan puros como los de `utils`; los que arrastran
 * Supabase no se pueden cargar desde Node y se saltan solos más abajo.
 *
 * LO QUE NO CUBRE, dicho de frente: unos pocos módulos de `utils` no se
 * pueden cargar desde Node —arrastran `expo-modules-core`, que viene en
 * TypeScript, o datos que Metro resuelve y Node no— y esos se saltan. Son
 * `appVersion`, `notify` y `clubMeta`. Lo que importen queda sin comprobar;
 * el resto, que es casi todo, sí.
 */

const RAIZ = path.resolve(__dirname, '../..');

/** Todos los .js de src, sin pruebas. */
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

/** `import { a, b as c } from '<ruta>'` → [{ ruta, nombres }]. */
function importacionesDeUtils(codigo) {
  const encontradas = [];
  const re = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m = re.exec(codigo);
  while (m) {
    const ruta = m[2];
    if (/(^|\/)(utils|services)\//.test(ruta)) {
      const nombres = m[1]
        .split(',')
        .map((x) => x.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      encontradas.push({ ruta, nombres });
    }
    m = re.exec(codigo);
  }
  return encontradas;
}

test('todo lo que se importa de src/utils y src/services existe en ese módulo', () => {
  const problemas = [];

  for (const archivo of archivosDeFuente()) {
    const codigo = fs.readFileSync(archivo, 'utf8');
    for (const { ruta, nombres } of importacionesDeUtils(codigo)) {
      const destino = path.resolve(path.dirname(archivo), ruta);
      let modulo;
      try {
        modulo = require(destino.endsWith('.js') ? destino : `${destino}.js`);
      } catch {
        // El módulo no se puede cargar desde Node. No es un hallazgo: es un
        // límite de esta prueba, y contarlo como problema la volvería ruido
        // que nadie mira.
        continue;
      }
      for (const nombre of nombres) {
        if (!(nombre in modulo)) {
          problemas.push(
            `${path.relative(RAIZ, archivo)} importa "${nombre}" de "${ruta}", que no lo exporta`,
          );
        }
      }
    }
  }

  assert.deepEqual(problemas, [], `\n${problemas.join('\n')}\n`);
});
