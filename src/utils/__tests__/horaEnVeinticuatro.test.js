/**
 * En FutFinder la hora se escribe 20:00, nunca «08:00 p. m.».
 *
 * EL FALLO (2026-10-19, abriendo el chat de un partido de prueba). La
 * cabecera del chat decía **«mar, 08:00 p m. · Ñuñoa»** mientras la
 * tarjeta, la ficha del partido y la hora de cada mensaje decían 20:00. Dos
 * cosas en una línea:
 *
 *   · `toLocaleDateString('es-CL', { hour, minute })` SIN `hour12: false`
 *     resuelve a 12 horas en este runtime;
 *   · y `replace('.', '')` se lleva sólo el PRIMER punto —el de «mar.»—,
 *     así que lo que quedaba a la vista era «p m.», que no es nada.
 *
 * `hour12: false` no es decoración: sin él, el formato depende de qué datos
 * de ICU traiga el dispositivo, y entonces la misma pantalla se ve distinta
 * en dos teléfonos.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..');

function* archivos(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* archivos(p);
    else if (e.name.endsWith('.js')) yield p;
  }
}

test('toda hora con formato local se pide en 24 horas', () => {
  const culpables = [];
  for (const archivo of archivos(SRC)) {
    const texto = fs.readFileSync(archivo, 'utf8');
    // Cada llamada a toLocale(Date|Time|)String con sus opciones, aunque
    // estén repartidas en varias líneas.
    for (const m of texto.matchAll(/toLocale(?:Date|Time)?String\s*\(([^;]*?)\)\s*[;.,)\n]/gs)) {
      const args = m[1];
      if (!/\bhour\s*:/.test(args)) continue;          // no pide hora: da igual
      if (/hour12\s*:\s*false/.test(args)) continue;   // ya está fijado
      const linea = texto.slice(0, m.index).split('\n').length;
      culpables.push(`${path.relative(SRC, archivo)}:${linea}`);
    }
  }
  assert.deepEqual(
    culpables,
    [],
    'pide la hora sin `hour12: false`, así que puede salir «08:00 p. m.»:\n  ' +
      culpables.join('\n  ')
  );
});
