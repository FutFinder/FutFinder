/**
 * Ajustar una foto antes de subirla: agrandarla, achicarla y moverla.
 *
 * EL FALLO (2026-11-27): en futfinder.cl, abierta en Safari del iPhone, el
 * logo y el banner del club —y también la foto y la portada del perfil— se
 * subían tal como venían. El selector del sistema que recorta con zoom sólo
 * existe en la app nativa (`allowsEditing` de expo-image-picker); en la web es
 * un `<input type="file">` sin editor, y la foto se mostraba recortada por el
 * centro, sin que nadie eligiera qué parte quedaba.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ZOOM_MAXIMO, ajusteInicial, recorteDeAjuste, ajusteConZoom, ajusteTrasArrastre,
  dibujoEnCaja, zoomPorPellizco,
} = require('../ajusteFoto.js');
const { recorteParaProporcion } = require('../encuadre.js');

const PARADA = { ancho: 3000, alto: 4000 }; // foto de teléfono, vertical
const ACOSTADA = { ancho: 4000, alto: 3000 };
const BANNER = 16 / 9;
const LOGO = 1;

const dentro = (r, f) =>
  r.originX >= 0 && r.originY >= 0 && r.originX + r.width <= f.ancho && r.originY + r.height <= f.alto;

test('sin tocar nada, queda el mismo recorte por el centro que ya usaban los recintos', () => {
  for (const f of [PARADA, ACOSTADA]) {
    for (const p of [BANNER, LOGO]) {
      const a = ajusteInicial(f.ancho, f.alto);
      const r = recorteDeAjuste(f.ancho, f.alto, p, a);
      const esperado = recorteParaProporcion(f.ancho, f.alto, p, 0.5)
        || { originX: 0, originY: 0, width: f.ancho, height: f.alto };
      assert.deepEqual(r, esperado, `${f.ancho}x${f.alto} a ${p}`);
    }
  }
});

test('agrandar al doble deja la mitad de cada lado, alrededor del mismo centro', () => {
  const f = ACOSTADA;
  const a = ajusteConZoom(ajusteInicial(f.ancho, f.alto), 2, f.ancho, f.alto, LOGO);
  const r = recorteDeAjuste(f.ancho, f.alto, LOGO, a);
  assert.equal(r.width, 1500);
  assert.equal(r.height, 1500);
  assert.equal(r.originX + r.width / 2, 2000);
  assert.equal(r.originY + r.height / 2, 1500);
});

test('el zoom no baja de 1 (no se ve fondo vacío) ni pasa del máximo', () => {
  const f = PARADA;
  const a0 = ajusteInicial(f.ancho, f.alto);
  assert.equal(ajusteConZoom(a0, 0.3, f.ancho, f.alto, BANNER).zoom, 1);
  assert.equal(ajusteConZoom(a0, 99, f.ancho, f.alto, BANNER).zoom, ZOOM_MAXIMO);
  assert.equal(ajusteConZoom(a0, 'basura', f.ancho, f.alto, BANNER).zoom, 1);
});

test('arrastrar la foto hacia la derecha muestra más de su lado izquierdo', () => {
  const f = ACOSTADA;
  const a = ajusteConZoom(ajusteInicial(f.ancho, f.alto), 2, f.ancho, f.alto, LOGO);
  const antes = recorteDeAjuste(f.ancho, f.alto, LOGO, a);
  const movida = ajusteTrasArrastre(a, 50, 0, 300, f.ancho, f.alto, LOGO);
  const despues = recorteDeAjuste(f.ancho, f.alto, LOGO, movida);
  // La caja mide 300 px y muestra 1500 px de foto: 50 px de dedo son 250.
  assert.equal(despues.originX, antes.originX - 250);
  assert.equal(despues.originY, antes.originY);
});

test('por más que se arrastre o se achique, el recorte nunca sale de la foto', () => {
  const f = PARADA;
  let a = ajusteConZoom(ajusteInicial(f.ancho, f.alto), 3, f.ancho, f.alto, BANNER);
  for (const [dx, dy] of [[9999, 0], [-9999, 0], [0, 9999], [0, -9999], [5000, -5000]]) {
    a = ajusteTrasArrastre(a, dx, dy, 320, f.ancho, f.alto, BANNER);
    assert.ok(dentro(recorteDeAjuste(f.ancho, f.alto, BANNER, a), f), `${dx},${dy}`);
  }
  // Pegada a una esquina y achicada de golpe: sigue adentro.
  a = ajusteConZoom(a, 1, f.ancho, f.alto, BANNER);
  assert.ok(dentro(recorteDeAjuste(f.ancho, f.alto, BANNER, a), f));
});

test('LO QUE SE VE ES LO QUE SE GUARDA: el dibujo de la caja sale del mismo recorte', () => {
  // Si estas dos cuentas se separan, la persona acomoda una cosa y se sube
  // otra. Se prueba sobre posiciones sueltas, no sólo el centro.
  const casos = [
    [PARADA, BANNER, 1, 0, 0], [PARADA, BANNER, 2.5, 120, -80], [ACOSTADA, LOGO, 1.7, -60, 40],
    [ACOSTADA, BANNER, 4, 300, 300], [PARADA, LOGO, 1.2, -500, 999],
  ];
  for (const [f, p, zoom, dx, dy] of casos) {
    let a = ajusteConZoom(ajusteInicial(f.ancho, f.alto), zoom, f.ancho, f.alto, p);
    a = ajusteTrasArrastre(a, dx, dy, 300, f.ancho, f.alto, p);
    const r = recorteDeAjuste(f.ancho, f.alto, p, a);
    const d = dibujoEnCaja(f.ancho, f.alto, p, a);
    const n = (t) => parseFloat(t) / 100;
    // La foto dibujada mide (ancho de la foto / ancho del recorte) cajas…
    assert.ok(Math.abs(n(d.ancho) - f.ancho / r.width) < 1e-6);
    assert.ok(Math.abs(n(d.alto) - f.alto / r.height) < 1e-6);
    // …y está corrida justo lo que el recorte deja afuera a la izquierda y
    // arriba. La tolerancia es en píxeles de la foto: una centésima.
    assert.ok(Math.abs(-n(d.x) * r.width - r.originX) < 0.01, `x: ${d.x} vs ${r.originX}`);
    assert.ok(Math.abs(-n(d.y) * r.height - r.originY) < 0.01, `y: ${d.y} vs ${r.originY}`);
  }
});

test('pellizcar escala el zoom con la distancia entre los dedos', () => {
  assert.equal(zoomPorPellizco(1, 100, 200), 2);
  assert.equal(zoomPorPellizco(2, 200, 100), 1);
  assert.equal(zoomPorPellizco(1.5, 0, 200), 1.5, 'sin distancia inicial no se mueve');
});

test('una foto sin medidas no rompe nada', () => {
  assert.equal(recorteDeAjuste(0, 0, BANNER, ajusteInicial(0, 0)), null);
  const d = dibujoEnCaja(undefined, undefined, BANNER, null);
  assert.deepEqual(d, { ancho: '100%', alto: '100%', x: '0%', y: '0%' });
});

// ─── Dónde se usa ───────────────────────────────────────────────────────

const RAIZ = path.resolve(__dirname, '../..');
const leer = (archivo) => fs.readFileSync(path.join(RAIZ, archivo), 'utf8');

test('logo y banner del club, al crearlo y al editarlo, pasan por el ajuste', () => {
  for (const archivo of ['screens/CreateClubScreen.js', 'screens/EditClubScreen.js']) {
    const p = leer(archivo);
    assert.match(p, /<AjustarFotoSheet/, `${archivo} no muestra el ajuste`);
    assert.match(p, /proporcion: 1, destino: 'logo'/, `${archivo}: el logo no pasa por el ajuste`);
    assert.match(p, /proporcion: 16 \/ 9, destino: 'banner'/, `${archivo}: el banner no pasa por el ajuste`);
  }
});

test('la foto y la portada del perfil también pasan por el ajuste', () => {
  const p = leer('screens/EditProfileScreen.js');
  assert.match(p, /<AjustarFotoSheet/);
  assert.match(p, /proporcion: 1, destino: 'avatar'/);
  assert.match(p, /proporcion: 16 \/ 9, destino: 'portada'/);
});

test('en la app nativa no se ajusta dos veces: ahí ya recorta el selector del sistema', () => {
  const hoja = leer('components/AjustarFotoSheet.js');
  assert.match(hoja, /export const AJUSTE_PROPIO = Platform\.OS === 'web'/);
  for (const archivo of ['screens/CreateClubScreen.js', 'screens/EditClubScreen.js', 'screens/EditProfileScreen.js']) {
    assert.match(leer(archivo), /if \(AJUSTE_PROPIO\)/, `${archivo} ajusta también en nativo`);
  }
});
