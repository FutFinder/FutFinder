#!/usr/bin/env node
/**
 * Corre TODOS los arneses de `supabase/tests/` contra una base, y dice
 * cuáles pasan.
 *
 * POR QUÉ NO EXISTÍA. Los arneses se escriben uno por migración y se corren
 * cuando se escriben — pegándolos a mano en el editor SQL de Supabase. Nadie
 * los había corrido JUNTOS contra el esquema actual, porque contra producción
 * cada uno siembra y revierte y hacerlo 120 veces a mano no es realista.
 * Desde que hay base local (`scripts/construir-base.mjs`) sí lo es.
 *
 * PARA QUÉ SIRVE DE VERDAD: para saber si una migración nueva rompió el
 * arnés de una vieja. Cambiar el cuerpo de una función que otra migración
 * probó hace meses no falla en ninguna parte hasta que alguien vuelve a
 * correr ese arnés — y nadie vuelve.
 *
 * TODOS TERMINAN EN `ROLLBACK`, así que no dejan nada. Se comprueba antes de
 * correr ninguno: uno que no lo tuviera escribiría de verdad.
 *
 * Uso:
 *   node scripts/correr-arneses.mjs              # todos
 *   node scripts/correr-arneses.mjs 15           # sólo los que empiecen por 15
 */

import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = path.join(RAIZ, 'supabase', 'tests');
const FILTRO = process.argv[2] || '';

// Puerto alternativo para el barrido del reloj: `PGPORT_ARNESES=5433` apunta
// a un segundo postmaster levantado dentro del mismo contenedor con la hora
// falseada (ver `scripts/barrido-reloj.mjs`). Sin la variable, todo sigue
// igual que siempre.
const PUERTO = process.env.PGPORT_ARNESES || '';

function contenedor() {
  try {
    const n = execFileSync('docker',
      ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'],
      { encoding: 'utf8' }).trim().split('\n').filter(Boolean)[0];
    return n || null;
  } catch (_) { return null; }
}

const CT = contenedor();
if (!CT) {
  console.error('No hay contenedor `supabase_db_*` corriendo. Levanta la base local primero.');
  process.exit(1);
}

const archivos = readdirSync(TESTS)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => !FILTRO || f.startsWith(FILTRO))
  .sort();

// Ninguno puede escribir de verdad. Se comprueba ANTES de correr nada: uno
// sin `rollback` dejaría filas en la base, y si algún día esto se apunta a
// producción por error, sería irreversible.
const sinRollback = archivos.filter(
  (f) => !/^\s*rollback\s*;/mi.test(readFileSync(path.join(TESTS, f), 'utf8'))
);
if (sinRollback.length) {
  console.error('Estos arneses no terminan en ROLLBACK y escribirían de verdad:');
  for (const f of sinRollback) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`${archivos.length} arneses contra ${CT}\n`);

const fallos = [];
let n = 0;

for (const f of archivos) {
  const sql = readFileSync(path.join(TESTS, f));
  try {
    execFileSync('docker',
      ['exec', '-i', CT, 'psql', '-U', 'postgres', '-d', 'postgres',
       ...(PUERTO ? ['-p', PUERTO] : []),
       '-v', 'ON_ERROR_STOP=1', '-q'],
      { input: sql, stdio: ['pipe', 'ignore', 'pipe'] });
    n += 1;
  } catch (e) {
    // La primera línea que empieza por ERROR es la que importa; el resto es
    // el contexto de PL/pgSQL, que en un arnés de 200 líneas es ruido.
    const err = (e.stderr || Buffer.from('')).toString();
    const linea = err.split('\n').find((l) => l.startsWith('ERROR:')) || err.split('\n')[0];
    fallos.push({ f, linea: (linea || '').trim().slice(0, 160) });
  }
}

console.log(`✔ ${n}/${archivos.length} pasaron\n`);
if (fallos.length) {
  console.log(`✖ ${fallos.length} fallaron:\n`);
  for (const { f, linea } of fallos) console.log(`  ${f}\n    ${linea}\n`);
  process.exit(1);
}
