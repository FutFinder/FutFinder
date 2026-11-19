/**
 * «Cómo llegar»: Apple Maps en iPhone, Google Maps en Android y la web, con
 * el punto exacto si lo hay y la dirección escrita si no.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { enlaceComoLlegar } = require('../comoLlegar.js');

const recinto = {
  nombre: 'Complejo Los Álamos',
  direccion: 'Av. Grecia 2001',
  comuna: 'Ñuñoa',
  latitud: -33.4569,
  longitud: -70.5976,
};

test('en iPhone abre Apple Maps con la ruta al punto exacto y el nombre', () => {
  assert.equal(
    enlaceComoLlegar(recinto, 'ios'),
    'https://maps.apple.com/?daddr=-33.4569,-70.5976&q=Complejo%20Los%20%C3%81lamos'
  );
});

test('en Android y en la web abre Google Maps con la ruta al punto exacto', () => {
  const esperado = 'https://www.google.com/maps/dir/?api=1&destination=-33.4569,-70.5976';
  assert.equal(enlaceComoLlegar(recinto, 'android'), esperado);
  assert.equal(enlaceComoLlegar(recinto, 'web'), esperado);
});

test('sin coordenadas usa la dirección escrita, codificada', () => {
  const sinPunto = { ...recinto, latitud: null, longitud: null };
  const texto = encodeURIComponent('Complejo Los Álamos, Av. Grecia 2001, Ñuñoa');
  assert.equal(enlaceComoLlegar(sinPunto, 'ios'), `https://maps.apple.com/?daddr=${texto}`);
  assert.equal(enlaceComoLlegar(sinPunto, 'android'), `https://www.google.com/maps/dir/?api=1&destination=${texto}`);
});

test('coordenadas que no sirven caen a la dirección: (0, 0), fuera de rango o texto', () => {
  for (const malo of [{ latitud: 0, longitud: 0 }, { latitud: 120, longitud: 10 }, { latitud: 'x', longitud: 'y' }]) {
    const url = enlaceComoLlegar({ ...recinto, ...malo }, 'android');
    assert.ok(url.endsWith(encodeURIComponent('Complejo Los Álamos, Av. Grecia 2001, Ñuñoa')), url);
  }
});

test('sin punto ni dirección no hay enlace (y el botón no se dibuja)', () => {
  assert.equal(enlaceComoLlegar({}, 'ios'), null);
  assert.equal(enlaceComoLlegar(null, 'android'), null);
  assert.equal(enlaceComoLlegar({ nombre: '  ', latitud: null }, 'web'), null);
});

test('las coordenadas que llegan como texto desde la base también sirven', () => {
  assert.equal(
    enlaceComoLlegar({ latitud: '-33.4', longitud: '-70.6' }, 'android'),
    'https://www.google.com/maps/dir/?api=1&destination=-33.4,-70.6'
  );
});
