/**
 * Plugin de Babel: importa cada ícono de Lucide desde su propio archivo.
 *
 *   import { ArrowLeft, Check as Tick } from 'lucide-react-native';
 *     ↓
 *   import ArrowLeft from 'lucide-react-native/dist/esm/icons/arrow-left.js';
 *   import Tick from 'lucide-react-native/dist/esm/icons/check.js';
 *
 * POR QUÉ. Metro no descarta lo que no se usa: importar un ícono desde la
 * raíz del paquete arrastra los ~1.500 que trae. Medido el 2026-11-14 con el
 * source map del build web: Lucide pesaba 1,2 MB de los 7,2 MB del bundle,
 * más que todas las pantallas de la app juntas, para usar unos 150 íconos.
 *
 * DE DÓNDE SALE LA TABLA. Del índice del propio paquete
 * (`dist/esm/lucide-react-native.js`), leído al cargar la configuración: cada
 * línea `export { default as X, default as XIcon… } from './icons/x.js'`
 * dice en qué archivo vive cada nombre, alias incluidos (`CheckCircle2` vive
 * en `circle-check.js`). No hay lista escrita a mano que mantener, y al
 * actualizar Lucide la tabla se actualiza sola.
 *
 * SI NO SABE, NO TOCA. Un nombre que no está en la tabla (`icons`, `Icon`,
 * `createLucideIcon`, un `import *`) se deja importado desde la raíz, que
 * funciona igual que antes —sólo que arrastra todo—. Si el índice no se
 * puede leer, el plugin no hace nada. `scripts/__tests__/lucidePorIcono.test.js`
 * falla si en `src/` queda alguna importación que no se pudo reescribir.
 */
const fs = require('node:fs');
const path = require('node:path');

const PAQUETE = 'lucide-react-native';
const SUBRUTA = 'dist/esm';

/** `{ ArrowLeft: 'lucide-react-native/dist/esm/icons/arrow-left.js', … }` */
function leerTabla(raizDelPaquete) {
  const tabla = Object.create(null);
  let indice;
  try {
    indice = fs.readFileSync(path.join(raizDelPaquete, SUBRUTA, `${PAQUETE}.js`), 'utf8');
  } catch (_) {
    return tabla;
  }
  const linea = /^export \{([^}]*)\} from '\.\/icons\/([\w-]+)\.js';$/gm;
  for (const m of indice.matchAll(linea)) {
    const destino = `${PAQUETE}/${SUBRUTA}/icons/${m[2]}.js`;
    for (const parte of m[1].split(',')) {
      const nombre = /default as (\w+)/.exec(parte);
      if (nombre) tabla[nombre[1]] = destino;
    }
  }
  return tabla;
}

function raizPorOmision() {
  try {
    return path.dirname(require.resolve(`${PAQUETE}/package.json`));
  } catch (_) {
    return path.join(__dirname, '..', '..', 'node_modules', PAQUETE);
  }
}

function lucidePorIcono({ types: t }, opciones = {}) {
  const tabla = opciones.tabla || leerTabla(opciones.raiz || raizPorOmision());
  return {
    name: 'futfinder-lucide-por-icono',
    visitor: {
      ImportDeclaration(ruta) {
        const nodo = ruta.node;
        if (nodo.source.value !== PAQUETE) return;
        if (nodo.importKind === 'type') return;

        const nuevas = [];
        const quedan = [];
        for (const esp of nodo.specifiers) {
          const nombre = t.isImportSpecifier(esp)
            && esp.importKind !== 'type'
            && (esp.imported.name || esp.imported.value);
          const destino = nombre && tabla[nombre];
          if (!destino) {
            quedan.push(esp);
            continue;
          }
          nuevas.push(t.importDeclaration(
            [t.importDefaultSpecifier(t.identifier(esp.local.name))],
            t.stringLiteral(destino),
          ));
        }
        if (!nuevas.length) return;

        if (quedan.length) {
          nodo.specifiers = quedan;
          ruta.insertAfter(nuevas);
        } else {
          ruta.replaceWithMultiple(nuevas);
        }
      },
    },
  };
}

module.exports = lucidePorIcono;
module.exports.leerTabla = leerTabla;
module.exports.raizPorOmision = raizPorOmision;
