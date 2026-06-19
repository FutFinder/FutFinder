import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Galería de fotos de un club (tabla club_photos + bucket club-gallery).
 * Espejo de gallery.js (galería de perfil), pero la escritura/borrado los
 * limita la RLS a los admins del club.
 */

const MAX_PHOTOS = 12;
export { MAX_PHOTOS };

export async function getClubPhotos(clubId) {
  if (!isSupabaseConfigured || !clubId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('club_photos')
    .select('id, photo_url, created_at')
    .eq('club_id', clubId)
    .order('created_at', { ascending: false });
  if (error) console.error('[FutFinder] getClubPhotos:', error);
  return { data: data || [], error };
}

// Helpers de upload (misma lógica que gallery.js / storage.js)
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

export async function uploadClubPhoto(asset, clubId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!asset || !clubId) return { data: null, error: { message: 'Faltan datos' } };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: { message: 'No autenticado' } };

  const ext = extFromAsset(asset);
  const filename = `${Date.now()}.${ext}`;
  const path = `${clubId}/${filename}`;
  const contentType = asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const body = await getUploadBody(asset);
  const { error: uploadError } = await supabase.storage
    .from('club-gallery')
    .upload(path, body, { contentType, cacheControl: '3600' });

  if (uploadError) {
    console.error('[FutFinder] uploadClubPhoto storage:', uploadError);
    return { data: null, error: uploadError };
  }

  const { data: urlData } = supabase.storage
    .from('club-gallery')
    .getPublicUrl(path);
  const url = `${urlData.publicUrl}?t=${Date.now()}`;

  const { data, error } = await supabase
    .from('club_photos')
    .insert({ club_id: clubId, photo_url: url, uploaded_by: user.id })
    .select()
    .single();

  if (error) {
    console.error('[FutFinder] uploadClubPhoto db:', error);
    return { data: null, error };
  }
  return { data, error: null };
}

export async function deleteClubPhoto(id, photoUrl, clubId) {
  if (!isSupabaseConfigured) return { error: null };

  // Extraer path del storage desde la URL pública
  const match = (photoUrl || '').match(/club-gallery\/(.+?)(?:\?|$)/);
  if (match?.[1]) {
    const { error: storageErr } = await supabase.storage
      .from('club-gallery')
      .remove([match[1]]);
    if (storageErr) console.warn('[FutFinder] deleteClubPhoto storage:', storageErr);
  }

  const { error } = await supabase
    .from('club_photos')
    .delete()
    .eq('id', id)
    .eq('club_id', clubId);

  if (error) console.error('[FutFinder] deleteClubPhoto db:', error);
  return { error };
}
