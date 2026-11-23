/**
 * La sesión en el almacén seguro del teléfono (Keychain en iOS, Keystore en
 * Android) en vez de `AsyncStorage`, que en nativo no está cifrado.
 *
 * Se prueba el adaptador con dobles de `expo-secure-store` y `AsyncStorage`:
 *   · ida y vuelta, también con una sesión que pasa el tope de 2048 bytes
 *     por valor y con caracteres que no son ASCII;
 *   · la MIGRACIÓN: quien ya tenía la sesión en AsyncStorage no se desloguea;
 *   · los FALLOS: almacén que revienta, trozo perdido, migración que no
 *     puede escribir. Nunca lanza: lo peor es «sin sesión» (y a Login).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { crearAlmacenSeguro, partirEnTrozos, TOPE_BYTES } = require('../almacenSeguro.js');

const CLAVE = 'sb-jvfoendzblkoxvwvommz-auth-token';

/** Doble de expo-secure-store: respeta el tope y la forma de las claves. */
function secureFalso({ revienta = false } = {}) {
  const datos = new Map();
  return {
    datos,
    async getItemAsync(k) {
      if (revienta) throw new Error('User interaction is not allowed');
      return datos.has(k) ? datos.get(k) : null;
    },
    async setItemAsync(k, v) {
      if (revienta) throw new Error('keystore no disponible');
      if (!/^[\w.-]+$/.test(k)) throw new Error(`clave inválida: ${k}`);
      if (Buffer.byteLength(v, 'utf8') > 2048) throw new Error('valor de más de 2048 bytes');
      datos.set(k, v);
    },
    async deleteItemAsync(k) {
      if (revienta) throw new Error('keystore no disponible');
      datos.delete(k);
    },
  };
}

function asyncFalso(inicial = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    async getItem(k) { return datos.has(k) ? datos.get(k) : null; },
    async setItem(k, v) { datos.set(k, v); },
    async removeItem(k) { datos.delete(k); },
  };
}

/** Una sesión parecida a la de supabase-js, larga y con tildes y emojis. */
function sesionGrande() {
  return JSON.stringify({
    access_token: 'eyJ' + 'a'.repeat(1200),
    refresh_token: 'r'.repeat(40),
    expires_at: 1793911508,
    user: {
      id: '0aa61200-82fe-4422-87f3-883985ecdf52',
      email: 'ñandú@futfinder.cl',
      user_metadata: { nombre: 'José Ñúñez ⚽️ 🇨🇱', bio: 'Arquero de Ñuñoa '.repeat(60) },
    },
  });
}

test('ida y vuelta: lo guardado se lee igual, aunque pase el tope por valor', async () => {
  const s = secureFalso();
  const a = asyncFalso();
  const almacen = crearAlmacenSeguro({ secureStore: s, asyncStorage: a });
  const valor = sesionGrande();
  assert.ok(Buffer.byteLength(valor, 'utf8') > 2048, 'la prueba necesita una sesión más grande que el tope');

  await almacen.setItem(CLAVE, valor);
  assert.equal(await almacen.getItem(CLAVE), valor);
  assert.equal(a.datos.size, 0, 'algo de la sesión quedó en AsyncStorage, sin cifrar');
});

test('los trozos no pasan el tope en bytes y no parten un emoji por la mitad', () => {
  const valor = sesionGrande();
  const trozos = partirEnTrozos(valor);
  assert.equal(trozos.join(''), valor);
  for (const t of trozos) {
    assert.ok(Buffer.byteLength(t, 'utf8') <= TOPE_BYTES, `trozo de ${Buffer.byteLength(t, 'utf8')} bytes`);
    assert.ok(!/[\uD800-\uDBFF]$/.test(t), 'un trozo termina en medio de un par sustituto');
  }
});

test('MIGRACIÓN: la sesión vieja de AsyncStorage pasa al almacén seguro sin desloguear', async () => {
  const valor = sesionGrande();
  const s = secureFalso();
  const a = asyncFalso({ [CLAVE]: valor });
  const almacen = crearAlmacenSeguro({ secureStore: s, asyncStorage: a });

  assert.equal(await almacen.getItem(CLAVE), valor, 'la persona quedó deslogueada al actualizar');
  assert.equal(a.datos.has(CLAVE), false, 'la copia sin cifrar sigue en AsyncStorage');
  assert.ok(s.datos.size > 0, 'no se escribió en el almacén seguro');

  // Y la segunda lectura ya sale del almacén seguro.
  assert.equal(await almacen.getItem(CLAVE), valor);
});

