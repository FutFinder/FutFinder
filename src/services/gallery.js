import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';

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

export async function uploadGalleryPhoto(asset, userId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!asset || !userId) return { data: null, error: { message: 'Faltan datos' } };

  const ext = extFromAsset(asset);
  const filename = `${Date.now()}.${ext}`;
  const path = `${userId}/${filename}`;
  const contentType = asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const body = await getUploadBody(asset);
  const { error: uploadError } = await supabase.storage
    .from('profile-gallery')
    .upload(path, body, { contentType, cacheControl: '3600' });

  if (uploadError) {
    console.error('[FutFinder] uploadGalleryPhoto storage:', uploadError);
    return { data: null, error: uploadError };
  }

  const { data: urlData } = supabase.storage
    .from('profile-gallery')
    .getPublicUrl(path);
  const url = `${urlData.publicUrl}?t=${Date.now()}`;

  const { data, error } = await supabase
    .from('profile_photos')
    .insert({ user_id: userId, photo_url: url })
    .select()
    .single();

  if (error) {
    console.error('[FutFinder] uploadGalleryPhoto db:', error);
    return { data: null, error };
  }
  return { data, error: null };
}

export async function deleteProfilePhoto(id, photoUrl, userId) {
  if (!isSupabaseConfigured) return { error: null };

  // Extraer path del storage desde la URL pública
  const match = (photoUrl || '').match(/profile-gallery\/(.+?)(?:\?|$)/);
  if (match?.[1]) {
    const { error: storageErr } = await supabase.storage
      .from('profile-gallery')
      .remove([match[1]]);
    if (storageErr) console.warn('[FutFinder] deleteProfilePhoto storage:', storageErr);
  }

  const { error } = await supabase
    .from('profile_photos')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) console.error('[FutFinder] deleteProfilePhoto db:', error);
  return { error };
}
