/**
 * Pruebas del contrato que faltaba fijar: si `clubs.tema` no existe en este
 * entorno, los partidos de clubes SIGUEN llegando con nombre y escudo.
 *
 * POR QUÉ IMPORTA TANTO. `withClubs()` adjunta los dos clubes a cada partido
 * y lo usan Inicio y Partidos, no solo la sección Clubes. Si alguien cambia
 * la consulta tolerante por un `select('id, nombre, foto_url, tema')` a
 * secas, en un entorno sin la migración 53 Postgres responde 42703 y falla la
 * consulta ENTERA: `club_local` y `club_visitante` quedan en `null` para
 * todos los partidos de clubes. No es que se vean sin color — se ven sin
 * nombre y sin escudo.
 *
 * El mecanismo genérico ya está probado en `columnasOpcionales.test.js`. Lo
 * que se prueba acá es que esta consulta concreta lo use.
 *
 * El cliente falso imita el encadenado de supabase-js y registra qué columnas
 * se pidieron en cada intento, para comprobar el reintento y no solo su
 * resultado.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cargarClubesDePartido,
  COLUMNAS_CLUB_DE_PARTIDO,
} = require('../clubesDePartidoQuery.js');
const { crearRegistroDeColumnas } = require('../columnasOpcionales.js');

const CLUBES = [
  { id: 'c1', nombre: 'lagardere fcv', foto_url: 'https://x/1.png', tema: 'red' },
  { id: 'c2', nombre: 'los del cerro', foto_url: 'https://x/2.png', tema: 'blue' },
];

/** El error exacto de Postgres cuando la columna no existe. */
const ERROR_42703 = {
  code: '42703',
  message: 'column clubs.tema does not exist',
};

/**
 * @param sinTema  si `true`, imita un entorno sin la migración 53: cualquier
 *                 consulta que pida `tema` falla con 42703.
 */
function clienteFalso({ sinTema = false } = {}) {
  const intentos = [];
  return {
    intentos,
    from() {
      return {
        select(columnas) {
          intentos.push(columnas);
          return {
            in(_col, ids) {
              if (sinTema && columnas.includes('tema')) {
                return Promise.resolve({ data: null, error: ERROR_42703 });
              }
              const filas = CLUBES.filter((c) => ids.includes(c.id)).map((c) => {
                const fila = { ...c };
                if (!columnas.includes('tema')) delete fila.tema;
                return fila;
              });
              return Promise.resolve({ data: filas, error: null });
            },
          };
        },
      };
    },
  };
}

test('con la migración 53 aplicada, los clubes llegan con su tema', async () => {
  const cliente = clienteFalso();
  const mapa = await cargarClubesDePartido(cliente, {
    registro: crearRegistroDeColumnas(['tema']),
    ids: ['c1', 'c2'],
  });

  assert.equal(mapa.get('c1').tema, 'red');
  assert.equal(mapa.get('c2').tema, 'blue');
  assert.deepEqual(cliente.intentos, [COLUMNAS_CLUB_DE_PARTIDO]);
});

test('sin la columna tema, los clubes CONSERVAN nombre y escudo', async () => {
  // El contrato que este archivo existe para fijar.
  const cliente = clienteFalso({ sinTema: true });
  const mapa = await cargarClubesDePartido(cliente, {
    registro: crearRegistroDeColumnas(['tema']),
    ids: ['c1', 'c2'],
  });

  assert.equal(mapa.get('c1').nombre, 'lagardere fcv');
  assert.equal(mapa.get('c1').foto_url, 'https://x/1.png');
  assert.equal(mapa.get('c2').nombre, 'los del cerro');
  assert.equal(mapa.get('c1').tema, undefined);
});

test('sin la columna tema se reintenta una vez, sin ella', async () => {
  const cliente = clienteFalso({ sinTema: true });
  await cargarClubesDePartido(cliente, {
    registro: crearRegistroDeColumnas(['tema']),
    ids: ['c1'],
  });

  assert.equal(cliente.intentos.length, 2);
  assert.match(cliente.intentos[0], /tema/);
  assert.doesNotMatch(cliente.intentos[1], /tema/);
});

test('un registro que ya sabe que falta tema no vuelve a pedirlo', async () => {
  const registro = crearRegistroDeColumnas(['tema']);
  registro.marcarAusente('tema');
  const cliente = clienteFalso({ sinTema: true });

  await cargarClubesDePartido(cliente, { registro, ids: ['c1'] });

  assert.equal(cliente.intentos.length, 1);
  assert.doesNotMatch(cliente.intentos[0], /tema/);
});

test('un error que no es de columna no se disfraza de columna ausente', async () => {
  // Un corte de red o un problema de permisos tiene que dejar el mapa vacío
  // y no reintentar: disfrazarlo escondería el problema de verdad.
  const cliente = {
    intentos: [],
    from() {
      return {
        select(columnas) {
          cliente.intentos.push(columnas);
          return { in: () => Promise.resolve({ data: null, error: { code: '08006' } }) };
        },
      };
    },
  };

  const mapa = await cargarClubesDePartido(cliente, {
    registro: crearRegistroDeColumnas(['tema']),
    ids: ['c1'],
  });

  assert.equal(mapa.size, 0);
  assert.equal(cliente.intentos.length, 1);
});

test('sin ids no se consulta nada', async () => {
  const cliente = clienteFalso();
  const mapa = await cargarClubesDePartido(cliente, {
    registro: crearRegistroDeColumnas(['tema']),
    ids: [],
  });

  assert.equal(mapa.size, 0);
  assert.deepEqual(cliente.intentos, []);
});

test('las columnas incluyen lo mínimo para pintar la tarjeta', () => {
  // Si alguien quita `nombre` o `foto_url` de acá, la tarjeta de partido de
  // clubes se queda a medias y ninguna otra prueba lo nota.
  for (const columna of ['id', 'nombre', 'foto_url', 'tema']) {
    assert.match(COLUMNAS_CLUB_DE_PARTIDO, new RegExp(`\\b${columna}\\b`));
  }
});
