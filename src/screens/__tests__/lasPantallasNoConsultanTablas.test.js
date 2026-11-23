/**
 * Las pantallas no consultan tablas: piden a `src/services/`.
 *
 * Quedaban seis consultas `.from(...)` sueltas en cuatro pantallas (Inicio,
 * el hilo del chat, el cambio de partido de clubes y la propuesta de
 * desafío). Tres eran la MISMA consulta de membresías copiada a mano. Una
 * consulta en una pantalla no la ve quien cambia la tabla, ni la RLS, ni las
 * pruebas de los servicios.
 *
 * Esta prueba va por el texto de cada pantalla: si alguien vuelve a escribir
 * `.from('tabla')` en una, falla con el nombre del archivo. El arreglo es
 * mover la consulta a un servicio, no agregar una excepción.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..');

test('ninguna pantalla consulta una tabla de Supabase directo', () => {
  const culpables = [];
  for (const archivo of fs.readdirSync(DIR).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(DIR, archivo), 'utf8');
    const lineas = src.split('\n');
    lineas.forEach((l, i) => {
      if (/\.from\(\s*['"`]/.test(l) && !/^\s*(\/\/|\*)/.test(l)) culpables.push(`${archivo}:${i + 1}`);
    });
  }
  assert.deepEqual(culpables, [], 'consultas directas en pantallas: muévelas a src/services/');
});
