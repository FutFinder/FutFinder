const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Lo que las tiendas revisan de `app.config.js` antes de mirar la app:
 * que haya ícono y pantalla de inicio de verdad, y que no se declare ningún
 * permiso que la app no usa (micrófono, cámara, ubicación en segundo plano).
 * Las dos cosas faltaban y las dos son motivo de rechazo.
 */

const RAIZ = path.join(__dirname, '..', '..');
const { expo } = require(path.join(RAIZ, 'app.config.js'));

/** Ancho, alto y tipo de color del encabezado IHDR de un PNG. */
function encabezadoPng(ruta) {
  const buf = fs.readFileSync(ruta);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${ruta} no es un PNG`);
  return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20), tipoColor: buf[25] };
}

const conAlfa = (tipoColor) => tipoColor === 4 || tipoColor === 6;

const IMAGENES = [
  ['icon', expo.icon, 1024, false],
  ['splash.image', expo.splash?.image, 1024, true],
  ['android.adaptiveIcon.foregroundImage', expo.android?.adaptiveIcon?.foregroundImage, 1024, true],
  ['notification.icon', expo.notification?.icon, 96, true],
  ['web.favicon', expo.web?.favicon, 48, false],
];

for (const [campo, ruta, lado, alfa] of IMAGENES) {
  test(`${campo} apunta a un PNG de ${lado}×${lado} que existe`, () => {
    assert.ok(ruta, `falta ${campo} en app.config.js`);
    const absoluta = path.join(RAIZ, ruta);
    assert.ok(fs.existsSync(absoluta), `${ruta} no existe: corre node scripts/generar-iconos.mjs`);
    const { ancho, alto, tipoColor } = encabezadoPng(absoluta);
    assert.deepEqual([ancho, alto], [lado, lado]);
    assert.equal(conAlfa(tipoColor), alfa, alfa ? `${ruta} necesita transparencia` : `${ruta} no puede tener canal alfa`);
  });
}

test('el plugin de notificaciones usa la misma silueta que notification.icon', () => {
  const plugin = expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
  assert.equal(plugin?.[1]?.icon, expo.notification.icon);
});

test('Android no declara micrófono, cámara ni ubicación en segundo plano', () => {
  const declarados = expo.android.permissions || [];
  const bloqueados = expo.android.blockedPermissions || [];
  for (const p of ['RECORD_AUDIO', 'CAMERA', 'ACCESS_BACKGROUND_LOCATION']) {
    const nombre = `android.permission.${p}`;
    assert.ok(!declarados.includes(nombre), `${nombre} está declarado`);
    assert.ok(bloqueados.includes(nombre), `${nombre} no está bloqueado`);
  }
});

test('image-picker no pide cámara ni micrófono, y location sólo «mientras se usa»', () => {
  const opciones = (nombre) => expo.plugins.find((p) => Array.isArray(p) && p[0] === nombre)?.[1] || {};
  const picker = opciones('expo-image-picker');
  assert.equal(picker.cameraPermission, false);
  assert.equal(picker.microphonePermission, false);
  assert.match(picker.photosPermission, /fotos/);

  const ubicacion = opciones('expo-location');
  assert.equal(ubicacion.locationAlwaysPermission, false);
  assert.equal(ubicacion.locationAlwaysAndWhenInUsePermission, false);
  assert.match(ubicacion.locationWhenInUsePermission, /ubicación/);
});

test('ninguna dependencia usa la cámara, el micrófono ni la ubicación en segundo plano', () => {
  const fuentes = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== '__tests__') recorrer(ruta);
      } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) {
        fuentes.push(fs.readFileSync(ruta, 'utf8'));
      }
    }
  };
  recorrer(path.join(RAIZ, 'src'));
  fuentes.push(fs.readFileSync(path.join(RAIZ, 'App.js'), 'utf8'));
  const todo = fuentes.join('\n');
  // Si algún día se usan, hay que darles su texto en app.config.js primero.
  for (const api of ['launchCameraAsync', 'requestCameraPermissionsAsync', 'requestBackgroundPermissionsAsync', 'expo-av', 'expo-audio']) {
    assert.ok(!todo.includes(api), `src usa ${api}: decláralo en app.config.js antes`);
  }
});
