/**
 * Pruebas de la lógica pura de «Editar perfil»: qué vista mostrar según el
 * estado de carga, validación de imágenes, y el control de flujo de
 * guardar/subir/borrar (avatar, portada, galería) con inyección de fallas.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getProfileLoadStatus,
  validateImageAsset,
  MAX_IMAGE_BYTES,
  MIN_IMAGE_DIMENSION,
  computeTargetDimensions,
  commitProfileSave,
  uploadGalleryPhotoWithCleanup,
  deletePhotoWithCompensation,
} = require('../profileEdit.js');

// ---------------------------------------------------------------------------
// getProfileLoadStatus — carga fallida nunca debe mostrar un formulario vacío
// ---------------------------------------------------------------------------

test('getProfileLoadStatus: cargando manda siempre', () => {
  assert.equal(getProfileLoadStatus({ loading: true, error: null }), 'loading');
  assert.equal(getProfileLoadStatus({ loading: true, error: { message: 'x' } }), 'loading');
});

test('getProfileLoadStatus: si falló la carga, vista de error (no el formulario)', () => {
  assert.equal(getProfileLoadStatus({ loading: false, error: { message: 'falló' } }), 'error');
});

test('getProfileLoadStatus: sin loading ni error, la vista es el formulario', () => {
  assert.equal(getProfileLoadStatus({ loading: false, error: null }), 'ready');
});

test('getProfileLoadStatus: sin sesión (getMyProfileWithStatus devuelve "No autenticado") es un error, nunca un formulario vacío', () => {
  // Ruta privada sin sesión: EditProfileScreen no debería renderizar el
  // formulario en blanco como si el usuario no tuviera datos — debe verse
  // como cualquier otra falla de carga, con su opción de reintentar.
  assert.equal(getProfileLoadStatus({ loading: false, error: { message: 'No autenticado' } }), 'error');
});

// ---------------------------------------------------------------------------
// validateImageAsset — tamaño, tipo y resolución
// ---------------------------------------------------------------------------

test('validateImageAsset: rechaza un archivo demasiado grande', () => {
  const { ok, reason } = validateImageAsset({ fileSize: MAX_IMAGE_BYTES + 1, width: 800, height: 800 });
  assert.equal(ok, false);
  assert.match(reason, /pesa más de/);
});

test('validateImageAsset: acepta justo en el límite de tamaño', () => {
  const { ok } = validateImageAsset({ fileSize: MAX_IMAGE_BYTES, width: 800, height: 800 });
  assert.equal(ok, true);
});

test('validateImageAsset: rechaza un tipo no soportado', () => {
  const { ok, reason } = validateImageAsset({ mimeType: 'image/bmp', width: 800, height: 800 });
  assert.equal(ok, false);
  assert.match(reason, /Formato no soportado/);
});

test('validateImageAsset: rechaza una resolución muy baja', () => {
  const { ok, reason } = validateImageAsset({ width: 10, height: 10 });
  assert.equal(ok, false);
  assert.match(reason, /demasiado pequeña/);
});

test('validateImageAsset: acepta justo en la resolución mínima', () => {
  const { ok } = validateImageAsset({ width: MIN_IMAGE_DIMENSION, height: MIN_IMAGE_DIMENSION });
  assert.equal(ok, true);
});

test('validateImageAsset: sin datos de tamaño/tipo (el picker no los entregó), no se inventa un fallo', () => {
  const { ok } = validateImageAsset({ uri: 'file://foo.jpg' });
  assert.equal(ok, true);
});

test('validateImageAsset: sin asset, error explícito', () => {
  const { ok, reason } = validateImageAsset(null);
  assert.equal(ok, false);
  assert.match(reason, /No se seleccionó/);
});

test('computeTargetDimensions: no redimensiona si ya cabe', () => {
  assert.equal(computeTargetDimensions(800, 600, 1600), null);
});

test('computeTargetDimensions: reduce el lado más largo manteniendo proporción', () => {
  const dims = computeTargetDimensions(3200, 1600, 1600);
  assert.deepEqual(dims, { width: 1600, height: 800 });
});

// ---------------------------------------------------------------------------
// commitProfileSave — subir, confirmar, limpiar huérfanos, rollback
// ---------------------------------------------------------------------------

function fakeUpload(url, path) {
  return async () => ({ url, path, error: null });
}

test('commitProfileSave: sin imágenes pendientes solo actualiza el resto del perfil', async () => {
  const removed = [];
  const result = await commitProfileSave({
    pendingAvatar: null,
    pendingBanner: null,
    uploadAvatarFile: async () => { throw new Error('no debería llamarse'); },
    uploadBannerFile: async () => { throw new Error('no debería llamarse'); },
    updateProfile: async (urls) => {
      assert.equal(urls.foto_url, undefined);
      assert.equal(urls.banner_url, undefined);
      return { error: null };
    },
    removeFile: async (p) => { removed.push(p); return { error: null }; },
  });
  assert.equal(result.error, null);
  assert.deepEqual(removed, []);
});

test('commitProfileSave: actualización fallida (rollback) — limpia el huérfano subido y no borra el anterior', async () => {
  const removed = [];
  const result = await commitProfileSave({
    pendingAvatar: { uri: 'file://new.jpg' },
    pendingBanner: null,
    oldAvatarPath: 'u1/avatar.png',
    uploadAvatarFile: fakeUpload('https://x/u1/avatar.jpg', 'u1/avatar.jpg'),
    uploadBannerFile: async () => { throw new Error('no debería llamarse'); },
    updateProfile: async () => ({ error: { message: 'profiles update falló' } }),
    removeFile: async (p) => { removed.push(p); return { error: null }; },
  });
  assert.equal(result.error.message, 'profiles update falló');
  assert.equal(result.stage, 'profile_update');
  // Solo se borra el archivo recién subido (huérfano); el anterior queda intacto
  // porque el perfil nunca llegó a apuntar al nuevo.
  assert.deepEqual(removed, ['u1/avatar.jpg']);
});

test('commitProfileSave: falla la subida del avatar — no se llama a updateProfile ni se toca nada más', async () => {
  const removed = [];
  let updateCalled = false;
  const result = await commitProfileSave({
    pendingAvatar: { uri: 'file://new.jpg' },
    pendingBanner: { uri: 'file://banner.jpg' },
    uploadAvatarFile: async () => ({ error: { message: 'Storage caído' } }),
    uploadBannerFile: async () => { throw new Error('no debería llamarse: el avatar falló primero'); },
    updateProfile: async () => { updateCalled = true; return { error: null }; },
    removeFile: async (p) => { removed.push(p); return { error: null }; },
  });
  assert.equal(result.error.message, 'Storage caído');
  assert.equal(result.stage, 'avatar_upload');
  assert.equal(updateCalled, false);
  assert.deepEqual(removed, []);
});

test('commitProfileSave: falla la subida de la portada tras subir el avatar — limpia el avatar recién subido', async () => {
  const removed = [];
  const result = await commitProfileSave({
    pendingAvatar: { uri: 'file://new-avatar.jpg' },
    pendingBanner: { uri: 'file://new-banner.jpg' },
    uploadAvatarFile: fakeUpload('https://x/avatar.jpg', 'u1/avatar.jpg'),
    uploadBannerFile: async () => ({ error: { message: 'banner storage falló' } }),
    updateProfile: async () => { throw new Error('no debería llamarse'); },
    removeFile: async (p) => { removed.push(p); return { error: null }; },
  });
  assert.equal(result.error.message, 'banner storage falló');
  assert.equal(result.stage, 'banner_upload');
  assert.deepEqual(removed, ['u1/avatar.jpg']);
});

test('commitProfileSave: éxito completo — borra la imagen anterior solo después de confirmar el guardado', async () => {
  const removed = [];
  const order = [];
  const result = await commitProfileSave({
    pendingAvatar: { uri: 'file://new.jpg' },
    oldAvatarPath: 'u1/avatar.png', // extensión distinta: sí hay que borrarla
    uploadAvatarFile: async () => { order.push('upload'); return { url: 'https://x/u1/avatar.jpg', path: 'u1/avatar.jpg', error: null }; },
    uploadBannerFile: async () => { throw new Error('no debería llamarse'); },
    updateProfile: async (urls) => {
      order.push('update');
      assert.equal(urls.foto_url, 'https://x/u1/avatar.jpg');
      return { error: null };
    },
    removeFile: async (p) => { order.push('remove:' + p); removed.push(p); return { error: null }; },
  });
  assert.equal(result.error, null);
  assert.equal(result.newAvatarUrl, 'https://x/u1/avatar.jpg');
  assert.deepEqual(removed, ['u1/avatar.png']);
  assert.deepEqual(order, ['upload', 'update', 'remove:u1/avatar.png']);
});

test('commitProfileSave: éxito con el mismo path (upsert ya sobrescribió) — no intenta borrar nada extra', async () => {
  const removed = [];
  const result = await commitProfileSave({
    pendingAvatar: { uri: 'file://new.jpg' },
    oldAvatarPath: 'u1/avatar.jpg', // mismo path que el nuevo: upsert ya lo reemplazó
    uploadAvatarFile: fakeUpload('https://x/u1/avatar.jpg', 'u1/avatar.jpg'),
    uploadBannerFile: async () => { throw new Error('no debería llamarse'); },
    updateProfile: async () => ({ error: null }),
    removeFile: async (p) => { removed.push(p); return { error: null }; },
  });
  assert.equal(result.error, null);
  assert.deepEqual(removed, []);
});

// ---------------------------------------------------------------------------
// uploadGalleryPhotoWithCleanup — Storage ok + profile_photos falla → huérfano fuera
// ---------------------------------------------------------------------------

test('uploadGalleryPhotoWithCleanup: si falla la subida a Storage, no se intenta escribir el registro', async () => {
  let writeCalled = false;
  const result = await uploadGalleryPhotoWithCleanup({
    uploadFile: async () => ({ error: { message: 'Storage caído' } }),
    writeRecord: async () => { writeCalled = true; return { data: null, error: null }; },
    removeFile: async () => ({ error: null }),
  });
  assert.equal(result.error.message, 'Storage caído');
  assert.equal(writeCalled, false);
});

test('uploadGalleryPhotoWithCleanup: Storage ok pero profile_photos falla — borra el archivo huérfano', async () => {
  const removed = [];
  const result = await uploadGalleryPhotoWithCleanup({
    uploadFile: async () => ({ url: 'https://x/g/1.jpg', path: 'u1/1.jpg', error: null }),
    writeRecord: async () => ({ data: null, error: { message: 'profile_photos falló' } }),
    removeFile: async (p) => { removed.push(p); return { error: null }; },
  });
  assert.equal(result.error.message, 'profile_photos falló');
  assert.deepEqual(removed, ['u1/1.jpg']);
});

test('uploadGalleryPhotoWithCleanup: éxito — no borra nada', async () => {
  const removed = [];
  const result = await uploadGalleryPhotoWithCleanup({
    uploadFile: async () => ({ url: 'https://x/g/1.jpg', path: 'u1/1.jpg', error: null }),
    writeRecord: async () => ({ data: { id: 'p1' }, error: null }),
    removeFile: async (p) => { removed.push(p); return { error: null }; },
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { id: 'p1' });
  assert.deepEqual(removed, []);
});

// ---------------------------------------------------------------------------
// deletePhotoWithCompensation — nunca deja la BD apuntando a un objeto
// inexistente; reintenta la limpieza de Storage; eliminación parcial no
// bloquea al usuario.
// ---------------------------------------------------------------------------

test('deletePhotoWithCompensation: si falla borrar la fila, no se toca Storage (la fila sigue apuntando a algo que existe)', async () => {
  let removeCalled = false;
  const result = await deletePhotoWithCompensation({
    deleteRecord: async () => ({ error: { message: 'db caída' } }),
    removeFile: async () => { removeCalled = true; return { error: null }; },
    sleep: async () => {},
  });
  assert.equal(result.error.message, 'db caída');
  assert.equal(result.orphaned, false);
  assert.equal(removeCalled, false);
});

test('deletePhotoWithCompensation: fila borrada y storage ok a la primera', async () => {
  let attempts = 0;
  const result = await deletePhotoWithCompensation({
    deleteRecord: async () => ({ error: null }),
    removeFile: async () => { attempts++; return { error: null }; },
    sleep: async () => {},
  });
  assert.equal(result.error, null);
  assert.equal(result.orphaned, false);
  assert.equal(attempts, 1);
});

test('deletePhotoWithCompensation: eliminación parcial — fila borrada, storage falla incluso tras reintentar; no se reporta como error', async () => {
  let attempts = 0;
  const slept = [];
  const result = await deletePhotoWithCompensation({
    deleteRecord: async () => ({ error: null }),
    removeFile: async () => { attempts++; return { error: { message: 'network' } }; },
    retries: 2,
    delayMs: 50,
    sleep: async (ms) => { slept.push(ms); },
  });
  assert.equal(result.error, null);
  assert.equal(result.orphaned, true);
  assert.equal(attempts, 3); // intento inicial + 2 reintentos
  assert.deepEqual(slept, [50, 50]);
});

test('deletePhotoWithCompensation: reintento se recupera al segundo intento', async () => {
  let attempts = 0;
  const result = await deletePhotoWithCompensation({
    deleteRecord: async () => ({ error: null }),
    removeFile: async () => {
      attempts++;
      if (attempts < 2) return { error: { message: 'transitorio' } };
      return { error: null };
    },
    retries: 2,
    sleep: async () => {},
  });
  assert.equal(result.error, null);
  assert.equal(result.orphaned, false);
  assert.equal(attempts, 2);
});
