#!/usr/bin/env node
/**
 * Borra los archivos de Storage en la limpieza antes del lanzamiento.
 *
 * Va DESPUÉS de `limpieza.sql`: las cuentas que quedan en `profiles` son las
 * que se conservan, y sus fotos de perfil y galería se quedan; todo lo demás
 * se borra (regla en `archivos.js`). Se borra por la API de Storage, que es
 * la única vía (`storage.protect_delete` frena el SQL) y la que además
 * invalida la copia del CDN.
 *
 * Uso (la clave de servicio va sólo en la línea de comandos, nunca a un
 * archivo):
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/limpieza-prelanzamiento/limpiar-storage.mjs            # ensayo: sólo lista
 *   ... node scripts/limpieza-prelanzamiento/limpiar-storage.mjs --ejecutar
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const { clasificarArchivos, lotesPorBucket } = require('./archivos.js');

const url = process.env.SUPABASE_URL;
const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ejecutar = process.argv.includes('--ejecutar');

if (!url || !clave) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}

const admin = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });

async function listar(bucket, carpeta = '', profundidad = 0) {
  if (profundidad > 6) throw new Error(`Demasiado profundo en ${bucket}/${carpeta}`);
  const rutas = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(bucket).list(carpeta, { limit: 100, offset });
    if (error) throw new Error(`No pude listar ${bucket}/${carpeta}: ${error.message}`);
    for (const e of data || []) {
      const ruta = carpeta ? `${carpeta}/${e.name}` : e.name;
      if (e.id === null) rutas.push(...(await listar(bucket, ruta, profundidad + 1)));
      else if (e.name !== '.emptyFolderPlaceholder') rutas.push(ruta);
    }
    if (!data || data.length < 100) break;
  }
  return rutas;
}

// Guarda: si la base todavía tiene partidos o clubes, el SQL no corrió y
// `profiles` no es la lista de cuentas conservadas. Se frena.
for (const tabla of ['matches', 'clubs']) {
  const { count, error } = await admin.from(tabla).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`No pude contar ${tabla}: ${error.message}`);
  if (count > 0) {
    console.error(`La tabla ${tabla} tiene ${count} filas: corre primero limpieza.sql. No se tocó nada.`);
    process.exit(1);
  }
}

const { data: perfiles, error: ePerfiles } = await admin.from('profiles').select('id');
if (ePerfiles) throw new Error(`No pude leer profiles: ${ePerfiles.message}`);
const conservar = (perfiles || []).map((p) => p.id);

const { data: buckets, error: eBuckets } = await admin.storage.listBuckets();
if (eBuckets) throw new Error(`No pude listar los buckets: ${eBuckets.message}`);

const archivos = [];
for (const b of buckets) {
  for (const ruta of await listar(b.id)) archivos.push({ bucket: b.id, ruta });
}

const { borrar, quedan } = clasificarArchivos(archivos, conservar);
console.log(`Cuentas conservadas: ${conservar.length}`);
console.log(`Archivos: ${archivos.length} · se borran ${borrar.length} · se quedan ${quedan.length}`);
const resumen = {};
for (const a of borrar) resumen[a.bucket] = (resumen[a.bucket] || 0) + 1;
for (const [bucket, n] of Object.entries(resumen)) console.log(`  ${bucket}: ${n}`);

if (!ejecutar) {
  console.log('\nEnsayo: no se borró nada. Para borrar, repite con --ejecutar.');
  process.exit(0);
}

let borrados = 0;
for (const lote of lotesPorBucket(borrar)) {
  const { error } = await admin.storage.from(lote.bucket).remove(lote.rutas);
  if (error) throw new Error(`Falló un lote en ${lote.bucket} tras ${borrados} borrados: ${error.message}`);
  borrados += lote.rutas.length;
}
console.log(`Listo: ${borrados} archivos borrados.`);
