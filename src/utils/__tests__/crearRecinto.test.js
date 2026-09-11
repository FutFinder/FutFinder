const test = require('node:test');
const assert = require('node:assert/strict');

const {
  coordenadasDeChile, estadoDePublicacion, problemasDelRecinto, recintoListo, textoDeEstado,
} = require('../crearRecinto.js');

const BUENO = { nombre: 'Cancha Norte', comuna: 'Maipú', latitud: -33.51, longitud: -70.77 };

test('un recinto con nombre, comuna y punto está listo', () => {
  assert.deepEqual(problemasDelRecinto(BUENO), []);
  assert.equal(recintoListo(BUENO), true);
});

test('sin nombre no se puede', () => {
  const p = problemasDelRecinto({ ...BUENO, nombre: '   ' });
  assert.equal(p.length, 1);
  assert.equal(p[0].campo, 'nombre');
});

test('sin comuna el problema apunta a la dirección, que es donde se arregla', () => {
  // La comuna no se escribe: sale de elegir la dirección en el buscador. Un
  // error que dijera «falta la comuna» mandaría a buscar un campo que no
  // existe en la pantalla.
  const p = problemasDelRecinto({ ...BUENO, comuna: '' });
  assert.equal(p[0].campo, 'direccion');
  assert.match(p[0].texto, /comuna/i);
});

test('una dirección escrita a mano no alcanza: falta el punto en el mapa', () => {
  const p = problemasDelRecinto({ ...BUENO, latitud: null, longitud: null });
  assert.equal(p.length, 1);
  assert.equal(p[0].campo, 'direccion');
  assert.match(p[0].texto, /punto en el mapa/i);
});

test('las coordenadas tienen que caer en Chile', () => {
  assert.equal(coordenadasDeChile(-33.51, -70.77), true);   // Santiago
  assert.equal(coordenadasDeChile(-53.16, -70.91), true);   // Punta Arenas
  assert.equal(coordenadasDeChile(-27.11, -109.35), true);  // Rapa Nui
  // El error de verdad: el signo de la latitud.
  assert.equal(coordenadasDeChile(33.51, -70.77), false);
  assert.equal(coordenadasDeChile(40.41, -3.70), false);    // Madrid
  assert.equal(coordenadasDeChile(null, -70.77), false);
  assert.equal(coordenadasDeChile('hola', 'chao'), false);
  assert.equal(coordenadasDeChile(0, 0), false);
});

test('faltan varias cosas: se devuelven todas, no la primera', () => {
  const p = problemasDelRecinto({});
  assert.equal(p.length, 2);
  assert.deepEqual(p.map((x) => x.campo), ['nombre', 'direccion']);
});

test('el camino a publicar tiene cinco estados y nunca dos a la vez', () => {
  const conHorario = [{ activa: true, tiene_horario: true }];
  const sinHorario = [{ activa: true, tiene_horario: false }];

  assert.equal(estadoDePublicacion({ publicado: false }, []), 'sin_canchas');
  assert.equal(estadoDePublicacion({ publicado: false }, sinHorario), 'sin_horario');
  assert.equal(estadoDePublicacion({ publicado: false }, conHorario), 'listo_para_revision');
  assert.equal(
    estadoDePublicacion({ publicado: false, revision_pedida_at: '2026-09-11T00:00:00Z' }, conHorario),
    'en_revision',
  );
  assert.equal(
    estadoDePublicacion({ publicado: false, aprobado_futfinder: true }, conHorario),
    'listo_para_publicar',
  );
  assert.equal(estadoDePublicacion({ publicado: true }, conHorario), 'publicado');
});

test('una cancha apagada no cuenta aunque tenga horario', () => {
  assert.equal(
    estadoDePublicacion({ publicado: false }, [{ activa: false, tiene_horario: true }]),
    'sin_horario',
  );
});

test('aprobado manda sobre «pedí revisión»: ya no está en revisión', () => {
  // Las dos marcas conviven en la fila —pedir revisión no borra nada— así
  // que el orden en que se miran es lo único que evita decir «lo estamos
  // revisando» sobre algo ya aprobado.
  const estado = estadoDePublicacion(
    { publicado: false, aprobado_futfinder: true, revision_pedida_at: '2026-09-11T00:00:00Z' },
    [{ activa: true, tiene_horario: true }],
  );
  assert.equal(estado, 'listo_para_publicar');
});

test('un recinto aprobado al que le apagaron las canchas vuelve a «falta»', () => {
  // Importa porque el servidor tampoco lo dejaría publicar: las dos
  // condiciones son independientes y la pantalla no puede prometer una
  // publicación que el servidor va a rechazar.
  assert.equal(
    estadoDePublicacion({ publicado: false, aprobado_futfinder: true }, [{ activa: false, tiene_horario: true }]),
    'sin_horario',
  );
});

test('todo estado tiene texto y ninguno queda vacío', () => {
  for (const e of ['sin_canchas', 'sin_horario', 'listo_para_revision', 'en_revision',
    'listo_para_publicar', 'publicado']) {
    const t = textoDeEstado(e);
    assert.ok(t.titulo && t.cuerpo, e);
  }
  assert.equal(textoDeEstado('inventado').titulo, textoDeEstado('sin_canchas').titulo);
});

test('el texto de «listo para revisión» dice que publicar pasa por FutFinder', () => {
  assert.match(textoDeEstado('listo_para_revision').cuerpo, /pasa por nosotros/i);
});
