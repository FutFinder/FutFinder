const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Que la ficha del recinto muestre la foto de cada cancha.
 *
 * `comoCancha()` trae `fotoUrl` desde `canchas_reservables.foto_url`, y el
 * recinto puede subirla desde `CanchaScreen`, pero la fila de la ficha
 * dibujaba un `<View>` vacío: un recuadro gris que no mostraba la foto aunque
 * existiera, ni decía nada cuando no la había (recorrido del 2026-10-20).
 */
test('la fila de cancha usa la foto que trae el servicio', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ComplejoDetailScreen.js'), 'utf8');
  assert.doesNotMatch(src, /<View style=\{styles\.canchaThumb\}\s*\/>/,
    'la miniatura de la cancha es un recuadro vacío');
  assert.match(src, /<Foto[^>]*uri=\{k\.fotoUrl\}/,
    'la miniatura de la cancha no recibe `k.fotoUrl`');
});
