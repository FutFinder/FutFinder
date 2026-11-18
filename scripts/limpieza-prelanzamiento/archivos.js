/**
 * Qué archivos de Storage se borran en la limpieza antes del lanzamiento.
 *
 * Lógica pura (sin red) para probarla con `node --test`; el recorrido y el
 * borrado de verdad están en `limpiar-storage.mjs`.
 *
 * Regla: se borra TODO, salvo lo de las cuentas que se conservan en los
 * buckets donde la primera carpeta es el uuid de la persona y el archivo es
 * de su perfil (foto y galería). Los buckets de clubes, recintos y partidos
 * se vacían enteros, porque esas tablas quedan vacías; las capturas de
 * soporte y las fotos de solicitudes, también, porque sus tickets y
 * solicitudes se borran.
 */

const BUCKETS_DE_PERFIL = ['avatars', 'profile-gallery'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `true` si el archivo es de una cuenta conservada y se queda. */
function seConserva(bucket, ruta, conservar) {
  if (!BUCKETS_DE_PERFIL.includes(bucket)) return false;
  const carpeta = String(ruta || '').split('/')[0];
  return UUID.test(carpeta) && conservar.has(carpeta.toLowerCase());
}

/**
 * Separa los archivos en los que se borran y los que se quedan.
 * @param {Array<{bucket: string, ruta: string}>} archivos
 * @param {Iterable<string>} idsConservados
 */
function clasificarArchivos(archivos, idsConservados) {
  const conservar = new Set([...(idsConservados || [])].map((id) => String(id).toLowerCase()));
  const borrar = [];
  const quedan = [];
  for (const a of archivos || []) {
    (seConserva(a.bucket, a.ruta, conservar) ? quedan : borrar).push(a);
  }
  return { borrar, quedan };
}

/** Agrupa rutas por bucket en lotes de `tamano`, que es lo que acepta `remove()`. */
function lotesPorBucket(archivos, tamano = 100) {
  const porBucket = new Map();
  for (const a of archivos || []) {
    if (!porBucket.has(a.bucket)) porBucket.set(a.bucket, []);
    porBucket.get(a.bucket).push(a.ruta);
  }
  const lotes = [];
  for (const [bucket, rutas] of porBucket) {
    for (let i = 0; i < rutas.length; i += tamano) {
      lotes.push({ bucket, rutas: rutas.slice(i, i + tamano) });
    }
  }
  return lotes;
}

module.exports = { clasificarArchivos, lotesPorBucket, BUCKETS_DE_PERFIL };
