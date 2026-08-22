const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../columnasOpcionales.js');

/**
 * Columnas que una migración agregó después y pueden faltar en un entorno.
 *
 * LO QUE DE VERDAD SE PROTEGE ACÁ:
 *
 *   · UNA COLUMNA QUE FALTA NO PUEDE TUMBAR LA PANTALLA. Postgres contesta
 *     42703 y la consulta se rehace sin esa columna, no se rinde.
 *
 *   · PERO TAMPOCO PUEDE MENTIR. Escribir sin la columna devuelve la lista
 *     de lo que se quedó fuera, para que la pantalla pueda decir «el color
 *     no se guardó» en vez de dar por guardado algo que nunca viajó.
 *
 *   · SE PREGUNTA UNA VEZ. Descubierto el hueco, no se vuelve a pedir esa
 *     columna en toda la sesión.
 *
 *   · UN ERROR QUE NO ES ESE SE DEVUELVE TAL CUAL. Un fallo de red o de
 *     permisos no puede disfrazarse de «falta una columna» ni provocar
 *     reintentos infinitos.
 */

const OPCIONALES = ['modalidad', 'tema'];

function error42703(columna) {
  return { code: '42703', message: `column clubs.${columna} does not exist` };
}

// ── esColumnaInexistente ─────────────────────────────────────────────

test('reconoce el 42703 de la columna que se preguntó', () => {
  assert.equal(C.esColumnaInexistente(error42703('tema'), 'tema'), true);
  assert.equal(
    C.esColumnaInexistente(
      { code: '42703', message: 'column "tema" of relation "clubs" does not exist' },
      'tema'
    ),
    true
  );
});

test('no confunde una columna con otra', () => {
  assert.equal(C.esColumnaInexistente(error42703('modalidad'), 'tema'), false);
});

test('«tema» no se encuentra dentro de «sistema»', () => {
  assert.equal(
    C.esColumnaInexistente({ code: '42703', message: 'column sistema does not exist' }, 'tema'),
    false
  );
});

test('otro código de error no es una columna que falta', () => {
  assert.equal(C.esColumnaInexistente({ code: '42501', message: 'tema' }, 'tema'), false);
  assert.equal(C.esColumnaInexistente(null, 'tema'), false);
  assert.equal(C.esColumnaInexistente(undefined, 'tema'), false);
});

// ── columnasDisponibles ──────────────────────────────────────────────

test('mientras no falte nada, se piden todas las columnas', () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  assert.equal(
    C.columnasDisponibles(registro, 'id, nombre, modalidad, tema'),
    'id, nombre, modalidad, tema'
  );
});

test('una columna marcada ausente deja de pedirse', () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  registro.marcarAusente('tema');
  assert.equal(C.columnasDisponibles(registro, 'id, nombre, modalidad, tema'), 'id, nombre, modalidad');
});

test('las columnas que no son opcionales nunca se sacan', () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  registro.marcarAusente('modalidad');
  registro.marcarAusente('tema');
  assert.equal(C.columnasDisponibles(registro, 'id, nombre'), 'id, nombre');
});

// ── leerTolerandoColumnas ────────────────────────────────────────────

test('una lectura que funciona se hace una sola vez, con todo', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  const pedidas = [];
  const { data, error } = await C.leerTolerandoColumnas({
    registro,
    columnas: 'id, tema',
    leer: async (cols) => {
      pedidas.push(cols);
      return { data: [{ id: 'c1', tema: 'blue' }], error: null };
    },
  });

  assert.equal(error, null);
  assert.deepEqual(data, [{ id: 'c1', tema: 'blue' }]);
  assert.deepEqual(pedidas, ['id, tema']);
});

test('si falta la columna, se reintenta sin ella y la lectura llega igual', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  const pedidas = [];
  const { data, error } = await C.leerTolerandoColumnas({
    registro,
    columnas: 'id, tema',
    leer: async (cols) => {
      pedidas.push(cols);
      if (cols.includes('tema')) return { data: null, error: error42703('tema') };
      return { data: [{ id: 'c1' }], error: null };
    },
  });

  assert.equal(error, null);
  assert.deepEqual(data, [{ id: 'c1' }]);
  assert.deepEqual(pedidas, ['id, tema', 'id']);
});

test('el hueco se recuerda: la segunda lectura ya no pide la columna', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  const leer = async (cols) =>
    cols.includes('tema')
      ? { data: null, error: error42703('tema') }
      : { data: [], error: null };

  await C.leerTolerandoColumnas({ registro, columnas: 'id, tema', leer });

  const pedidas = [];
  await C.leerTolerandoColumnas({
    registro,
    columnas: 'id, tema',
    leer: async (cols) => {
      pedidas.push(cols);
      return { data: [], error: null };
    },
  });
  assert.deepEqual(pedidas, ['id']);
});

