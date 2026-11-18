const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { clasificarArchivos, lotesPorBucket } = require('../limpieza-prelanzamiento/archivos.js');

const YO = '11111111-2222-3333-4444-555555555555';
const OTRO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('se queda sólo la foto y la galería de las cuentas conservadas', () => {
  const { borrar, quedan } = clasificarArchivos(
    [
      { bucket: 'avatars', ruta: `${YO}/avatar.jpg` },
      { bucket: 'profile-gallery', ruta: `${YO}/1.jpg` },
      { bucket: 'avatars', ruta: `${OTRO}/avatar.jpg` },
      { bucket: 'support-screenshots', ruta: `${YO}/captura.png` },
      { bucket: 'solicitud-fotos', ruta: `${YO}/foto.jpg` },
      { bucket: 'club-logos', ruta: `${YO}/logo.png` },
      { bucket: 'complejo-fotos', ruta: 'x/1.jpg' },
      { bucket: 'avatars', ruta: 'suelto.jpg' },
    ],
    [YO.toUpperCase()]
  );
  assert.deepEqual(quedan.map((a) => `${a.bucket}/${a.ruta}`), [
    `avatars/${YO}/avatar.jpg`,
    `profile-gallery/${YO}/1.jpg`,
  ]);
  assert.equal(borrar.length, 6);
});

test('sin cuentas conservadas se borra todo', () => {
  const { borrar, quedan } = clasificarArchivos([{ bucket: 'avatars', ruta: `${YO}/a.jpg` }], []);
  assert.equal(quedan.length, 0);
  assert.equal(borrar.length, 1);
});

test('los lotes no mezclan buckets ni pasan del tamaño', () => {
  const archivos = [
    ...Array.from({ length: 5 }, (_, i) => ({ bucket: 'a', ruta: `r${i}` })),
    { bucket: 'b', ruta: 'x' },
  ];
  const lotes = lotesPorBucket(archivos, 2);
  assert.deepEqual(lotes.map((l) => [l.bucket, l.rutas.length]), [['a', 2], ['a', 2], ['a', 1], ['b', 1]]);
});

test('el SQL clasifica en el paso 1 exactamente las tablas que vacía o conserva', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'limpieza-prelanzamiento', 'limpieza.sql'), 'utf8');
  const truncate = sql.match(/^truncate table([\s\S]*?);/m)[1];
  const vaciadas = [...truncate.matchAll(/public\.(\w+)/g)].map((m) => m[1]).sort();
  const lista = sql.match(/c\.relname not in \(([\s\S]*?)\);/)[1];
  const clasificadas = [...lista.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  const conservadas = ['feature_flags', 'truescore_config', 'profiles', 'perfil_telefonos',
    'perfil_ubicaciones', 'aceptaciones_legales', 'push_tokens', 'profile_photos', 'moderadores'];
  // Lo que se vacía y lo que se conserva no se cruzan, y entre los dos es la lista.
  assert.deepEqual(vaciadas.filter((t) => conservadas.includes(t)), []);
  assert.deepEqual([...clasificadas].sort(), [...vaciadas, ...conservadas].sort());
});
