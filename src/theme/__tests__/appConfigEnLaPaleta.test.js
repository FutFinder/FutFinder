const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * `app.config.js` también pinta: el color de la notificación en Android, el
 * del plugin `expo-notifications` y el `themeColor` de la web (la barra del
 * navegador en el teléfono). Seguían en el verde oliva `#71B533` de la
 * paleta legada mientras toda la app ya usaba `#55DF69`, y ninguna prueba de
 * la paleta lo veía: miran `src/`, y este archivo vive en la raíz.
 *
 * El archivo no puede importar `src/theme/colors.js` (lo lee Expo en Node,
 * antes de Babel), así que los colores van escritos; lo que esta prueba
 * exige es que cada uno sea un valor de `paleta`. Si falla, no agregues una
 * excepción: usa el valor del token.
 */

const { paleta } = require('../colors.js');

const CONFIG = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app.config.js'), 'utf8');

/** El archivo sin comentarios, que es lo que llega al build. */
const codigo = CONFIG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const enLaPaleta = new Set(
  Object.values(paleta)
    .filter((v) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v))
    .map((v) => v.toUpperCase())
);

test('app.config.js no escribe colores fuera de la paleta', () => {
  const hex = codigo.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.ok(hex.length > 0, 'no se encontró ningún color: ¿cambió el archivo?');
  const fuera = hex.filter((h) => !enLaPaleta.has(h.toUpperCase()));
  assert.deepEqual(fuera, [], 'colores fuera de paleta en app.config.js');
  assert.ok(!/rgba?\(/.test(codigo), 'app.config.js escribe un color como rgb()');
});

test('la notificación y la web llevan el verde de acción', () => {
  const verde = paleta.green.toUpperCase();
  const colorNotif = codigo.match(/notification:\s*\{[\s\S]*?color:\s*'([^']+)'/);
  const tema = codigo.match(/themeColor:\s*'([^']+)'/);
  const plugin = codigo.match(/'expo-notifications',\s*\{[\s\S]*?color:\s*'([^']+)'/);
  for (const [nombre, m] of [['notification.color', colorNotif], ['web.themeColor', tema], ['plugin expo-notifications', plugin]]) {
    assert.ok(m, `no se encontró ${nombre}`);
    assert.equal(m[1].toUpperCase(), verde, `${nombre} no es paleta.green`);
  }
});