test('faltando las dos columnas, se sacan las dos', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  const pedidas = [];
  const { error } = await C.leerTolerandoColumnas({
    registro,
    columnas: 'id, modalidad, tema',
    leer: async (cols) => {
      pedidas.push(cols);
      if (cols.includes('tema')) return { data: null, error: error42703('tema') };
      if (cols.includes('modalidad')) return { data: null, error: error42703('modalidad') };
      return { data: [], error: null };
    },
  });

  assert.equal(error, null);
  assert.deepEqual(pedidas, ['id, modalidad, tema', 'id, modalidad', 'id']);
});

test('un error que no es «falta la columna» se devuelve tal cual, sin reintentar', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  const caido = { code: '42501', message: 'permission denied' };
  let veces = 0;
  const { error } = await C.leerTolerandoColumnas({
    registro,
    columnas: 'id, tema',
    leer: async () => {
      veces += 1;
      return { data: null, error: caido };
    },
  });

  assert.equal(error, caido);
  assert.equal(veces, 1);
  assert.equal(registro.esDisponible('tema'), true, 'un fallo de permisos no marca la columna');
});

// ── escribirTolerandoColumnas ────────────────────────────────────────

test('un guardado que funciona manda el patch entero y no omite nada', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  const enviados = [];
  const { data, error, omitidas } = await C.escribirTolerandoColumnas({
    registro,
    patch: { nombre: 'Club prueba', tema: 'red' },
    escribir: async (p) => {
      enviados.push({ ...p });
      return { data: { id: 'c1' }, error: null };
    },
  });

  assert.equal(error, null);
  assert.deepEqual(data, { id: 'c1' });
  assert.deepEqual(omitidas, []);
  assert.deepEqual(enviados, [{ nombre: 'Club prueba', tema: 'red' }]);
});

test('si falta la columna, se guarda el resto y se AVISA de lo que quedó fuera', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  const enviados = [];
  const { error, omitidas } = await C.escribirTolerandoColumnas({
    registro,
    patch: { nombre: 'Club prueba', tema: 'red' },
    escribir: async (p) => {
      // Copia: la función reutiliza el mismo objeto entre reintentos, así que
      // guardar la referencia anotaría el último estado en todas las vueltas.
      enviados.push({ ...p });
      if ('tema' in p) return { data: null, error: error42703('tema') };
      return { data: { id: 'c1' }, error: null };
    },
  });

  assert.equal(error, null);
  assert.deepEqual(omitidas, ['tema'], 'la pantalla tiene que poder decir que el color no se guardó');
  assert.deepEqual(enviados, [{ nombre: 'Club prueba', tema: 'red' }, { nombre: 'Club prueba' }]);
});

test('una columna ya conocida como ausente se saca ANTES del primer intento', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  registro.marcarAusente('tema');
  const enviados = [];
  const { omitidas } = await C.escribirTolerandoColumnas({
    registro,
    patch: { nombre: 'Club prueba', tema: 'red' },
    escribir: async (p) => {
      enviados.push({ ...p });
      return { data: { id: 'c1' }, error: null };
    },
  });

  assert.deepEqual(enviados, [{ nombre: 'Club prueba' }]);
  assert.deepEqual(omitidas, ['tema']);
});

test('si no queda nada que mandar, no se llama a la base de datos', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  registro.marcarAusente('tema');
  let veces = 0;
  const { data, error, omitidas } = await C.escribirTolerandoColumnas({
    registro,
    patch: { tema: 'red' },
    escribir: async () => {
      veces += 1;
      return { data: null, error: { code: 'PGRST102', message: 'empty body' } };
    },
  });

  assert.equal(veces, 0, 'un update vacío es un error de PostgREST, no un guardado');
  assert.equal(error, null);
  assert.equal(data, null);
  assert.deepEqual(omitidas, ['tema']);
});

test('un error de permisos al guardar se devuelve tal cual y no omite nada', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  const caido = { code: 'PGRST116', message: 'no rows' };
  let veces = 0;
  const { error, omitidas } = await C.escribirTolerandoColumnas({
    registro,
    patch: { nombre: 'Club prueba', tema: 'red' },
    escribir: async () => {
      veces += 1;
      return { data: null, error: caido };
    },
  });

  assert.equal(error, caido);
  assert.equal(veces, 1);
  assert.deepEqual(omitidas, []);
});

test('el patch original no se modifica', async () => {
  const registro = C.crearRegistroDeColumnas(OPCIONALES);
  registro.marcarAusente('tema');
  const patch = { nombre: 'Club prueba', tema: 'red' };
  await C.escribirTolerandoColumnas({
    registro,
    patch,
    escribir: async () => ({ data: {}, error: null }),
  });
  assert.deepEqual(patch, { nombre: 'Club prueba', tema: 'red' });
});
