#!/usr/bin/env node
/**
 * Construye una base de FutFinder desde cero, desde este repositorio.
 *
 * PARA QUÉ. Hasta ahora nadie había comprobado que el repositorio sepa
 * levantar una base vacía: todo se verificaba contra producción, que ya
 * tiene la historia aplicada. Una migración que dependa de algo que nunca
 * se versionó no se nota ahí — se nota el día que haya que reconstruir.
 *
 * EL ORDEN ES LA PARTE DIFÍCIL, y no es retórica: ningún `sort` acierta.
 * El alfabético mete la 100 entre la 09 y la 10; `sort -V` pone la 44b
 * antes que la 44. Las dos fallan al APLICAR, no al leer, y para entonces
 * la base ya está a medias. Ver `scripts/ordenMigraciones.js`.
 *
 * QUÉ APLICA, EN ESTE ORDEN:
 *   1. `supabase/schema.sql` — la base de la Fase 2, idempotente.
 *   2. Cada archivo de `supabase/migrations/`, por número y después por
 *      letra (44, 44b, 44c…).
 *   3. Las cuatro fases de TrueScore, encendidas. Las migraciones las dejan
 *      apagadas y producción las tiene encendidas desde el 2026-09-24: sin
 *      este paso la base se comporta como el FutFinder anterior, y eso no
 *      se ve en ninguna huella de esquema.
 *
 * LA 149 SE APLICA. En una base nueva no hay apps instaladas que romper,
 * que es lo único que la mantiene fuera de producción. O sea: una base
 * construida con esto se diferencia de producción EXACTAMENTE en la 149.
 * Con `--sin-149` se omite y quedan iguales.
 *
 * ESPERA UNA BASE VACÍA. No es un «aplica lo que falte»: varias migraciones
 * crean políticas y publicaciones sin guardia, así que correrlo sobre una
 * base ya construida falla a media lista. Para repetirlo, contenedores
 * nuevos: `supabase stop && supabase start`. Ojo con `supabase db reset` a
 * secas — vacía la base pero deja el contenedor de storage con su esquema
 * ya creado, y entonces la migración 08 no encuentra `storage.buckets`.
 *
 * Uso:
 *   node scripts/construir-base.mjs                     # contra la base local
 *   node scripts/construir-base.mjs --sin-149
 *   DB=postgresql://… node scripts/construir-base.mjs
 *
 * Necesita `psql` en el PATH, o un contenedor de Postgres al que llegar.
 * Con el stack local de Supabase levantado (`supabase start`), el valor por
 * omisión de `DB` ya apunta ahí.
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ordenarMigraciones } from './ordenMigraciones.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRACIONES = path.join(RAIZ, 'supabase', 'migrations');
const SCHEMA = path.join(RAIZ, 'supabase', 'schema.sql');

const DB = process.env.DB || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SIN_149 = process.argv.includes('--sin-149');

/**
 * Cómo hablarle a la base.
 *
 * `psql` en el PATH es lo directo, pero en un Mac de desarrollo normalmente
 * no está —el stack local de Supabase trae el suyo DENTRO del contenedor—.
 * Así que si no hay psql y sí hay un contenedor `supabase_db_*` corriendo,
 * se usa ése. Es la diferencia entre que este script funcione en la máquina
 * de quien lo necesite y que no.
 */
function comoLlamar() {
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' });
    return { modo: 'psql' };
  } catch (_) { /* no está, se prueba el contenedor */ }

  try {
    const salida = execFileSync('docker',
      ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'],
      { encoding: 'utf8' }).trim();
    const nombre = salida.split('\n').filter(Boolean)[0];
    if (nombre) return { modo: 'docker', contenedor: nombre };
  } catch (_) { /* tampoco hay docker */ }

  return { modo: null };
}

const COMO = comoLlamar();

function aplicar(archivo, etiqueta) {
  try {
    // `-v ON_ERROR_STOP=1` es lo que convierte esto en una comprobación: sin
    // él psql sigue adelante tras un error y termina diciendo que todo bien
    // sobre una base rota.
    if (COMO.modo === 'psql') {
      execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-q', '-f', archivo],
        { stdio: ['ignore', 'ignore', 'pipe'] });
    } else {
      // Dentro del contenedor la base es local, así que la cadena de
      // conexión de afuera no sirve: se usa el socket de siempre.
      const sql = readFileSync(archivo);
      execFileSync('docker',
        ['exec', '-i', COMO.contenedor, 'psql', '-U', 'postgres', '-d', 'postgres',
         '-v', 'ON_ERROR_STOP=1', '-q'],
        { input: sql, stdio: ['pipe', 'ignore', 'pipe'] });
    }
    return { ok: true };
  } catch (e) {
    const err = (e.stderr || Buffer.from('')).toString().trim();
    return { ok: false, error: err || e.message, etiqueta };
  }
}