test('MIGRACIÓN: si no se puede escribir en el almacén seguro, se sigue con la vieja (sin desloguear)', async () => {
  const valor = sesionGrande();
  const s = secureFalso({ revienta: true });
  const a = asyncFalso({ [CLAVE]: valor });
  const almacen = crearAlmacenSeguro({ secureStore: s, asyncStorage: a });
  assert.equal(await almacen.getItem(CLAVE), valor);
  assert.equal(a.datos.get(CLAVE), valor, 'se borró la única copia de la sesión');
});

test('MIGRACIÓN: dos lecturas a la vez al arrancar migran una sola vez', async () => {
  const valor = sesionGrande();
  const s = secureFalso();
  const a = asyncFalso({ [CLAVE]: valor });
  const almacen = crearAlmacenSeguro({ secureStore: s, asyncStorage: a });
  const [x, y] = await Promise.all([almacen.getItem(CLAVE), almacen.getItem(CLAVE)]);
  assert.equal(x, valor);
  assert.equal(y, valor);
  const indice = JSON.parse(s.datos.get(CLAVE));
  assert.equal(s.datos.size, indice.n + 1, 'quedaron trozos huérfanos de una segunda migración');
});

test('FALLO: si el almacén seguro revienta y no hay nada viejo, es «sin sesión», no un error', async () => {
  const almacen = crearAlmacenSeguro({ secureStore: secureFalso({ revienta: true }), asyncStorage: asyncFalso() });
  assert.equal(await almacen.getItem(CLAVE), null);
  await assert.doesNotReject(almacen.setItem(CLAVE, 'x'));
  await assert.doesNotReject(almacen.removeItem(CLAVE));
});

test('FALLO: un trozo perdido es «sin sesión» y se limpia lo que quedó', async () => {
  const s = secureFalso();
  const almacen = crearAlmacenSeguro({ secureStore: s, asyncStorage: asyncFalso() });
  await almacen.setItem(CLAVE, sesionGrande());
  const trozo = [...s.datos.keys()].find((k) => k !== CLAVE.replace(/[^\w.-]/g, '_'));
  s.datos.delete(trozo);

  assert.equal(await almacen.getItem(CLAVE), null);
  assert.equal(s.datos.size, 0, 'quedaron restos de la sesión rota');
});

test('FALLO: un índice corrupto es «sin sesión»', async () => {
  const s = secureFalso();
  const almacen = crearAlmacenSeguro({ secureStore: s, asyncStorage: asyncFalso() });
  await almacen.setItem(CLAVE, 'hola');
  s.datos.set(CLAVE, '{esto no es json');
  assert.equal(await almacen.getItem(CLAVE), null);
});

test('reescribir no deja trozos viejos y borrar no deja nada', async () => {
  const s = secureFalso();
  const a = asyncFalso({ [CLAVE]: 'vieja' });
  const almacen = crearAlmacenSeguro({ secureStore: s, asyncStorage: a });
  await almacen.setItem(CLAVE, sesionGrande());
  const despuesDeLaGrande = s.datos.size;
  await almacen.setItem(CLAVE, 'corta');
  assert.ok(s.datos.size < despuesDeLaGrande, 'quedaron trozos de la sesión anterior');
  assert.equal(await almacen.getItem(CLAVE), 'corta');

  await almacen.removeItem(CLAVE);
  assert.equal(s.datos.size, 0);
  assert.equal(a.datos.has(CLAVE), false, 'borrar la sesión dejó la copia vieja en AsyncStorage');
  assert.equal(await almacen.getItem(CLAVE), null);
});

test('las claves con caracteres raros se guardan igual (el almacén sólo acepta [A-Za-z0-9._-])', async () => {
  const almacen = crearAlmacenSeguro({ secureStore: secureFalso(), asyncStorage: asyncFalso() });
  await almacen.setItem('sb:otra clave/rara', 'valor');
  assert.equal(await almacen.getItem('sb:otra clave/rara'), 'valor');
});

test('supabase.js usa el almacén seguro en nativo y deja la web como estaba', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'supabase.js'), 'utf8');
  assert.match(src, /storage: Platform\.OS === 'web' \? undefined : almacenDeSesion/);
  assert.match(src, /crearAlmacenSeguro\(\{/);
  assert.ok(!/storage: Platform\.OS === 'web' \? undefined : AsyncStorage/.test(src), 'la sesión vuelve a AsyncStorage sin cifrar');
});
