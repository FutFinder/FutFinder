/**
 * Pruebas del techo de espera.
 *
 * Existe para que una animación decorativa no pueda ser lo único que impide
 * navegar. Lo que se prueba es justamente el caso feo: una promesa que NO
 * resuelve nunca tiene que dejar seguir igual.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { conTecho } = require('../conTecho.js');

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

test('si la promesa llega a tiempo, se espera a que termine', async () => {
  let termino = false;
  const p = dormir(10).then(() => { termino = true; });
  assert.equal(await conTecho(p, 200), true);
  assert.equal(termino, true, 'se esperó de verdad, no se soltó antes');
});

test('una promesa que no resuelve nunca NO deja colgado', async () => {
  const nunca = new Promise(() => {});
  assert.equal(await conTecho(nunca, 20), false, 'devuelve false: se agotó el techo');
});

test('una promesa lenta suelta al llegar el techo, sin esperar a que termine', async () => {
  let termino = false;
  const lenta = dormir(300).then(() => { termino = true; });
  const t0 = Date.now();
  assert.equal(await conTecho(lenta, 20), false);
  assert.ok(Date.now() - t0 < 200, 'no se quedó esperando los 300 ms');
  assert.equal(termino, false);
});

test('una promesa que falla tampoco deja colgado', async () => {
  // El que llama no quiere manejar el error de una animación: quiere seguir.
  const rota = Promise.reject(new Error('reventó'));
  assert.equal(await conTecho(rota, 200), true, 'terminó (mal, pero terminó) antes del techo');
});

test('sin techo o con techo no válido se espera la promesa, no se suelta al instante', async () => {
  // Un techo de 0 por un parámetro mal pasado no puede convertirse en «no
  // esperes nada»: eso rompería la espera justo donde se quería reforzar.
  let termino = false;
  const p = dormir(10).then(() => { termino = true; });
  assert.equal(await conTecho(p), true);
  assert.equal(termino, true);
});
