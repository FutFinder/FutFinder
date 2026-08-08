import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase, isSupabaseConfigured } from './supabase';
import {
  computeTargetDimensions,
  uploadGalleryPhotoWithCleanup,
  deletePhotoWithCompensation,
} from '../utils/profileEdit';

const MAX_PHOTOS = 12;
export { MAX_PHOTOS };

export async function getProfilePhotos(userId) {
  if (!isSupabaseConfigured || !userId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('profile_photos')
    .select('id, photo_url, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) console.error('[FutFinder] getProfilePhotos:', error);
  return { data: data || [], error };
}

// Helpers internos de upload (misma lógica que storage.js)
function extFromAsset(asset) {
  const fromMime = (asset.mimeType || '').split('/').pop();
  if (fromMime && ['jpeg', 'jpg', 'png', 'webp', 'gif'].includes(fromMime)) {
    return fromMime === 'jpeg' ? 'jpg' : fromMime;
  }
  const fromName = (asset.fileName || asset.uri || '').split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  return 'jpg';
}

function base64ToBytes(base64) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = (base64 || '').replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const bytes = new Uint8Array((len * 3) >> 2);
  let p = 0, buffer = 0, bits = 0;
  for (let i = 0; i < len; i++) {
    const c = B64.indexOf(clean[i]);
    if (c === -1) continue;
    buffer = (buffer << 6) | c;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes[p++] = (buffer >> bits) & 0xff; }
  }
  return bytes.subarray(0, p);
}

async function getUploadBody(asset) {
  if (Platform.OS === 'web' && asset.file) return asset.file;
  if (asset.base64) return base64ToBytes(asset.base64);
  const response = await fetch(asset.uri);
  return await response.blob();
}

// Igual criterio que `resizeAndCompress` en storage.js: redimensiona si
// excede el máximo y siempre reencoda/comprime a JPEG antes de subir, así
// nunca se sube una foto de galería a resolución/tamaño de cámara.
async function resizeAndCompress(asset) {
  try {
    const target = computeTargetDimensions(asset.width, asset.height);
    const actions = target ? [{ resize: target }] : [];
    const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress: 0.7,
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
    console.warn('[FutFinder] resizeAndCompress (galería) fallback a original:', e?.message);
    return asset;
  }
}

async function removeFromGalleryBucket(path) {
  if (!path) return { error: null };
  const { error } = await supabase.storage.from('profile-gallery').remove([path]);
  if (error) console.warn('[FutFinder] removeFromGalleryBucket:', error);
  return { error };
}

/**
 * Sube una foto a la galería. Si Storage funciona pero falla la fila en
 * `profile_photos`, el archivo recién subido se borra (no queda huérfano)
 * — orquestado por `uploadGalleryPhotoWithCleanup` en `utils/profileEdit.js`.
 */
export async function uploadGalleryPhoto(asset, userId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!asset || !userId) return { data: null, error: { message: 'Faltan datos' } };

  return uploadGalleryPhotoWithCleanup({
    uploadFile: async () => {
      const processed = await resizeAndCompress(asset);
      const ext = extFromAsset(processed);
      const path = `${userId}/${Date.now()}.${ext}`;
      const contentType = processed.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const body = await getUploadBody(processed);

      const { error: uploadError } = await supabase.storage
        .from('profile-gallery')
        .upload(path, body, { contentType, cacheControl: '3600' });
      if (uploadError) {
        console.error('[FutFinder] uploadGalleryPhoto storage:', uploadError);
        return { error: uploadError };
      }

      const { data: urlData } = supabase.storage.from('profile-gallery').getPublicUrl(path);
      const url = `${urlData.publicUrl}?t=${Date.now()}`;
      return { url, path };
    },
    writeRecord: async ({ url }) => {
      const { data, error } = await supabase
        .from('profile_photos')
        .insert({ user_id: userId, photo_url: url })
        .select()
        .single();
      if (error) console.error('[FutFinder] uploadGalleryPhoto db:', error);
      return { data, error };
    },
    removeFile: removeFromGalleryBucket,
  });
}

/**
 * Borra una foto de la galería. Primero la fila de `profile_photos` (nunca
 * deja la BD apuntando a un objeto que después no se pudo borrar) y solo si
 * eso funciona intenta borrar el archivo de Storage, con reintentos — ver
 * `deletePhotoWithCompensation` en `utils/profileEdit.js`. Si el archivo
 * queda como huérfano tras los reintentos, no se reporta como error: para
 * el usuario la foto ya desapareció de su galería.
 */
export async function deleteProfilePhoto(id, photoUrl, userId) {
  if (!isSupabaseConfigured) return { error: null };

  const match = (photoUrl || '').match(/profile-gallery\/(.+?)(?:\?|$)/);
  const path = match?.[1] || null;

  const { error, orphaned } = await deletePhotoWithCompensation({
    deleteRecord: async () => {
      const { error } = await supabase
        .from('profile_photos')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      if (error) console.error('[FutFinder] deleteProfilePhoto db:', error);
      return { error };
    },
    removeFile: () => removeFromGalleryBucket(path),
  });

  if (orphaned) {
    console.warn('[FutFinder] deleteProfilePhoto: archivo huérfano en profile-gallery:', path);
  }

  return { error };
}
