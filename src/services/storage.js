import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase, isSupabaseConfigured } from './supabase';
import { computeTargetDimensions } from '../utils/profileEdit';

/**
 * Servicio de fotos:
 *  - pickImage: abre el picker nativo / del navegador
 *  - uploadAvatar: sube mi foto de perfil al bucket `avatars` y devuelve URL pública
 *  - uploadMatchCover: sube portada del partido al bucket `match-covers`
 *
 * Paths:
 *   avatars/<userId>/avatar.<ext>
 *   match-covers/<matchId>/cover.<ext>
 *
 * Las políticas RLS de storage.objects validan que solo el dueño escriba.
 */

/**
 * Pide permiso (en nativo) y abre el picker. Devuelve:
 *   { ok, asset?, reason? }
 *  asset: { uri, base64?, mimeType?, fileSize?, width, height, fileName? }
 */
export async function pickImage({ aspect = [1, 1], quality = 0.7, base64 = true } = {}) {
  try {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        return { ok: false, reason: 'Permiso de fotos denegado' };
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect,
      quality,
      // Por defecto true: necesario para subir bien en nativo (RN no maneja
      // blob de file://). Los llamadores que redimensionan antes de subir
      // (ver `resizeAndCompress`) pueden pedir base64:false acá y obtener el
      // base64 recién del resultado ya redimensionado, mucho más liviano.
      base64,
    });

    if (result.canceled) return { ok: false, reason: 'Cancelado' };
    const asset = result.assets?.[0];
    if (!asset) return { ok: false, reason: 'No se pudo leer la imagen' };
    return { ok: true, asset };
  } catch (e) {
    return { ok: false, reason: e?.message || 'Error abriendo el picker' };
  }
}

/**
 * Igual que pickImage pero permite elegir VARIAS fotos a la vez.
 * La selección múltiple desactiva el recorte por imagen (allowsEditing).
 * Devuelve { ok, assets?, reason? } con assets = array.
 *   selectionLimit: tope de fotos (0 = sin tope en iOS).
 */
export async function pickImages({ quality = 0.7, selectionLimit = 0, base64 = true } = {}) {
  try {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        return { ok: false, reason: 'Permiso de fotos denegado' };
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit, // iOS respeta el límite; en otras plataformas lo validamos aparte
      quality,
      base64, // necesario para subir bien en nativo si no se redimensiona antes
    });

    if (result.canceled) return { ok: false, reason: 'Cancelado' };
    const assets = result.assets || [];
    if (assets.length === 0) return { ok: false, reason: 'No se pudo leer la imagen' };
    return { ok: true, assets };
  } catch (e) {
    return { ok: false, reason: e?.message || 'Error abriendo el picker' };
  }
}

// Saca una extensión razonable del asset
function extFromAsset(asset) {
  const fromMime = (asset.mimeType || '').split('/').pop();
  if (fromMime && ['jpeg', 'jpg', 'png', 'webp', 'gif'].includes(fromMime)) {
    return fromMime === 'jpeg' ? 'jpg' : fromMime;
  }
  const fromName = (asset.fileName || asset.uri || '').split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  return 'jpg';
}

// Decodifica base64 → Uint8Array (sin dependencias externas).
function base64ToBytes(base64) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = (base64 || '').replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const bytes = new Uint8Array((len * 3) >> 2);
  let p = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const c = B64.indexOf(clean[i]);
    if (c === -1) continue;
    buffer = (buffer << 6) | c;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[p++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, p);
}

// Devuelve el cuerpo correcto para subir según la plataforma.
//  - Web con File → el File directo
//  - Nativo con base64 → Uint8Array (la forma confiable en RN)
//  - Fallback → blob vía fetch
async function getUploadBody(asset) {
  if (Platform.OS === 'web' && asset.file) return asset.file;
  if (asset.base64) return base64ToBytes(asset.base64);
  const response = await fetch(asset.uri);
  return await response.blob();
}

async function uploadToBucket(bucket, path, body, contentType) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, {
      upsert: true,
      contentType,
      cacheControl: '3600',
    });
  if (error) return { error };
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  // Cache-bust por si actualizamos la misma URL
  const url = data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null;
  return { url };
}

async function removeFromBucket(bucket, path) {
  if (!path) return { error: null };
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) console.warn(`[FutFinder] removeFromBucket ${bucket}/${path}:`, error);
  return { error };
}

/**
 * Extrae el path dentro de un bucket a partir de la URL pública que
 * devuelve Supabase (incluyendo el `?t=` de cache-bust). Devuelve `null`
 * si la URL no corresponde a ese bucket — no hay como inventar un path
 * a partir de algo que no calza.
 */
export function pathFromPublicUrl(url, bucket) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + marker.length).split('?')[0];
  return path ? decodeURIComponent(path) : null;
}

/**
 * Redimensiona (si excede el máximo) y comprime una imagen antes de
 * subirla, para no cargar en memoria ni transferir más de lo necesario.
 * Reencoda siempre a JPEG: es lo único que necesitamos para avatar/portada
 * y evita mantener casos especiales por formato de origen.
 *
 * Pide base64 solo en nativo (ahí `getUploadBody` lo necesita porque RN no
 * maneja bien blob de file://); en web el resultado se sube directo por
 * blob, así que no hace falta cargar un base64 en memoria.
 *
 * Si `expo-image-manipulator` falla en alguna plataforma, no bloqueamos la
 * subida: se sigue con la imagen original sin redimensionar.
 */
