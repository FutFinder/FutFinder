/**
 * Lógica pura de «Editar perfil»: qué vista mostrar según el estado de
 * carga, validación de imágenes antes de subir, y el control de flujo de
 * guardar/reemplazar/borrar una foto (avatar, portada, galería).
 *
 * Sin Supabase ni React acá a propósito — las funciones de guardado/borrado
 * reciben las operaciones reales (Storage, `profiles`, `profile_photos`)
 * inyectadas, así se prueba el ORDEN y las decisiones (¿se limpia el
 * huérfano?, ¿se borra la foto vieja?, ¿se detiene todo si algo falla?) sin
 * tocar la red. Ver `src/utils/__tests__/profileEdit.test.js`.
 */

// ============================================================
// CARGA INICIAL
// ============================================================

/** Qué vista mostrar: nunca un formulario vacío si la carga falló. */
export function getProfileLoadStatus({ loading, error }) {
  if (loading) return 'loading';
  if (error) return 'error';
  return 'ready';
}

// ============================================================
// VALIDACIÓN DE IMÁGENES (tamaño, tipo, resolución)
// ============================================================

/** Mismo tope que el bucket `avatars` (migración 08); se aplica también a
 * la galería aunque su bucket no tenga límite propio — no hay razón para
 * permitir del lado del cliente lo que no permitiríamos en el resto. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Mismo set que `allowed_mime_types` del bucket `avatars` (migración 08). */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Piso razonable: por debajo de esto, la imagen no sirve como avatar/portada. */
export const MIN_IMAGE_DIMENSION = 64;

/**
 * Valida tamaño, tipo y resolución de un asset del picker ANTES de subir.
 * Un dato ausente (el picker no siempre entrega `fileSize`/`mimeType` en
 * todas las plataformas) no se trata como inválido — no hay como inventar
 * un valor que no vino, así que ese chequeo puntual simplemente se omite.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateImageAsset(
  asset,
  {
    maxBytes = MAX_IMAGE_BYTES,
    allowedMimeTypes = ALLOWED_IMAGE_MIME_TYPES,
    minDimension = MIN_IMAGE_DIMENSION,
  } = {}
) {
  if (!asset) return { ok: false, reason: 'No se seleccionó ninguna imagen.' };

  if (typeof asset.fileSize === 'number' && asset.fileSize > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
    return { ok: false, reason: `La imagen pesa más de ${maxMb} MB. Elige una más liviana.` };
  }

  if (asset.mimeType && !allowedMimeTypes.includes(asset.mimeType.toLowerCase())) {
    return { ok: false, reason: 'Formato no soportado. Usa JPG, PNG, WEBP o GIF.' };
  }

  if (
    typeof asset.width === 'number' &&
    typeof asset.height === 'number' &&
    (asset.width < minDimension || asset.height < minDimension)
  ) {
    return { ok: false, reason: `La imagen es demasiado pequeña (mínimo ${minDimension}×${minDimension}px).` };
  }

  return { ok: true };
}

// ============================================================
// REDIMENSIONADO: a qué tamaño apuntar
// ============================================================

/** Lado más largo al que se redimensiona antes de subir. */
export const MAX_IMAGE_DIMENSION = 1600;

/**
 * Calcula las dimensiones objetivo para no subir una imagen más grande de
 * lo necesario. Devuelve `null` si ya es lo bastante chica (no tiene sentido
 * "redimensionar" una imagen que ya cabe, solo se comprimiría de nuevo sin
 * necesidad) o si no hay medidas reales que usar.
 */
