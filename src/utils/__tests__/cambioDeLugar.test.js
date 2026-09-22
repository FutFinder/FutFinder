/**
 * Pruebas de N05 (el cambio de lugar avisa) y N06 (el choque de agenda al
 * reprogramar), del lado del cliente.
 *
 * N05. El organizador editaba la dirección de su partido, elegía otro punto
 * del buscador dentro de la MISMA comuna y dejaba escrito el mismo nombre de
 * cancha. Cambiaban la dirección y las coordenadas, y no pasaba nada: ni la
 * confirmación del formulario lo contaba entre los cambios que hay que avisar,
 * ni el servidor mandaba `match_updated`. El inscrito llegaba a la cancha
 * vieja. Como control, cambiar la cuota sí avisaba: lo vigilado eran cuatro
 * campos y el lugar no era ninguno.
 *
 * N06. Mover la hora encima de otro partido de un inscrito ahora lo rechaza el
 * servidor (migración 123). Lo que se prueba acá es que ese rechazo llega al
 * organizador como una frase que se entiende y no como un código.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { cambioDeLugar } = require('../ubicacionPropuesta.js');
const { traducirChoqueDeAgenda } = require('../erroresDeAgenda.js');

// El partido tal como vuelve de PostgREST: las coordenadas son `numeric` y
// llegan como texto, con los ceros de la escala.
const PARTIDO = Object.freeze({
  direccion: 'Irarrázaval 100',
  latitud: '-33.4500000',
  longitud: '-70.6000000',
});

/** El formulario con el punto ya fijado, como lo deja `seleccionarLugar`. */
function formulario({ direccion, lat, lng }) {
  return { direccion, coords: { lat, lng, direccion } };
}

test('sin tocar nada, el lugar no cambió (y el texto numérico no engaña)', () => {
  const f = formulario({ direccion: 'Irarrázaval 100', lat: -33.45, lng: -70.6 });
  assert.equal(cambioDeLugar(f, PARTIDO), false);
});

test('EL CASO DE N05: mismo texto de dirección, otro punto del buscador', () => {
  // Otra sugerencia dentro de la misma cuadra: el nombre de la cancha y la
  // comuna no se mueven, y el organizador no escribió nada distinto.
  const f = formulario({ direccion: 'Irarrázaval 100', lat: -33.4561, lng: -70.5903 });
  assert.equal(cambioDeLugar(f, PARTIDO), true);
});

test('cambiar la dirección escrita también es cambiar el lugar', () => {
  const f = formulario({ direccion: 'Grecia 4500', lat: -33.45, lng: -70.6 });
  assert.equal(cambioDeLugar(f, PARTIDO), true);
});

test('los espacios de más no son un cambio de lugar', () => {
  const f = formulario({ direccion: '  Irarrázaval 100 ', lat: -33.45, lng: -70.6 });
  assert.equal(cambioDeLugar(f, PARTIDO), false);
});

test('sin punto válido no se inventa un cambio: la pantalla guarda el viejo', () => {
  assert.equal(cambioDeLugar({ direccion: 'Irarrázaval 100', coords: null }, PARTIDO), false);
  assert.equal(
    cambioDeLugar({ direccion: 'Irarrázaval 100', coords: { lat: null, lng: null } }, PARTIDO),
    false
  );
});

test('un partido sin dirección guardada y uno con dirección nueva sí difieren', () => {
  const f = formulario({ direccion: 'Grecia 200', lat: -33.46, lng: -70.59 });
  assert.equal(cambioDeLugar(f, { direccion: null, latitud: '-33.46', longitud: '-70.59' }), true);
});

// ---------------------------------------------------------------------------
// N06 — el rechazo del servidor, en palabras
// ---------------------------------------------------------------------------

test('el choque de agenda se traduce, con su número de afectados', () => {
  const uno = traducirChoqueDeAgenda({
    message:
      'No se puede mover: 1 inscrito(s) quedarían con dos partidos a la vez (CHOQUE_AGENDA_INSCRITOS:1)',
  });
  assert.match(uno, /Un jugador inscrito ya tiene otro partido a esa hora/);
  assert.match(uno, /Elige otro horario/);

  const varios = traducirChoqueDeAgenda('… (CHOQUE_AGENDA_INSCRITOS:3)');
  assert.match(varios, /3 jugadores inscritos/);
});

test('cualquier otro error no se disfraza de choque de agenda', () => {
  assert.equal(traducirChoqueDeAgenda(null), null);
  assert.equal(traducirChoqueDeAgenda({ message: 'Network request failed' }), null);
  // El choque del JUGADOR al inscribirse es otro caso, con otro texto.
  assert.equal(traducirChoqueDeAgenda({ message: 'CHOQUE_HORARIO' }), null);
});
