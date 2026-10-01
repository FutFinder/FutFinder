/**
 * Pruebas de la traducción entre la «región» de react-native-maps y el
 * rectángulo que entiende Mapbox GL.
 *
 * LO QUE MÁS IMPORTA ACÁ es que los deltas son el ALTO y el ANCHO
 * COMPLETOS de la ventana, no la mitad. Confundirlo deja el mapa al doble
 * o a la mitad del zoom y no falla nada: se ve «raro» y nadie sabe por
 * qué. Por eso hay ida y vuelta.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  boundsDesdeRegion,
  regionDesdeMapa,
  etiquetaDelPartido,
} = require('../regionMapa.js');

// Ñuñoa, para que los números se parezcan a los de verdad.
const NUNOA = { latitude: -33.4569, longitude: -70.6483, latitudeDelta: 0.05, longitudeDelta: 0.04 };

test('la región se convierte en un rectángulo centrado en ella', () => {
  const [[oeste, sur], [este, norte]] = boundsDesdeRegion(NUNOA);
  assert.ok(Math.abs((norte + sur) / 2 - NUNOA.latitude) < 1e-9, 'el centro vertical se movió');
  assert.ok(Math.abs((este + oeste) / 2 - NUNOA.longitude) < 1e-9, 'el centro horizontal se movió');
  assert.ok(Math.abs((norte - sur) - NUNOA.latitudeDelta) < 1e-9, 'el alto no es el delta COMPLETO');
  assert.ok(Math.abs((este - oeste) - NUNOA.longitudeDelta) < 1e-9, 'el ancho no es el delta COMPLETO');
});

test('ida y vuelta: región → rectángulo → región devuelve lo mismo', () => {
  const bounds = boundsDesdeRegion(NUNOA);
  const vuelta = regionDesdeMapa({
    centro: { lat: NUNOA.latitude, lng: NUNOA.longitude },
    bounds,
  });
  assert.ok(Math.abs(vuelta.latitude - NUNOA.latitude) < 1e-9);
  assert.ok(Math.abs(vuelta.longitude - NUNOA.longitude) < 1e-9);
  assert.ok(Math.abs(vuelta.latitudeDelta - NUNOA.latitudeDelta) < 1e-9);
  assert.ok(Math.abs(vuelta.longitudeDelta - NUNOA.longitudeDelta) < 1e-9);
});

test('una región sin tamaño no produce un rectángulo', () => {
  // `fitBounds` con NaN o con un rectángulo de área cero deja el mapa en
  // blanco sin lanzar nada. Mejor devolver null y no llamarlo.
  assert.equal(boundsDesdeRegion({ latitude: -33, longitude: -70, latitudeDelta: 0, longitudeDelta: 1 }), null);
  assert.equal(boundsDesdeRegion({ latitude: -33, longitude: -70 }), null);
  assert.equal(boundsDesdeRegion(null), null);
  assert.equal(boundsDesdeRegion({ latitude: 'x', longitude: 'y', latitudeDelta: 1, longitudeDelta: 1 }), null);
});

test('los deltas negativos se toman como tamaño, no como dirección', () => {
  const b = boundsDesdeRegion({ ...NUNOA, latitudeDelta: -0.05, longitudeDelta: -0.04 });
  assert.ok(b, 'un delta negativo no debería anular el rectángulo');
  assert.ok(b[1][1] > b[0][1], 'el norte quedó debajo del sur');
  assert.ok(b[1][0] > b[0][0], 'el este quedó a la izquierda del oeste');
});

test('el rectángulo no se sale del planeta', () => {
  const [[, sur], [, norte]] = boundsDesdeRegion({
    latitude: -89, longitude: 0, latitudeDelta: 20, longitudeDelta: 1,
  });
  assert.ok(sur >= -90, `el sur se fue a ${sur}`);
  assert.ok(norte <= 90, `el norte se fue a ${norte}`);
});

test('sin centro no hay región: perder el centro es peor que no responder', () => {
  assert.equal(regionDesdeMapa({ bounds: [[-71, -34], [-70, -33]] }), null);
  assert.equal(regionDesdeMapa({}), null);
  assert.equal(regionDesdeMapa(), null);
});

test('con centro pero sin rectángulo se conserva el centro y se inventa el zoom', () => {
  // Es el caso del mapa que todavía no terminó de montar. Devolver null
  // haría perder dónde está mirando la persona.
  const r = regionDesdeMapa({ centro: { lat: -33.45, lng: -70.64 } });
  assert.equal(r.latitude, -33.45);
  assert.equal(r.longitude, -70.64);
  assert.ok(r.latitudeDelta > 0 && r.longitudeDelta > 0, 'los deltas tienen que ser utilizables');
});

test('el centro que manda es el del mapa, no el del rectángulo', () => {
  // Con el mapa inclinado no coinciden, y «buscar en esta zona» tiene que
  // buscar donde la persona está mirando.
  const r = regionDesdeMapa({
    centro: { lat: -33.40, lng: -70.60 },
    bounds: [[-71, -34], [-70, -33]],
  });
  assert.equal(r.latitude, -33.40);
  assert.equal(r.longitude, -70.60);
});

test('la etiqueta de la chapita dice cupos ocupados y hora', () => {
  const m = { cupos_totales: 10, cupos_disponibles: 2, hora: '2026-10-01T23:30:00Z' };
  assert.equal(etiquetaDelPartido(m, () => '20:30'), '8/10 · 20:30');
});

test('un partido sin cupos declarados no muestra números negativos', () => {
  assert.equal(etiquetaDelPartido({ cupos_totales: 0, cupos_disponibles: 5 }, () => '20:30'), '0/0 · 20:30');
  assert.equal(etiquetaDelPartido({}, () => '20:30'), '0/0 · 20:30');
});
