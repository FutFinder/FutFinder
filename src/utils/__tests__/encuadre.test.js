const test = require('node:test');
const assert = require('node:assert/strict');

const {
  POSICIONES, PROPORCION_PORTADA, encuadreEnCaja, fraccionVisible, nombreDePosicion,
  posicionTrasArrastre, posicionValida, queSobra, recorridoDeArrastre, recorteParaProporcion,
} = require('../encuadre.js');

const VALORES = POSICIONES.map((p) => p.valor);

const P = PROPORCION_PORTADA; // 16/9

test('una foto que ya tiene la proporción no se toca', () => {
  assert.equal(queSobra(1600, 900, P), null);
  assert.equal(recorteParaProporcion(1600, 900, P), null);
  // Y casi-16:9 tampoco: nadie nota un píxel, y preguntar por eso es ruido.
  assert.equal(recorteParaProporcion(1920, 1081, P), null);
});

test('la foto de teléfono acostada (4:3) pierde alto, no ancho', () => {
  const r = recorteParaProporcion(4032, 3024, P, 0.5);
  assert.equal(r.width, 4032);
  assert.equal(r.height, Math.round(4032 / P)); // 2268
  assert.equal(r.originX, 0);
  // Sobran 756 px de alto: 378 arriba y 378 abajo.
  assert.equal(r.originY, 378);
});

test('la foto parada es la que más pierde, y por eso hay que poder elegir', () => {
  // 3024x4032 en 16:9 conserva 1701 de 4032 px de alto: un 42 %.
  const arriba = recorteParaProporcion(3024, 4032, P, 0);
  const centro = recorteParaProporcion(3024, 4032, P, 0.5);
  const abajo = recorteParaProporcion(3024, 4032, P, 1);

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
  const r = recorteParaProporcion(4000, 1000, P, 0);
  assert.equal(r.height, 1000);
  assert.equal(r.width, Math.round(1000 * P)); // 1778
  assert.equal(r.originX, 0);
  assert.equal(recorteParaProporcion(4000, 1000, P, 1).originX, 4000 - 1778);
});

test('medidas ausentes o absurdas no producen un recorte inventado', () => {
  for (const [w, h] of [[0, 900], [1600, 0], [undefined, undefined], [-10, 20], [NaN, 900]]) {
    assert.equal(recorteParaProporcion(w, h, P), null);
  }
  assert.equal(recorteParaProporcion(1600, 900, 0), null);
});

test('una posición basura cae al centro, y una fuera de rango se recorta', () => {
  const centro = recorteParaProporcion(3024, 4032, P, 0.5);
  assert.deepEqual(recorteParaProporcion(3024, 4032, P, undefined), centro);
  assert.deepEqual(recorteParaProporcion(3024, 4032, P, 'diagonal'), centro);
  assert.deepEqual(recorteParaProporcion(3024, 4032, P, NaN), centro);
  // Fuera de rango se pega al extremo: nunca un recorte que se salga de la foto.
  assert.deepEqual(recorteParaProporcion(3024, 4032, P, -3), recorteParaProporcion(3024, 4032, P, 0));
  assert.deepEqual(recorteParaProporcion(3024, 4032, P, 9), recorteParaProporcion(3024, 4032, P, 1));
  assert.equal(posicionValida('0.3'), 0.3);
});

test('la posición es continua: 0,37 no es ninguno de los tres atajos', () => {
  // Es lo que hace falta para que el arrastre sirva de algo.
  const r = recorteParaProporcion(3024, 4032, P, 0.37);
  assert.equal(r.originY, Math.round((4032 - 1701) * 0.37)); // 862
  for (const v of VALORES) {
    assert.notEqual(r.originY, recorteParaProporcion(3024, 4032, P, v).originY);
  }
});

test('la vista previa se expresa en porcentajes, sin medir nada', () => {
  // Medir la caja con `onLayout` obligaba a esperar la medición para dibujar
  // algo, y cuando no llegaba —pasa dentro de un modal— la vista previa
  // quedaba vacía sin decir por qué. En porcentajes no hay nada que esperar.
  const centro = encuadreEnCaja(3024, 4032, P, 0.5);
  assert.equal(centro.ancho, '100%');
  assert.equal(parseFloat(centro.alto).toFixed(2), '237.04');
  assert.equal(parseFloat(centro.y).toFixed(2), '-68.52');

  assert.equal(encuadreEnCaja(3024, 4032, P, 0).y, '0%');
  assert.equal(parseFloat(encuadreEnCaja(3024, 4032, P, 1).y).toFixed(2), '-137.04');
  // Y a mitad de camino entre dos atajos, la mitad del desplazamiento.
  assert.equal(parseFloat(encuadreEnCaja(3024, 4032, P, 0.25).y).toFixed(2), '-34.26');

  // Una panorámica se corre de lado, no hacia arriba.
  const pano = encuadreEnCaja(4000, 1000, P, 0);
  assert.equal(pano.alto, '100%');
  assert.equal(pano.x, '0%');
  assert.ok(parseFloat(pano.ancho) > 100);
});

