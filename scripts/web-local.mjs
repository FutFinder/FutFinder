#!/usr/bin/env node
/**
 * Levanta la app web contra la BASE LOCAL, no contra producción.
 *
 * PARA QUÉ. Hasta ahora la única forma de abrir FutFinder era contra
 * `jvfoendzblkoxvwvommz`: el `.env` apunta ahí. Eso significa que probar un
 * flujo de verdad —registrarse, crear un partido, inscribirse, escribir en
 * el chat— implicaba escribir en producción, así que no se hacía. Desde que
 * `scripts/construir-base.mjs` levanta una base idéntica a producción, no
 * hace falta: la app puede hablarle a esa.
 *
 * LA CLAVE QUE VA ACÁ NO ES UN SECRETO. El stack local del CLI de Supabase
 * usa SIEMPRE el mismo par URL/clave anónima de demostración, publicado en
 * su documentación, firmado con `super-secret-jwt-token-with-at-least-32-
 * characters-long` y válido únicamente contra un Postgres que corre en esta
 * máquina. No abre nada de producción. Aun así se puede sobrescribir con
 * las variables de entorno de siempre, por si el stack local corre en otro
 * puerto.
 *
 * EL `.env` SE APARTA MIENTRAS DURA, y hay que hacerlo. Pasar las variables
 * en el proceso NO alcanza: Expo mete los valores del archivo en un módulo
 * del bundle que los asigna a `process.env` EN TIEMPO DE EJECUCIÓN, y ése
 * gana. Se comprobó leyendo el bundle servido: traía los DOS valores —el
 * local en las definiciones y el de producción en ese módulo— y la app abría
 * contra producción igual, con la sesión y los datos de verdad. Tampoco
 * bastó `EXPO_NO_DOTENV=1`, que sí apaga la carga en `@expo/env` pero no
 * impidió que el valor terminara dentro del bundle.
 *
 * Así que el archivo se renombra al arrancar y se devuelve al terminar —
 * también si te vas con Ctrl-C—, y si un corte dejó el respaldo tirado, el
 * siguiente arranque lo repone antes de nada. `npm run web` sigue leyendo su
 * `.env` de siempre.
 *
 * Uso:
 *   npm run web:local
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const URL_LOCAL = 'http://127.0.0.1:54321';
const ANON_LOCAL =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9' +
  '.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const url = process.env.SUPABASE_LOCAL_URL || URL_LOCAL;
const anon = process.env.SUPABASE_LOCAL_ANON_KEY || ANON_LOCAL;

if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(url)) {
  console.error(`web:local es SÓLO para la base local y ${url} no lo es.`);
  process.exit(1);
}

// ── El .env, a un lado ───────────────────────────────────────────
const ENV = path.join(RAIZ, '.env');
const GUARDADO = path.join(RAIZ, '.env.guardado-por-web-local');

// Un arranque anterior que no pudo terminar de limpiar deja el respaldo ahí.
// Reponerlo es lo primero: es el `.env` de verdad de alguien.
if (fs.existsSync(GUARDADO) && !fs.existsSync(ENV)) {
  fs.renameSync(GUARDADO, ENV);
  console.log('Se repuso el .env que había quedado apartado por una corrida anterior.');
}

let apartado = false;
function apartarEnv() {
  if (!fs.existsSync(ENV)) return;
  // EL RESPALDO TIENE QUE ESTAR IGNORADO POR GIT, y se comprueba en vez de
  // confiar: es el `.env` de verdad con otro nombre, y un `git add -A`
  // mientras esto corre lo subiría entero. Pasó el 2026-10-16 — lo frenó la
  // protección de secretos de GitHub, no la revisión de nadie. Si el
  // `.gitignore` perdiera la línea, esto se niega a arrancar en vez de
  // dejar el archivo expuesto.
  const r = spawnSync('git', ['check-ignore', '-q', path.basename(GUARDADO)], { cwd: RAIZ });
  if (r.status !== 0) {
    console.error(
      `\n${path.basename(GUARDADO)} NO está en .gitignore.\n` +
        'Es tu .env con otro nombre: agrégalo al .gitignore antes de seguir.\n'
    );
    process.exit(1);
  }
  fs.renameSync(ENV, GUARDADO);
  apartado = true;
}
function reponerEnv() {
  if (!apartado) return;
  apartado = false;
  try {
    if (fs.existsSync(GUARDADO)) fs.renameSync(GUARDADO, ENV);
  } catch (e) {
    console.error(`\nNO SE PUDO REPONER EL .env. Está en ${GUARDADO}; renómbralo a .env.`, e);
  }
}

apartarEnv();
process.on('exit', reponerEnv);
for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(senal, () => {
    reponerEnv();
    process.exit(0);
  });
}
process.on('uncaughtException', (e) => {
  reponerEnv();
  throw e;
});

console.log(`FutFinder web contra la base LOCAL: ${url}`);
console.log(apartado ? 'El .env de producción está apartado mientras dure esto.' : '');
console.log('(`npm run web` sigue usando el .env de producción.)\n');

// `--clear` SIEMPRE, y no es exceso de celo. `process.env.EXPO_PUBLIC_*` se
// INCRUSTA en el bundle cuando Metro transforma, así que un bundle cacheado
// de un `npm run web` anterior sigue trayendo dentro la URL de PRODUCCIÓN
// aunque este proceso exporte la local. Pasó la primera vez que se corrió
// esto: la app abrió con la sesión y los datos de producción y el `.env`
// nunca se tocó. Un arranque más lento es barato al lado de creer que estás
// probando contra una base local cuando estás escribiendo en la de verdad.
const hijo = spawn('npx', ['expo', 'start', '--web', '--clear'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    // Sin esto, `.env` gana. Ver la nota de arriba.
    EXPO_NO_DOTENV: '1',
    EXPO_PUBLIC_SUPABASE_URL: url,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: anon,
    // Sin token de Mapbox el mapa web no se dibuja, y es lo correcto: no se
    // gasta cuota de un token real en una prueba local.
    EXPO_PUBLIC_MAPBOX_TOKEN: process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '',
    EXPO_PUBLIC_SENTRY_DSN: '',
  },
});
hijo.on('exit', (c) => {
  reponerEnv();
  process.exit(c ?? 0);
});