/**
 * Deja los INTERRUPTORES como los tiene producción.
 *
 * LAS MIGRACIONES CREAN LAS FASES DE TRUESCORE APAGADAS, a propósito: se
 * encendieron a mano el 2026-09-24, una por una. Una base recién construida
 * se comporta entonces como el FutFinder anterior a TrueScore — la salida de
 * un partido cuesta 3 fijos en vez de salir de la tabla por horas de aviso,
 * una cuenta nace en 100 en vez de 75— y eso no es un detalle: el
 * 2026-10-16 la suite daba 125/125 con los interruptores apagados y 119/125
 * con los de producción. Seis arneses afirmaban la regla vieja y nadie se
 * había enterado.
 *
 * Las huellas de ESQUEMA no lo ven: es una fila de `feature_flags`.
 */
function encenderLoMismoQueProduccion() {
  const sql = [
    'truescore_activar_fase1',
    'truescore_activar_fase2',
    'truescore_activar_fase3',
    'truescore_activar_fase4',
  ].map((f) => `select public.${f}();`).join('\n');
  try {
    if (COMO.modo === 'psql') {
      execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql],
        { stdio: ['ignore', 'ignore', 'pipe'] });
    } else {
      execFileSync('docker',
        ['exec', '-i', COMO.contenedor, 'psql', '-U', 'postgres', '-d', 'postgres',
         '-v', 'ON_ERROR_STOP=1', '-q'],
        { input: Buffer.from(sql), stdio: ['pipe', 'ignore', 'pipe'] });
    }
    return { ok: true };
  } catch (e) {
    const err = (e.stderr || Buffer.from('')).toString().trim();
    return { ok: false, error: err || e.message };
  }
}

function main() {
  if (!existsSync(SCHEMA)) {
    console.error(`No encuentro ${SCHEMA}`);
    process.exit(1);
  }

  const archivos = ordenarMigraciones(
    readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql'))
  ).filter((f) => !(SIN_149 && f.startsWith('149_')));

  if (!COMO.modo) {
    console.error('No encuentro `psql` ni un contenedor `supabase_db_*` corriendo.');
    process.exit(1);
  }
  console.log(COMO.modo === 'psql'
    ? `Base: ${DB.replace(/:[^:@]*@/, ':···@')}`
    : `Base: dentro del contenedor ${COMO.contenedor}`);
  console.log(`schema.sql + ${archivos.length} migraciones\n`);

  const paso = aplicar(SCHEMA, 'schema.sql');
  if (!paso.ok) {
    console.error(`✖ schema.sql\n${paso.error}`);
    process.exit(1);
  }
  console.log('✔ schema.sql');

  let n = 0;
  for (const f of archivos) {
    const r = aplicar(path.join(MIGRACIONES, f), f);
    if (!r.ok) {
      // Se para en la PRIMERA que falla y se dice cuántas iban: seguir
      // adelante produciría una cascada de errores derivados que esconde
      // cuál fue el problema de verdad.
      console.error(`\n✖ ${f}  (la número ${n + 1} de ${archivos.length})\n`);
      console.error(r.error);
      process.exit(1);
    }
    n += 1;
    if (n % 20 === 0) console.log(`  … ${n}/${archivos.length}`);
  }

  console.log(`\n✔ ${n}/${archivos.length} migraciones aplicadas`);

  const flags = encenderLoMismoQueProduccion();
  if (!flags.ok) {
    console.error(`\n✖ no se pudieron encender las fases de TrueScore\n${flags.error}`);
    process.exit(1);
  }
  console.log('✔ las cuatro fases de TrueScore encendidas, como producción');

  console.log(SIN_149
    ? 'Sin la 149: esta base debería ser equivalente a producción.'
    : 'Con la 149 aplicada: esta base se diferencia de producción en eso y sólo en eso.');
}

main();
