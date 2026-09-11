const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ANCLAJES, PROPORCION_PORTADA, encuadreEnCaja, fraccionVisible, nombreDeAnclaje,
  queSobra, recorteParaProporcion,
} = require('../encuadre.js');

const P = PROPORCION_PORTADA; // 16/9

test('una foto que ya tiene la proporción no se toca', () => {
  assert.equal(queSobra(1600, 900, P), null);
  assert.equal(recorteParaProporcion(1600, 900, P), null);
  // Y casi-16:9 tampoco: nadie nota un píxel, y preguntar por eso es ruido.
  assert.equal(recorteParaProporcion(1920, 1081, P), null);
});

test('la foto de teléfono acostada (4:3) pierde alto, no ancho', () => {
  const r = recorteParaProporcion(4032, 3024, P, 'centro');
  assert.equal(r.width, 4032);
  assert.equal(r.height, Math.round(4032 / P)); // 2268
  assert.equal(r.originX, 0);
  // Sobran 756 px de alto: 378 arriba y 378 abajo.
  assert.equal(r.originY, 378);
});

test('la foto parada es la que más pierde, y por eso hay que poder elegir', () => {
  // 3024x4032 en 16:9 conserva 1701 de 4032 px de alto: un 42 %.
  const arriba = recorteParaProporcion(3024, 4032, P, 'inicio');
  const centro = recorteParaProporcion(3024, 4032, P, 'centro');
  const abajo = recorteParaProporcion(3024, 4032, P, 'fin');

  assert.equal(arriba.height, 1701);
  assert.equal(arriba.originY, 0);
  assert.equal(centro.originY, Math.round((4032 - 1701) / 2));
  assert.equal(abajo.originY, 4032 - 1701);
  // Los tres se quedan dentro de la foto: nada se sale por abajo.
  for (const r of [arriba, centro, abajo]) {
    assert.ok(r.originY + r.height <= 4032);
  }
});

test('una panorámica pierde ancho, y también se puede elegir', () => {
  assert.equal(queSobra(4000, 1000, P), 'horizontal');
  const r = recorteParaProporcion(4000, 1000, P, 'inicio');
  assert.equal(r.height, 1000);
  assert.equal(r.width, Math.round(1000 * P)); // 1778
  assert.equal(r.originX, 0);
  assert.equal(recorteParaProporcion(4000, 1000, P, 'fin').originX, 4000 - 1778);
});

test('medidas ausentes o absurdas no producen un recorte inventado', () => {
  for (const [w, h] of [[0, 900], [1600, 0], [undefined, undefined], [-10, 20], [NaN, 900]]) {
    assert.equal(recorteParaProporcion(w, h, P), null);
  }
  assert.equal(recorteParaProporcion(1600, 900, 0), null);
});

test('un anclaje desconocido cae al centro en vez de romper', () => {
  const raro = recorteParaProporcion(3024, 4032, P, 'diagonal');
  const centro = recorteParaProporcion(3024, 4032, P, 'centro');
  assert.deepEqual(raro, centro);
  assert.deepEqual(recorteParaProporcion(3024, 4032, P, undefined), centro);
});

test('la vista previa se expresa en porcentajes, sin medir nada', () => {
  // Medir la caja con `onLayout` obligaba a esperar la medición para dibujar
  // algo, y cuando no llegaba —pasa dentro de un modal— la vista previa
  // quedaba vacía sin decir por qué. En porcentajes no hay nada que esperar.
  const centro = encuadreEnCaja(3024, 4032, P, 'centro');
  assert.equal(centro.ancho, '100%');
  assert.equal(parseFloat(centro.alto).toFixed(2), '237.04');
  assert.equal(parseFloat(centro.y).toFixed(2), '-68.52');

  assert.equal(encuadreEnCaja(3024, 4032, P, 'inicio').y, '0%');
  assert.equal(parseFloat(encuadreEnCaja(3024, 4032, P, 'fin').y).toFixed(2), '-137.04');

  // Una panorámica se corre de lado, no hacia arriba.
  const pano = encuadreEnCaja(4000, 1000, P, 'inicio');
  assert.equal(pano.alto, '100%');
  assert.equal(pano.x, '0%');
  assert.ok(parseFloat(pano.ancho) > 100);
});

test('una foto que ya calza se dibuja entera, sin desplazamiento', () => {
  assert.deepEqual(encuadreEnCaja(1600, 900, P, 'fin'),
    { ancho: '100%', alto: '100%', x: '0%', y: '0%' });
  // Y sin medidas tampoco inventa un encuadre raro.
  assert.deepEqual(encuadreEnCaja(0, 0, P, 'centro'),
    { ancho: '100%', alto: '100%', x: '0%', y: '0%' });
});

test('LO QUE SE VE ES LO QUE SE GUARDA', () => {
  // La prueba que sostiene toda la pantalla: la franja que muestra la vista
  // previa tiene que ser la misma que conserva el recorte. Si estas dos
  // cuentas se separan, alguien elige «arriba» y se guarda el medio.
  for (const [w, h] of [[3024, 4032], [4032, 3024], [4000, 1000], [1000, 4000]]) {
    for (const anclaje of ANCLAJES) {
      const r = recorteParaProporcion(w, h, P, anclaje);
      const v = fraccionVisible(w, h, P, anclaje);
      const vertical = r.height < h;
      const guardadaDesde = vertical ? r.originY / h : r.originX / w;
      const guardadaLargo = vertical ? r.height / h : r.width / w;
      assert.ok(Math.abs(guardadaDesde - v.desde) < 0.005, `${w}x${h} ${anclaje} inicio`);
      assert.ok(Math.abs(guardadaLargo - v.largo) < 0.005, `${w}x${h} ${anclaje} largo`);
    }
  }
});

test('los nombres son los que ve la persona, y cambian según qué sobre', () => {
  assert.equal(nombreDeAnclaje('inicio', 'vertical'), 'Arriba');
  assert.equal(nombreDeAnclaje('fin', 'vertical'), 'Abajo');
  assert.equal(nombreDeAnclaje('inicio', 'horizontal'), 'Izquierda');
  assert.equal(nombreDeAnclaje('fin', 'horizontal'), 'Derecha');
  assert.equal(nombreDeAnclaje('loquesea'), 'Centro');
});
