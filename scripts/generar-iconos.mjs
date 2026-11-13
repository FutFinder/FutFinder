/**
 * Genera los íconos y la imagen de inicio de la app a partir de la marca
 * (`src/components/FutFinderMark.js`: el pin con el balón adentro).
 *
 *   node scripts/generar-iconos.mjs
 *
 * Escribe en `assets/`:
 *   icon.png               1024×1024, opaco      → ícono de iOS y de la tienda
 *   adaptive-icon.png      1024×1024, con alfa   → primer plano del ícono de Android
 *   splash-icon.png        1024×1024, con alfa   → imagen de la pantalla de inicio
 *   notification-icon.png    96×96, blanco y alfa → ícono de los push en Android
 *   favicon.png              48×48, opaco        → pestaña del navegador
 *
 * No hay herramienta de imágenes en el proyecto (ni sharp ni ImageMagick), así
 * que el dibujo se rasteriza acá: las mismas curvas del SVG, aplanadas, con
 * 4×4 muestras por píxel para el antialias. `pngjs` llega como dependencia de
 * Expo. Si cambia la marca, cambia `MARCA` y vuelve a correr esto.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'assets');

// Los colores de `theme/colors.js` (paleta: `bg` y `green`).
const FONDO = [0x0a, 0x0c, 0x0a];
const VERDE = [0x55, 0xdf, 0x69];
const BLANCO = [0xff, 0xff, 0xff];

// La marca, en las coordenadas de su viewBox (100 × 120).
const MARCA = {
  ancho: 100,
  alto: 120,
  // Contorno del pin: M50 5 C25 5 8 22 8 47 C8 78 50 115 50 115
  //                   C50 115 92 78 92 47 C92 22 75 5 50 5 Z, trazo 7.
  pin: [
    [[50, 5], [25, 5], [8, 22], [8, 47]],
    [[8, 47], [8, 78], [50, 115], [50, 115]],
    [[50, 115], [50, 115], [92, 78], [92, 47]],
    [[92, 47], [92, 22], [75, 5], [50, 5]],
  ],
  trazoPin: 7,
  balon: { cx: 50, cy: 47, r: 22, trazo: 4 },
  pentagono: [[50, 35], [60, 42], [56, 53], [44, 53], [40, 42]],
};

function aplanarCubica([p0, p1, p2, p3], pasos = 48) {
  const puntos = [];
  for (let i = 0; i <= pasos; i += 1) {
    const t = i / pasos;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    puntos.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]);
  }
  return puntos;
}

const SEGMENTOS_PIN = (() => {
  const segs = [];
  const medio = MARCA.trazoPin / 2;
  for (const curva of MARCA.pin) {
    const pts = aplanarCubica(curva);
    for (let i = 0; i < pts.length - 1; i += 1) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      segs.push({
        ax, ay, bx, by,
        minX: Math.min(ax, bx) - medio, maxX: Math.max(ax, bx) + medio,
        minY: Math.min(ay, by) - medio, maxY: Math.max(ay, by) + medio,
      });
    }
  }
  return segs;
})();

function cercaDelPin(x, y) {
  const medio2 = (MARCA.trazoPin / 2) ** 2;
  for (const s of SEGMENTOS_PIN) {
    if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY) continue;
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const largo2 = dx * dx + dy * dy;
    let t = largo2 === 0 ? 0 : ((x - s.ax) * dx + (y - s.ay) * dy) / largo2;
    t = Math.max(0, Math.min(1, t));
    const px = s.ax + t * dx - x;
    const py = s.ay + t * dy - y;
    if (px * px + py * py <= medio2) return true;
  }
  return false;
}

function dentroDelPoligono(x, y, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i, i += 1) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/**
 * Qué hay en un punto del viewBox, pintando en el orden del SVG:
 * pin → balón (relleno con el fondo y su borde) → pentágono.
 * Devuelve 'marca', 'hueco' (el relleno del balón) o null (nada).
 */
function muestra(x, y) {
  let capa = cercaDelPin(x, y) ? 'marca' : null;
  const { cx, cy, r, trazo } = MARCA.balon;
  const d = Math.hypot(x - cx, y - cy);
  if (d <= r + trazo / 2) capa = d >= r - trazo / 2 ? 'marca' : 'hueco';
  if (dentroDelPoligono(x, y, MARCA.pentagono)) capa = 'marca';
  return capa;
}

/**
 * @param {number} lado            píxeles del cuadrado
 * @param {number} altoMarca       alto de la marca en píxeles (centrada)
 * @param {[number,number,number]} colorMarca
 * @param {[number,number,number]|null} fondo  null = transparente
 */
function dibujar(lado, altoMarca, colorMarca, fondo) {
  const png = new PNG({ width: lado, height: lado });
  const escala = altoMarca / MARCA.alto;
  const ox = (lado - MARCA.ancho * escala) / 2;
  const oy = (lado - MARCA.alto * escala) / 2;
  const N = 4;
  for (let py = 0; py < lado; py += 1) {
    for (let px = 0; px < lado; px += 1) {
      let cubre = 0;
      for (let sy = 0; sy < N; sy += 1) {
        for (let sx = 0; sx < N; sx += 1) {
          const x = (px + (sx + 0.5) / N - ox) / escala;
          const y = (py + (sy + 0.5) / N - oy) / escala;
          if (x < -5 || x > MARCA.ancho + 5 || y < -5 || y > MARCA.alto + 5) continue;
          if (muestra(x, y) === 'marca') cubre += 1;
        }
      }
      const a = cubre / (N * N);
      const i = (py * lado + px) * 4;
      if (fondo) {
        for (let k = 0; k < 3; k += 1) {
          png.data[i + k] = Math.round(fondo[k] * (1 - a) + colorMarca[k] * a);
        }
        png.data[i + 3] = 255;
      } else {
        png.data[i] = colorMarca[0];
        png.data[i + 1] = colorMarca[1];
        png.data[i + 2] = colorMarca[2];
        png.data[i + 3] = Math.round(a * 255);
      }
    }
  }
  // Los opacos salen sin canal alfa (RGB): App Store Connect rechaza un
  // ícono que lo tenga, aunque sea todo 255.
  return PNG.sync.write(png, fondo ? { colorType: 2 } : {});
}

// El hueco del balón en las versiones con alfa queda transparente: en el
// ícono adaptativo se ve el fondo de Android (`backgroundColor`, el mismo
// `bg`), y en el de notificación Android pinta sólo la silueta.
const SALIDAS = [
  // iOS recorta las esquinas solo; la marca ocupa ~58 % del alto.
  ['icon.png', 1024, 600, VERDE, FONDO],
  // Zona segura del adaptativo: el círculo central de 66 %. 480 px de alto
  // dejan la marca entera adentro aunque el lanzador use la máscara redonda.
  ['adaptive-icon.png', 1024, 480, VERDE, null],
  // Con `resizeMode: 'contain'` la imagen se ajusta al ancho de la pantalla:
  // la marca chica en un lienzo grande la deja en ~30 % del ancho.
  ['splash-icon.png', 1024, 300, VERDE, null],
  ['notification-icon.png', 96, 80, BLANCO, null],
  ['favicon.png', 48, 42, VERDE, FONDO],
];

mkdirSync(SALIDA, { recursive: true });
for (const [nombre, lado, alto, color, fondo] of SALIDAS) {
  writeFileSync(join(SALIDA, nombre), dibujar(lado, alto, color, fondo));
  console.log(`assets/${nombre}  ${lado}×${lado}`);
}