export function computeTargetDimensions(width, height, maxDimension = MAX_IMAGE_DIMENSION) {
  if (!width || !height) return null;
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return null;
  const scale = maxDimension / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// ============================================================
// GUARDAR PERFIL: subir avatar/portada nuevos, confirmar, recién
// entonces borrar los anteriores — nunca al revés.
// ============================================================

/**
 * Orquesta el guardado cuando hay 0, 1 o 2 imágenes nuevas en espera
 * (avatar y/o portada, cargados como "cambio local" desde que se
 * escogieron hasta este momento).
 *
 * Orden y garantías:
 *   1. Sube lo que haya pendiente. Si falla la subida, no se toca nada
 *      más — el perfil anterior queda intacto.
 *   2. Si algo se subió, `updateProfile` se llama con las URLs nuevas
 *      (o las de siempre, si no había nada pendiente para ese campo).
 *   3. Si `updateProfile` falla, se borra lo recién subido (huérfano) y
 *      se devuelve el error — el perfil anterior sigue siendo el vigente,
 *      tanto en Storage como en la fila de `profiles`.
 *   4. Solo si `updateProfile` tuvo éxito se borra la imagen ANTERIOR —y
 *      solo la que de verdad cambió de archivo (mismo path = ya se
 *      sobrescribió con upsert, no hay nada que borrar aparte).
 *
 * Todas las operaciones de I/O vienen inyectadas para poder probar el
 * control de flujo con operaciones falsas.
 *
 * @param {object} deps
 * @param {object|null} deps.pendingAvatar   asset local en espera, o null
 * @param {object|null} deps.pendingBanner   asset local en espera, o null
 * @param {string|null} deps.oldAvatarPath   path en Storage del avatar actual
 * @param {string|null} deps.oldBannerPath   path en Storage de la portada actual
 * @param {(asset) => Promise<{url,path,error}>} deps.uploadAvatarFile
 * @param {(asset) => Promise<{url,path,error}>} deps.uploadBannerFile
 * @param {(urls: {foto_url, banner_url}) => Promise<{error}>} deps.updateProfile
 * @param {(path: string) => Promise<{error}>} deps.removeFile
 */
export async function commitProfileSave({
  pendingAvatar = null,
  pendingBanner = null,
  oldAvatarPath = null,
  oldBannerPath = null,
  uploadAvatarFile,
  uploadBannerFile,
  updateProfile,
  removeFile,
}) {
  let newAvatar = null;
  let newBanner = null;

  if (pendingAvatar) {
    const { url, path, error } = await uploadAvatarFile(pendingAvatar);
    if (error) return { error, stage: 'avatar_upload' };
    newAvatar = { url, path };
  }

  if (pendingBanner) {
    const { url, path, error } = await uploadBannerFile(pendingBanner);
    if (error) {
      if (newAvatar) await removeFile(newAvatar.path).catch(() => {});
      return { error, stage: 'banner_upload' };
    }
    newBanner = { url, path };
  }

  const { error: updateError } = await updateProfile({
    foto_url: newAvatar?.url,
    banner_url: newBanner?.url,
  });

  if (updateError) {
    // El perfil anterior nunca se tocó (el update falló, no se aplicó nada):
    // lo único que hay que limpiar es lo que se subió recién y quedó sin usar.
    if (newAvatar) await removeFile(newAvatar.path).catch(() => {});
    if (newBanner) await removeFile(newBanner.path).catch(() => {});
    return { error: updateError, stage: 'profile_update' };
  }

  // Confirmado: recién ahora es seguro borrar la imagen anterior — y solo si
  // el archivo nuevo quedó en un path distinto (mismo path ya se sobrescribió
  // con upsert al subir, así que no hay un "anterior" separado que borrar).
  if (newAvatar && oldAvatarPath && oldAvatarPath !== newAvatar.path) {
    await removeFile(oldAvatarPath).catch(() => {});
  }
  if (newBanner && oldBannerPath && oldBannerPath !== newBanner.path) {
    await removeFile(oldBannerPath).catch(() => {});
  }

  return {
    error: null,
    newAvatarUrl: newAvatar?.url ?? null,
    newBannerUrl: newBanner?.url ?? null,
  };
}

// ============================================================
// SUBIR UNA FOTO DE GALERÍA: limpiar el huérfano si Storage
// funciona pero falla la fila de profile_photos.
// ============================================================

/**
 * @param {() => Promise<{url,path,error}>} deps.uploadFile   sube a Storage
 * @param {(info: {url,path}) => Promise<{data,error}>} deps.writeRecord   inserta en profile_photos
 * @param {(path: string) => Promise<{error}>} deps.removeFile
 */
export async function uploadGalleryPhotoWithCleanup({ uploadFile, writeRecord, removeFile }) {
  const { url, path, error: uploadError } = await uploadFile();
  if (uploadError) return { data: null, error: uploadError };

  const { data, error: writeError } = await writeRecord({ url, path });
  if (writeError) {
    // Storage funcionó, profile_photos no: no dejamos el archivo huérfano.
    await removeFile(path).catch(() => {});
    return { data: null, error: writeError };
  }

  return { data, error: null };
}

// ============================================================
// BORRAR UNA FOTO: nunca dejar la BD apuntando a un objeto que
// ya no existe.
// ============================================================

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Borra primero la fila y SOLO SI ESO FUNCIONA borra el archivo — al
 * revés (Storage primero) se puede quedar una fila apuntando a un objeto
 * que ya no existe, que es justo lo que esto evita. Un huérfano en
 * Storage (fila borrada, archivo vivo) es inofensivo — solo espacio
 * desperdiciado — así que ahí sí vale la pena reintentar en vez de
 * rendirse al primer error de red.
 *
 * @param {() => Promise<{error}>} deps.deleteRecord
 * @param {() => Promise<{error}>} deps.removeFile
 * @param {number} deps.retries   reintentos DESPUÉS del primer intento
 * @param {(ms:number) => Promise<void>} deps.sleep   inyectable para pruebas
 */
export async function deletePhotoWithCompensation({
  deleteRecord,
  removeFile,
  retries = 2,
  delayMs = 300,
  sleep = defaultSleep,
}) {
  const { error: dbError } = await deleteRecord();
  if (dbError) return { error: dbError, orphaned: false };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { error } = await removeFile();
    if (!error) return { error: null, orphaned: false };
    if (attempt < retries) await sleep(delayMs);
  }

  // La fila ya no existe (eso es lo que le importa al usuario: la foto
  // desapareció de su galería); el archivo huérfano queda registrado para
  // limpieza futura, pero no se reporta como fallo de la operación.
  return { error: null, orphaned: true };
}