test('una foto que ya calza se dibuja entera, sin desplazamiento', () => {
  assert.deepEqual(encuadreEnCaja(1600, 900, P, 1),
    { ancho: '100%', alto: '100%', x: '0%', y: '0%' });
  // Y sin medidas tampoco inventa un encuadre raro.
  assert.deepEqual(encuadreEnCaja(0, 0, P, 0.5),
    { ancho: '100%', alto: '100%', x: '0%', y: '0%' });
});

test('LO QUE SE VE ES LO QUE SE GUARDA', () => {
  // La prueba que sostiene toda la pantalla: la franja que muestra la vista
  // previa tiene que ser la misma que conserva el recorte. Si estas dos
  // cuentas se separan, alguien elige «arriba» y se guarda el medio.
  for (const [w, h] of [[3024, 4032], [4032, 3024], [4000, 1000], [1000, 4000]]) {
    // Los tres atajos y además posiciones sueltas, que es lo que deja el
    // arrastre: si solo se probaran 0, 0,5 y 1, un error proporcional en el
    // medio pasaría sin que nadie lo note.
    for (const posicion of [...VALORES, 0.13, 0.37, 0.62, 0.88]) {
      const r = recorteParaProporcion(w, h, P, posicion);
      const v = fraccionVisible(w, h, P, posicion);
      const vertical = r.height < h;
      const guardadaDesde = vertical ? r.originY / h : r.originX / w;
      const guardadaLargo = vertical ? r.height / h : r.width / w;
      assert.ok(Math.abs(guardadaDesde - v.desde) < 0.005, `${w}x${h} @${posicion} inicio`);
      assert.ok(Math.abs(guardadaLargo - v.largo) < 0.005, `${w}x${h} @${posicion} largo`);
    }
  }
});

test('los nombres son los que ve la persona, y cambian según qué sobre', () => {
  assert.equal(nombreDePosicion('inicio', 'vertical'), 'Arriba');
  assert.equal(nombreDePosicion('fin', 'vertical'), 'Abajo');
  assert.equal(nombreDePosicion('inicio', 'horizontal'), 'Izquierda');
  assert.equal(nombreDePosicion('fin', 'horizontal'), 'Derecha');
  assert.equal(nombreDePosicion('loquesea'), 'Centro');
});

test('arrastrar la foto hacia abajo muestra la parte de arriba', () => {
  // Es el sentido de cualquier recortador: uno mueve la FOTO, no la ventana.
  // Con el signo al revés se siente roto y nadie sabe explicar por qué.
  const recorrido = 400;
  assert.ok(posicionTrasArrastre(0.5, 100, recorrido) < 0.5);
  assert.ok(posicionTrasArrastre(0.5, -100, recorrido) > 0.5);
  assert.equal(posicionTrasArrastre(0.5, 200, recorrido), 0);
});

test('el arrastre nunca saca la foto de la caja', () => {
  assert.equal(posicionTrasArrastre(0.5, 99999, 400), 0);
  assert.equal(posicionTrasArrastre(0.5, -99999, 400), 1);
  assert.equal(posicionTrasArrastre(0, 50, 400), 0);
  assert.equal(posicionTrasArrastre(1, -50, 400), 1);
});

test('sin caja medida el arrastre no mueve nada, en vez de saltar al extremo', () => {
  // La medición llega después del primer dibujo, y a veces tarda. Devolver la
  // posición intacta deja los atajos funcionando mientras tanto.
  assert.equal(posicionTrasArrastre(0.42, 120, 0), 0.42);
  assert.equal(posicionTrasArrastre(0.42, 120, undefined), 0.42);
  assert.equal(posicionTrasArrastre(0.42, NaN, 400), 0.42);
});

test('el recorrido es lo que sobra de foto fuera de la caja', () => {
  // Una foto 3:4 en una caja 16:9 de 180 de alto se dibuja de 426,7: sobran
  // 246,7 para mover.
  const r = recorridoDeArrastre(3024, 4032, P, 180);
  assert.ok(Math.abs(r - (180 / (1701 / 4032) - 180)) < 1);
  // Una foto que ya calza no se puede arrastrar, y una caja sin medir tampoco.
  assert.equal(recorridoDeArrastre(1600, 900, P, 180), 0);
  assert.equal(recorridoDeArrastre(3024, 4032, P, 0), 0);
});

test('arrastrar de una punta a la otra recorre exactamente la foto', () => {
  // Cierra el círculo: mover el recorrido completo tiene que llevar de 0 a 1,
  // ni más ni menos. Si esto falla, la foto se «acaba» antes de llegar al
  // borde y quedan pedazos imposibles de encuadrar.
  const ladoCaja = 188;
  const recorrido = recorridoDeArrastre(3024, 4032, P, ladoCaja);
  assert.equal(posicionTrasArrastre(1, recorrido, recorrido), 0);
  assert.equal(posicionTrasArrastre(0, -recorrido, recorrido), 1);
});
