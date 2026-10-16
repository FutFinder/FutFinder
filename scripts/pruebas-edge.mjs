#!/usr/bin/env node
/**
 * Corre las pruebas de las Edge Functions, que son de Deno y no de Node.
 *
 * POR QUÉ EXISTE ESTE ENVOLTORIO. `supabase/functions/` tiene 49 pruebas
 * —`flowLogic.test.ts`, `correoSolicitud.test.ts`, `correoReporte.test.ts`
 * y `pushLogic.test.ts`— que `npm test` no ve: Node no sabe correr
 * TypeScript de Deno, y el glob de `npm test` sólo mira `src/` y
 * `scripts/`. Estaban versionadas y nadie las corría salvo a mano.
 *
 * Y POR QUÉ NO CALLA SI FALTA DENO. Si no está instalado, esto termina en
 * 0 —no bloquea a quien no lo tenga— pero lo dice en una línea imposible
 * de no ver. Un paso que se salta en silencio es peor que no tenerlo: da
 * la sensación de que algo se comprobó cuando no se comprobó nada. Es la
 * misma lección del glob de `npm test`, que se tragó ocho pruebas sin
 * decir una palabra.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(raiz, 'supabase', 'functions');

if (!existsSync(dir)) {
  console.log('No hay supabase/functions: nada que correr.');
  process.exit(0);
}

const hayDeno = spawnSync('deno', ['--version'], { stdio: 'ignore' });
if (hayDeno.error || hayDeno.status !== 0) {
  console.log('');
  console.log('⚠️  DENO NO ESTÁ INSTALADO: las 49 pruebas de las Edge Functions NO se corrieron.');
  console.log('   Instálalo con `brew install deno` y vuelve a correr `npm run verify`.');
  console.log('   (Esto no bloquea el resto, pero tampoco está comprobado.)');
  console.log('');
  process.exit(0);
}

const r = spawnSync('deno', ['test'], { cwd: dir, stdio: 'inherit' });
process.exit(r.status ?? 1);
