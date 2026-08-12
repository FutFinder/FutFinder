const test = require('node:test');
const assert = require('node:assert/strict');

const U = require('../ubicacionPropuesta.js');

/**
 * La ubicación de la propuesta oficial.
 *
 * EL FALLO QUE ORIGINÓ ESTE ARCHIVO: `LocationAutocomplete.pick()` llama
 * `onSelect(...)` y JUSTO DESPUÉS `onChangeText(payload.address)`. La pantalla
 * borraba las coordenadas en cada `onChangeText` —para que editar la dirección
 * a mano invalidara el punto—, así que el propio eco del componente las
 * borraba en el mismo instante en que se acababan de elegir. El formulario
 * seguía pidiendo «elige la cancha en el buscador» aunque el usuario ya la
 * hubiera elegido.
 *
 * Por eso las pruebas de abajo replican la SECUENCIA COMPLETA del componente,
 * no solo `seleccionarLugar` por su cuenta: llamar únicamente al `onSelect`
 * pasaría sin detectar nada.
 */

const SUGERENCIA = {
  lat: -33.4569,
  lng: -70.6019,
  address: 'Av. Grecia 3401, Ñuñoa',
  comunaRaw: 'Ñuñoa',
  regionRaw: 'Región Metropolitana',
  canchaName: 'Complejo Deportivo Ñuñoa',
};

/** Lo que hace `LocationAutocomplete.pick()`, en su orden real. */
function elegirSugerencia(estado, sugerencia) {
  const trasSelect = U.seleccionarLugar(estado, sugerencia);
  return U.escribirDireccion(trasSelect, sugerencia.address);
}

/** Lo que hace el usuario al teclear, letra a letra. */
function teclear(estado, texto) {
  return texto.split('').reduce((acc, _c, i) => U.escribirDireccion(acc, texto.slice(0, i + 1)), estado);
}

// ── la regresión ──────────────────────────────────────────────

test('REGRESIÓN: elegir una sugerencia deja la ubicación fijada, pese al eco de onChangeText', () => {
  const estado = elegirSugerencia(U.UBICACION_VACIA, SUGERENCIA);

  assert.equal(
    U.ubicacionFijada(estado),
    true,
    'tras elegir una sugerencia la ubicación tiene que quedar fijada'
  );
  assert.deepEqual(
    { lat: estado.coords.lat, lng: estado.coords.lng },
    { lat: -33.4569, lng: -70.6019 }
  );
});

test('REGRESIÓN: el eco por sí solo no borra unas coordenadas recién puestas', () => {
  const trasSelect = U.seleccionarLugar(U.UBICACION_VACIA, SUGERENCIA);
  assert.equal(U.ubicacionFijada(trasSelect), true);

  // Exactamente la llamada que hace el componente después de onSelect.
  const trasEco = U.escribirDireccion(trasSelect, SUGERENCIA.address);
  assert.equal(U.ubicacionFijada(trasEco), true, 'el eco no puede invalidar la selección');
});

test('el usuario escribe primero y después elige: la selección manda', () => {
  let estado = teclear(U.UBICACION_VACIA, 'Av. Grecia');
  assert.equal(U.ubicacionFijada(estado), false);

  estado = elegirSugerencia(estado, SUGERENCIA);
  assert.equal(U.ubicacionFijada(estado), true);
  assert.equal(estado.direccion, 'Av. Grecia 3401, Ñuñoa');
});

// ── lo que la selección rellena ───────────────────────────────

test('la sugerencia rellena dirección, comuna, región y cancha', () => {
  const estado = elegirSugerencia(U.UBICACION_VACIA, SUGERENCIA);
  assert.equal(estado.direccion, 'Av. Grecia 3401, Ñuñoa');
  assert.equal(estado.comuna, 'Ñuñoa');
  assert.match(estado.region, /Metropolitana/);
  assert.equal(estado.canchaNombre, 'Complejo Deportivo Ñuñoa');
});

test('una cancha ya escrita a mano no se pisa con la del buscador', () => {
  const conCancha = { ...U.UBICACION_VACIA, canchaNombre: 'La cancha de siempre' };
  const estado = elegirSugerencia(conCancha, SUGERENCIA);
  assert.equal(estado.canchaNombre, 'La cancha de siempre');
});

test('una sugerencia sin comuna reconocible no borra la comuna ya puesta', () => {
  const previo = { ...U.UBICACION_VACIA, comuna: 'Ñuñoa', region: 'Metropolitana' };
  const estado = elegirSugerencia(previo, {
    ...SUGERENCIA,
    comunaRaw: 'Sector sin nombre',
    regionRaw: null,
  });
  assert.equal(estado.comuna, 'Ñuñoa');
  assert.equal(estado.region, 'Metropolitana');
});

// ── editar a mano invalida ────────────────────────────────────

test('editar la dirección después de elegirla invalida las coordenadas', () => {
  let estado = elegirSugerencia(U.UBICACION_VACIA, SUGERENCIA);
  assert.equal(U.ubicacionFijada(estado), true);

  // Una sola letra de más ya es otra dirección.
  estado = U.escribirDireccion(estado, 'Av. Grecia 3401, Ñuñoa 2');
  assert.equal(U.ubicacionFijada(estado), false, 'editar a mano tiene que invalidar el punto');
  assert.equal(estado.coords, null);
});

