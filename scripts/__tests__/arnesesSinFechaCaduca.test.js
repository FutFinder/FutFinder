/**
 * Un arnés con una fecha del calendario escrita a mano es una bomba con
 * fecha de estallido.
 *
 * LO QUE PASÓ (2026-10-17). Once arneses del vertical de Reservas montaban
 * su escenario sobre `date '2027-03-01'`. Funcionaba, y el 2 de marzo de
 * 2027 iban a ponerse rojos los ocho que crean una reserva ahí: desde la
 * migración 84, `crear_reserva` rechaza el pasado. Ocho arneses en rojo a
 * la vez, por el calendario, sin que nadie hubiera tocado una línea.
 *
 * La regla: la fecha de un escenario se CALCULA desde `now()`. Si de
 * verdad hace falta una fecha fija —comprobar una conversión de zona
 * horaria, el cruce de la medianoche— se deja dicho en un comentario con
 * las palabras «no caduca», y entonces esta prueba la deja pasar. La
 * exención se declara en el propio archivo, no en una lista que vive acá y
 * que nadie vuelve a leer.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'supabase', 'tests');
const FECHA = /\bdate\s+'(\d{4})-\d{2}-\d{2}'/g;
const LINEAS_DE_GRACIA = 4;

test('ningún arnés monta su escenario sobre una fecha del calendario', () => {
  const culpables = [];
  for (const archivo of fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'))) {
    const lineas = fs.readFileSync(path.join(DIR, archivo), 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      // Un comentario que MENCIONA una fecha fija (como el que explica por
      // qué se quitó) no es una fecha fija.
      if (/^\s*--/.test(linea)) return;
      FECHA.lastIndex = 0;
      if (!FECHA.test(linea)) return;
      const contexto = lineas.slice(Math.max(0, i - LINEAS_DE_GRACIA), i + 1).join('\n');
      if (/no caduca/i.test(contexto)) return;
      culpables.push(`${archivo}:${i + 1}  ${linea.trim()}`);
    });
  }
  assert.deepEqual(
    culpables,
    [],
    'calcula la fecha desde now(), o explica en un comentario por qué «no caduca»:\n  ' +
      culpables.join('\n  ')
  );
});