async function resizeAndCompress(asset, { maxDimension, compress = 0.7 } = {}) {
  try {
    const target = computeTargetDimensions(asset.width, asset.height, maxDimension);
    const actions = target ? [{ resize: target }] : [];
    const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: Platform.OS !== 'web',
    });
    return {
      uri: result.uri,
      base64: result.base64,
      mimeType: 'image/jpeg',
      width: result.width,
      height: result.height,
    };
  } catch (e) {
    console.warn('[FutFinder] resizeAndCompress fallback a original:', e?.message);
    return asset;
  }
}

/**
 * Redimensiona/comprime y sube mi foto de perfil al bucket `avatars`.
 * A propósito NO toca `profiles`: quien llama decide cuándo confirmar el
 * cambio (ver `commitProfileSave` en `utils/profileEdit.js`), para poder
 * limpiar el archivo huérfano si el guardado del perfil falla después.
 * Devuelve { url, path, error }.
 */
export async function uploadAvatarFile(asset) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!asset) return { error: { message: 'Sin imagen' } };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: { message: 'No autenticado' } };

  const processed = await resizeAndCompress(asset);
  const ext = extFromAsset(processed);
  const path = `${user.id}/avatar.${ext}`;
  const contentType = processed.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const body = await getUploadBody(processed);
  const { error, url } = await uploadToBucket('avatars', path, body, contentType);
  if (error) {
    console.error('[FutFinder] uploadAvatarFile:', error);
    return { error };
  }

  return { url, path };
}

/**
 * Sube portada de un partido y actualiza matches.foto_url.
 * RLS valida que sea el organizador.
 */
export async function uploadMatchCover(matchId, asset) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!asset || !matchId) return { error: { message: 'Faltan datos' } };

  const ext = extFromAsset(asset);
  const path = `${matchId}/cover.${ext}`;
  const contentType = asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const body = await getUploadBody(asset);
  const { error, url } = await uploadToBucket('match-covers', path, body, contentType);
  if (error) {
    console.error('[FutFinder] uploadMatchCover:', error);
    return { error };
  }

  await supabase
    .from('matches')
    .update({ foto_url: url })
    .eq('id', matchId);

  return { url };
}

/**
 * Sube el logo de un club al bucket `club-logos` y actualiza clubs.foto_url.
 * RLS valida que el usuario sea admin del club.
 */
export async function uploadClubLogo(clubId, asset) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!asset || !clubId) return { error: { message: 'Faltan datos' } };

  const ext = extFromAsset(asset);
  const path = `${clubId}/logo.${ext}`;
  const contentType = asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const body = await getUploadBody(asset);
  const { error, url } = await uploadToBucket('club-logos', path, body, contentType);
  if (error) {
    console.error('[FutFinder] uploadClubLogo:', error);
    return { error };
  }

  await supabase
    .from('clubs')
    .update({ foto_url: url })
    .eq('id', clubId);

  return { url };
}

/**
 * Sube el banner (portada) de un club. Reutiliza el bucket `club-logos`
 * en <clubId>/banner.<ext> y actualiza clubs.banner_url.
 * RLS valida que el usuario sea admin del club.
 */
export async function uploadClubBanner(clubId, asset) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!asset || !clubId) return { error: { message: 'Faltan datos' } };

  const ext = extFromAsset(asset);
  const path = `${clubId}/banner.${ext}`;
  const contentType = asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const body = await getUploadBody(asset);
  const { error, url } = await uploadToBucket('club-logos', path, body, contentType);
  if (error) {
    console.error('[FutFinder] uploadClubBanner:', error);
    return { error };
  }

  await supabase
    .from('clubs')
    .update({ banner_url: url })
    .eq('id', clubId);

  return { url };
}

/**
 * Redimensiona/comprime y sube la portada del perfil al bucket `avatars`,
 * en `<user_id>/banner.<ext>` — mismo espacio del avatar, hereda sus
 * políticas de acceso.
 *
 * Igual que `uploadAvatarFile`, NO escribe `profiles.banner_url`: eso lo
 * hace `commitProfileSave` recién cuando confirma que todo lo demás salió
 * bien (incluyendo el caso migración-30-no-aplicada, que ahora maneja
 * `updateMyProfile` en `profile.js`).
 * Devuelve { url, path, error }.
 */
export async function uploadBannerFile(asset) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!asset) return { error: { message: 'Falta la imagen' } };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: { message: 'No autenticado' } };

  const processed = await resizeAndCompress(asset);
  const ext = extFromAsset(processed);
  const path = `${user.id}/banner.${ext}`;
  const contentType = processed.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const body = await getUploadBody(processed);
  const { error, url } = await uploadToBucket('avatars', path, body, contentType);
  if (error) {
    console.error('[FutFinder] uploadBannerFile:', error);
    return { error };
  }

  return { url, path };
}

/** Borra un archivo del bucket `avatars` (avatar o portada) por su path. */
export const removeAvatarBucketFile = (path) => removeFromBucket('avatars', path);