test('borrar un carácter de la dirección elegida también invalida', () => {
  let estado = elegirSugerencia(U.UBICACION_VACIA, SUGERENCIA);
  estado = U.escribirDireccion(estado, SUGERENCIA.address.slice(0, -1));
  assert.equal(U.ubicacionFijada(estado), false);
});

test('volver a escribir exactamente la dirección elegida NO revalida por su cuenta', () => {
  // Sin coordenadas no hay nada que revalidar: una vez invalidadas, sólo las
  // devuelve el buscador. Escribir el mismo texto a mano no las inventa.
  let estado = elegirSugerencia(U.UBICACION_VACIA, SUGERENCIA);
  estado = U.escribirDireccion(estado, 'otra cosa');
  estado = U.escribirDireccion(estado, SUGERENCIA.address);
  assert.equal(U.ubicacionFijada(estado), false);
});

// ── elegir otra sugerencia revalida ───────────────────────────

test('elegir una sugerencia nueva después de editar vuelve a fijar la ubicación', () => {
  let estado = elegirSugerencia(U.UBICACION_VACIA, SUGERENCIA);
  estado = teclear({ ...estado, direccion: '', coords: null }, 'Estadio');
  assert.equal(U.ubicacionFijada(estado), false);

  const OTRA = {
    lat: -33.4644,
    lng: -70.6103,
    address: 'Av. Matta 1200, Santiago',
    comunaRaw: 'Santiago',
    regionRaw: 'Región Metropolitana',
    canchaName: 'Cancha Matta',
  };
  estado = elegirSugerencia(estado, OTRA);

  assert.equal(U.ubicacionFijada(estado), true);
  assert.equal(estado.coords.lat, -33.4644);
  assert.equal(estado.coords.lng, -70.6103);
  assert.equal(estado.direccion, 'Av. Matta 1200, Santiago');
  assert.equal(estado.comuna, 'Santiago');
});

test('elegir dos sugerencias seguidas deja la segunda, no una mezcla', () => {
  let estado = elegirSugerencia(U.UBICACION_VACIA, SUGERENCIA);
  estado = elegirSugerencia(estado, {
    lat: 10,
    lng: 20,
    address: 'Otro lugar 99',
    comunaRaw: 'Providencia',
    regionRaw: 'Región Metropolitana',
  });
  assert.equal(estado.coords.lat, 10);
  assert.equal(estado.coords.lng, 20);
  assert.equal(estado.direccion, 'Otro lugar 99');
  assert.equal(estado.comuna, 'Providencia');
});

// ── coordenadas inválidas ─────────────────────────────────────

test('una sugerencia sin coordenadas usables no fija la ubicación', () => {
  for (const malas of [
    { lat: null, lng: null },
    { lat: -33.4, lng: undefined },
    { lat: '−33.4', lng: '-70.6' },
    { lat: 91, lng: -70.6 },
    { lat: -33.4, lng: 181 },
    { lat: NaN, lng: -70.6 },
  ]) {
    const estado = elegirSugerencia(U.UBICACION_VACIA, { ...SUGERENCIA, ...malas });
    assert.equal(
      U.ubicacionFijada(estado),
      false,
      `${JSON.stringify(malas)} no debería fijar la ubicación`
    );
    // Pero la dirección legible sí se conserva: el usuario ve lo que eligió.
    assert.equal(estado.direccion, SUGERENCIA.address);
  }
});

test('una sugerencia mala no conserva las coordenadas buenas de la anterior', () => {
  let estado = elegirSugerencia(U.UBICACION_VACIA, SUGERENCIA);
  assert.equal(U.ubicacionFijada(estado), true);
  estado = elegirSugerencia(estado, { ...SUGERENCIA, lat: null, lng: null, address: 'Sin punto' });
  assert.equal(U.ubicacionFijada(estado), false, 'no puede quedarse con el punto anterior');
});

// ── el borrador que se manda al servidor ──────────────────────

test('la ubicación se traduce al borrador con los nombres que espera el payload', () => {
  const estado = elegirSugerencia(U.UBICACION_VACIA, SUGERENCIA);
  const draft = U.ubicacionDraft(estado);
  assert.deepEqual(draft, {
    direccion: 'Av. Grecia 3401, Ñuñoa',
    canchaNombre: 'Complejo Deportivo Ñuñoa',
    comuna: 'Ñuñoa',
    region: draft.region,
    latitud: -33.4569,
    longitud: -70.6019,
  });
});

test('sin ubicación fijada, el borrador manda latitud y longitud nulas, nunca 0', () => {
  const draft = U.ubicacionDraft(U.UBICACION_VACIA);
  assert.equal(draft.latitud, null);
  assert.equal(draft.longitud, null);
});

test('no revienta con entradas ausentes', () => {
  assert.equal(U.ubicacionFijada(null), false);
  assert.equal(U.ubicacionFijada(undefined), false);
  const e = U.seleccionarLugar(U.UBICACION_VACIA, {});
  assert.equal(U.ubicacionFijada(e), false);
});
