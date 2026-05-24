import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase, isSupabaseConfigured } from './supabase';

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
export async function pickImage({ aspect = [1, 1], quality = 0.7 } = {}) {
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
      base64: true, // necesario para subir bien en nativo (RN no maneja blob de file://)
    });

    if (result.canceled) return { ok: false, reason: 'Cancelado' };
    const asset = result.assets?.[0];
    if (!asset) return { ok: false, reason: 'No se pudo leer la imagen' };
    return { ok: true, asset };
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

/**
 * Sube mi foto de perfil y actualiza profiles.foto_url.
 * Devuelve { url, error }.
 */
export async function uploadAvatar(asset) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!asset) return { error: { message: 'Sin imagen' } };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: { message: 'No autenticado' } };

  const ext = extFromAsset(asset);
  const path = `${user.id}/avatar.${ext}`;
  const contentType = asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  const body = await getUploadBody(asset);
  const { error, url } = await uploadToBucket('avatars', path, body, contentType);
  if (error) {
    console.error('[FutFinder] uploadAvatar:', error);
    return { error };
  }

  // Guardar URL en mi perfil
  await supabase
    .from('profiles')
    .update({ foto_url: url, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  return { url };
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
