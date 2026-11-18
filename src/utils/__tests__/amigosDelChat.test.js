const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizarBusqueda,
  armarListaDeAmigos,
  filtrarAmigos,
} = require('../amigosDelChat.js');
const { threadPreview } = require('../chatMeta.js');

const amigo = (user_id, username, extra = {}) => ({ user_id, username, foto_url: null, ...extra });
const dm = (other_id, username, last_at, extra = {}) => ({
  key: `dm:${other_id}`,
  type: 'dm',
  other_id,
  other_username: username,
  title: `@${username}`,
  subtitle: 'Amigos',
  friend_status: 'accepted',
  last_at,
  last_message: { id: 'm', content: 'hola', created_at: last_at, sender_id: other_id },
  unread: 0,
  ...extra,
});

test('normalizarBusqueda: sin tildes, sin mayúsculas, sin @ ni espacios de borde', () => {
  assert.equal(normalizarBusqueda('  @JoSÉ Peña '), 'jose pena');
  assert.equal(normalizarBusqueda(null), '');
  assert.equal(normalizarBusqueda('Ñuñoa'), 'nunoa');
});

test('un amigo aparece aunque nunca hayan hablado, como DM vacío que abre dm:<id>', () => {
  const lista = armarListaDeAmigos({ amigos: [amigo('u1', 'pato', { foto_url: 'f.png' })], hilos: [] });
  assert.equal(lista.length, 1);
  const [h] = lista;
  assert.equal(h.key, 'dm:u1');
  assert.equal(h.type, 'dm');
  assert.equal(h.title, '@pato');
  assert.equal(h.foto_url, 'f.png');
  assert.equal(h.last_message, null);
  assert.equal(h.unread, 0);
  assert.equal(h.sin_chat, true);
});

test('si ya hay conversación se usa el hilo real (último mensaje y no leídos)', () => {
  const hilo = dm('u1', 'pato', '2026-11-18T10:00:00Z', { unread: 3 });
  const lista = armarListaDeAmigos({ amigos: [amigo('u1', 'pato')], hilos: [hilo] });
  assert.equal(lista.length, 1);
  assert.equal(lista[0], hilo);
});

test('orden: primero los con chat por actividad, después los sin chat por nombre', () => {
  const lista = armarListaDeAmigos({
    amigos: [amigo('u1', 'zeta'), amigo('u2', 'Álvaro'), amigo('u3', 'beto'), amigo('u4', 'carla')],
    hilos: [
      dm('u3', 'beto', '2026-11-17T10:00:00Z'),
      dm('u4', 'carla', '2026-11-18T10:00:00Z'),
    ],
  });
  assert.deepEqual(lista.map((h) => h.key), ['dm:u4', 'dm:u3', 'dm:u2', 'dm:u1']);
});

test('un DM bloqueado (en cualquier sentido) no aparece', () => {
  const lista = armarListaDeAmigos({
    amigos: [],
    hilos: [dm('u9', 'malo', '2026-11-18T10:00:00Z', { friend_status: 'blocked' })],
  });
  assert.deepEqual(lista, []);
});

test('los bloqueados por mí se sacan aunque llegaran como amigo o como hilo', () => {
  const lista = armarListaDeAmigos({
    amigos: [amigo('u1', 'pato'), amigo('u2', 'ana')],
    hilos: [dm('u1', 'pato', '2026-11-18T10:00:00Z')],
    bloqueados: ['u1'],
  });
  assert.deepEqual(lista.map((h) => h.key), ['dm:u2']);
});

test('un DM con alguien que ya no es amigo (solo lectura) se conserva al final de los con chat', () => {
  const lista = armarListaDeAmigos({
    amigos: [amigo('u1', 'pato')],
    hilos: [dm('u7', 'ex', '2026-11-10T10:00:00Z', { friend_status: 'pending', subtitle: 'Solo lectura' })],
  });
  assert.deepEqual(lista.map((h) => h.key), ['dm:u7', 'dm:u1']);
});

test('ignora hilos que no son DM y amigos sin id', () => {
  const lista = armarListaDeAmigos({
    amigos: [amigo(null, 'nadie'), amigo('u1', 'pato')],
    hilos: [{ key: 'match:1', type: 'match', last_at: '2026-11-18T10:00:00Z' }],
  });
  assert.deepEqual(lista.map((h) => h.key), ['dm:u1']);
});

test('un amigo duplicado (dos filas) sale una sola vez', () => {
  const lista = armarListaDeAmigos({ amigos: [amigo('u1', 'pato'), amigo('u1', 'pato')], hilos: [] });
  assert.equal(lista.length, 1);
});

test('filtrarAmigos: por usuario, sin tildes ni mayúsculas, y vacío devuelve todo', () => {
  const lista = armarListaDeAmigos({
    amigos: [amigo('u1', 'José_Peña'), amigo('u2', 'ana'), amigo('u3', 'Joaco')],
    hilos: [],
  });
  assert.deepEqual(filtrarAmigos(lista, 'jose').map((h) => h.other_id), ['u1']);
  assert.deepEqual(filtrarAmigos(lista, '@PEÑ').map((h) => h.other_id), ['u1']);
  assert.deepEqual(filtrarAmigos(lista, 'jo').map((h) => h.other_id).sort(), ['u1', 'u3']);
  assert.equal(filtrarAmigos(lista, '   ').length, 3);
  assert.deepEqual(filtrarAmigos(lista, 'xyz'), []);
});

test('filtrarAmigos: espacio, guion bajo, punto y guion valen lo mismo', () => {
  const lista = armarListaDeAmigos({ amigos: [amigo('u1', 'josé_peña.10'), amigo('u2', 'ana-maria')], hilos: [] });
  assert.deepEqual(filtrarAmigos(lista, 'JOSE PEN').map((h) => h.other_id), ['u1']);
  assert.deepEqual(filtrarAmigos(lista, 'pena 10').map((h) => h.other_id), ['u1']);
  assert.deepEqual(filtrarAmigos(lista, 'ana maria').map((h) => h.other_id), ['u2']);
});

test('la tarjeta de un amigo sin chat invita a escribirle', () => {
  const [h] = armarListaDeAmigos({ amigos: [amigo('u1', 'pato')], hilos: [] });
  assert.equal(threadPreview(h).text, 'Toca para escribirle');
  assert.equal(threadPreview({ type: 'dm', last_message: null }).text, 'Sin mensajes todavía');
});
