/**
 * Pruebas del historial real de un club y sus estadísticas (migración 49).
 *
 * LO QUE ESTAS PRUEBAS CUIDAN, en orden de importancia:
 *
 *   1. QUE EL MARCADOR SE LEA DESDE EL CLUB QUE SE MIRA. La base de datos
 *      guarda «Club A 3-1 Club B» una sola vez, y esa fila tiene que leerse
 *      «Victoria 3-1» en el perfil de A y «Derrota 1-3» en el de B. Asumir
 *      que el club consultado es el local invierte el resultado de la mitad
 *      del historial, y una derrota mostrada como victoria no se ve como un
 *      error: se ve como un dato.
 *   2. QUE LA INSIGNIA NO PUEDA CONTRADECIR AL MARCADOR. La letra V/E/D se
 *      deriva de los dos números que la tarjeta pinta, no de la columna
 *      `resultado` del servidor; las pruebas comprueban que las dos coincidan
 *      en los cinco casos posibles.
 *   3. QUE UN PARTIDO SIN RESULTADO CONFIRMADO NO SE CUENTE COMO JUGADO. El
 *      filtro real es el `join` interno de `historial_club()` —probado en
 *      `supabase/tests/49_historial_test.sql`, 13/13—, y acá se comprueba que
 *      la migración lo tenga y que el cliente descarte igual una fila sin
 *      marcador si alguna vez llegara.
 *   4. QUE NO QUEDE NINGÚN FIXTURE EN PRODUCCIÓN. La última prueba recorre
 *      `src/` buscando los tres símbolos de los partidos de ejemplo.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RESULTADO,
  HISTORIAL_RPC,
  ESTADISTICAS_RPC,
  HISTORIAL_COLUMNAS,
  ESTADISTICAS_COLUMNAS,
  ESTADISTICAS_VACIAS,
  argumentosHistorial,
  argumentosEstadisticas,
  resultadoDesdeMarcador,
  resumenEstadisticas,
  HISTORIAL_LIMITE_MAX,
  formatFechaCorta,
  formatHora,
  normalizarPartido,
  normalizarHistorial,
  normalizarEstadisticas,
  cargarHistorial,
  cargarEstadisticas,
} = require('../historialClub.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const MIGRACION = path.join(RAIZ, 'supabase', 'migrations', '49_historial_real_club.sql');

const CLUB_A = '11111111-1111-4111-8111-111111111111';
const CLUB_B = '22222222-2222-4222-8222-222222222222';
const AJENO = '99999999-9999-4999-8999-999999999999';

/**
 * Una fila tal como la devuelve `historial_club()`.
 *
 * Incluye la columna `resultado` del servidor a propósito: varias pruebas
 * comprueban que la letra derivada en el cliente coincida con ella.
 */
function fila({
  id,
  local = CLUB_A,
  visitante = CLUB_B,
  golesLocal,
  golesVisitante,
  fecha = '2026-07-28',
  hora = '2026-07-28T21:00:00-04:00',
  cancha = 'Cancha El Roble',
  nivel = 'competitivo',
  integrante = true,
  desde = CLUB_A,
}) {
  const empate = golesLocal === golesVisitante;
  const ganoLocal = golesLocal > golesVisitante;
  const resultado = empate
    ? 'E'
    : (desde === local && ganoLocal) || (desde === visitante && !ganoLocal)
      ? 'V'
      : 'D';
  return {
    match_id: id,
    fecha,
    hora: integrante ? hora : null,
    club_local_id: local,
    club_local_nombre: local === CLUB_A ? 'Club A' : 'Club B',
    club_local_foto_url: local === CLUB_A ? 'https://cdn/a.png' : 'https://cdn/b.png',
    club_visitante_id: visitante,
    club_visitante_nombre: visitante === CLUB_A ? 'Club A' : 'Club B',
    club_visitante_foto_url: visitante === CLUB_A ? 'https://cdn/a.png' : 'https://cdn/b.png',
    goles_local: golesLocal,
    goles_visitante: golesVisitante,
    resultado,
    cancha_nombre: integrante ? cancha : null,
    nivel,
    soy_integrante: integrante,
  };
}

/** Cliente con la forma de PostgREST: sólo `rpc`, y anota lo que le piden. */
function clienteFalso(respuestas) {
  const llamadas = [];
  return {
    llamadas,
    rpc: async (nombre, args) => {
      llamadas.push({ nombre, args });
      const r = respuestas[nombre];
      if (r === undefined) return { data: null, error: { code: 'PGRST202', message: 'no existe' } };
      return typeof r === 'function' ? r(args) : { data: r, error: null };
    },
  };
}

/** Corre algo con `console.error` callado: hay pruebas de caminos de error. */
async function sinConsola(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

// ---------------------------------------------------------------------------
// 1. Historial vacío
// ---------------------------------------------------------------------------

test('historial vacío: un club sin encuentros confirmados no muestra nada', async () => {
  const cliente = clienteFalso({ [HISTORIAL_RPC]: [] });
  const { data, error } = await cargarHistorial(cliente, CLUB_A);

  assert.equal(error, null);
  assert.deepEqual(data, []);
  // El vacío se pide igual: no hay atajo que evite la consulta y muestre un
  // relleno mientras tanto.
  assert.equal(cliente.llamadas.length, 1);
  assert.equal(cliente.llamadas[0].nombre, HISTORIAL_RPC);
});

test('historial vacío: sin cliente o sin club tampoco se inventa nada', async () => {
  assert.deepEqual((await cargarHistorial(null, CLUB_A)).data, []);
  assert.deepEqual((await cargarHistorial(clienteFalso({}), null)).data, []);
});

// ---------------------------------------------------------------------------
// 2. Los cinco resultados, desde los dos lados
// ---------------------------------------------------------------------------

test('partido ganado como local: 3-1 es Victoria 3-1', () => {
  const p = normalizarPartido(fila({ id: 'm1', golesLocal: 3, golesVisitante: 1 }), CLUB_A);

  assert.equal(p.esLocal, true);
  assert.equal(p.miMarcador, 3);
  assert.equal(p.suMarcador, 1);
  assert.equal(p.resultado, RESULTADO.VICTORIA);
  assert.equal(p.resultadoNombre, 'Victoria');
  assert.equal(p.localLabel, 'Local');
  assert.equal(p.miNombre, 'Club A');
  assert.equal(p.rivalNombre, 'Club B');
});

test('partido perdido como local: 1-3 es Derrota 1-3', () => {
  const p = normalizarPartido(fila({ id: 'm2', golesLocal: 1, golesVisitante: 3 }), CLUB_A);

  assert.equal(p.miMarcador, 1);
  assert.equal(p.suMarcador, 3);
  assert.equal(p.resultado, RESULTADO.DERROTA);
  assert.equal(p.resultadoNombre, 'Derrota');
  assert.equal(p.localLabel, 'Local');
});

test('partido ganado como visitante: el 0-2 ajeno es Victoria 2-0 propia', () => {
  // Club B es local; se mira desde A, que fue de visita y ganó.
  const p = normalizarPartido(
    fila({ id: 'm3', local: CLUB_B, visitante: CLUB_A, golesLocal: 0, golesVisitante: 2, desde: CLUB_A }),
    CLUB_A
  );

  assert.equal(p.esLocal, false);
  assert.equal(p.localLabel, 'Visita');
  assert.equal(p.miMarcador, 2);
  assert.equal(p.suMarcador, 0);
  assert.equal(p.resultado, RESULTADO.VICTORIA);
  assert.equal(p.miNombre, 'Club A');
  assert.equal(p.rivalNombre, 'Club B');
});

test('partido perdido como visitante: el 3-1 ajeno es Derrota 1-3 propia', () => {
  const p = normalizarPartido(
    fila({ id: 'm4', local: CLUB_B, visitante: CLUB_A, golesLocal: 3, golesVisitante: 1, desde: CLUB_A }),
    CLUB_A
  );

  assert.equal(p.esLocal, false);
  assert.equal(p.miMarcador, 1);
  assert.equal(p.suMarcador, 3);
  assert.equal(p.resultado, RESULTADO.DERROTA);
});

test('empate: el 2-2 es Empate para los dos clubes', () => {
  const cruda = fila({ id: 'm5', golesLocal: 2, golesVisitante: 2 });
  const paraA = normalizarPartido(cruda, CLUB_A);
  const paraB = normalizarPartido(cruda, CLUB_B);

  assert.equal(paraA.resultado, RESULTADO.EMPATE);
  assert.equal(paraB.resultado, RESULTADO.EMPATE);
  assert.equal(paraA.resultadoNombre, 'Empate');
  assert.equal(paraA.miMarcador, 2);
  assert.equal(paraB.miMarcador, 2);
});

// ---------------------------------------------------------------------------
// 3. La misma fila, invertida
// ---------------------------------------------------------------------------

test('marcador invertido: la MISMA fila es 3-1 V para el local y 1-3 D para el visitante', () => {
  const cruda = fila({ id: 'm6', golesLocal: 3, golesVisitante: 1 });

  const paraA = normalizarPartido(cruda, CLUB_A);
  const paraB = normalizarPartido(cruda, CLUB_B);

  assert.equal(`${paraA.miMarcador}-${paraA.suMarcador}`, '3-1');
  assert.equal(paraA.resultado, RESULTADO.VICTORIA);
  assert.equal(paraA.rivalNombre, 'Club B');

  assert.equal(`${paraB.miMarcador}-${paraB.suMarcador}`, '1-3');
  assert.equal(paraB.resultado, RESULTADO.DERROTA);
  assert.equal(paraB.miNombre, 'Club B');
  assert.equal(paraB.rivalNombre, 'Club A');
});

test('la letra derivada coincide siempre con la columna `resultado` del servidor', () => {
  const casos = [
    { golesLocal: 3, golesVisitante: 1 },
    { golesLocal: 1, golesVisitante: 3 },
    { golesLocal: 0, golesVisitante: 0 },
    { golesLocal: 5, golesVisitante: 4 },
    { golesLocal: 0, golesVisitante: 7 },
  ];

  for (const goles of casos) {
    for (const [club, local, visitante] of [
      [CLUB_A, CLUB_A, CLUB_B],
      [CLUB_B, CLUB_A, CLUB_B],
      [CLUB_A, CLUB_B, CLUB_A],
      [CLUB_B, CLUB_B, CLUB_A],
    ]) {
      const cruda = fila({ id: 'x', local, visitante, desde: club, ...goles });
      const p = normalizarPartido(cruda, club);
      assert.equal(
        p.resultado,
        cruda.resultado,
        `la insignia (${p.resultado}) contradice al servidor (${cruda.resultado}) en ${JSON.stringify(goles)}`
      );
    }
  }
});

test('un club que no jugó el partido no lo interpreta: la fila se descarta', () => {
  assert.equal(normalizarPartido(fila({ id: 'm7', golesLocal: 1, golesVisitante: 0 }), AJENO), null);
});

// ---------------------------------------------------------------------------
// 4. Sin resultado confirmado no hay partido jugado
// ---------------------------------------------------------------------------

test('una fila sin marcador se descarta en vez de mostrarse como finalizada', () => {
  const sinMarcador = fila({ id: 'm8', golesLocal: 2, golesVisitante: 1 });
  sinMarcador.goles_local = null;
  sinMarcador.goles_visitante = null;
  sinMarcador.resultado = null;

  assert.equal(normalizarPartido(sinMarcador, CLUB_A), null);
  assert.deepEqual(normalizarHistorial([sinMarcador], CLUB_A), []);
});

test('`historial_club()` exige el resultado confirmado con un join interno', () => {
  const sql = fs.readFileSync(MIGRACION, 'utf8');

  // El `join` de los resultados NO puede ser `left`: con un `left join` un
  // partido cerrado sin marcador saldría igual, que es el fallo que esta
  // tarea cierra. El arnés SQL lo comprueba contra la base (caso 5); acá se
  // comprueba que la migración versionada diga lo mismo.
  const joinResultados = sql.match(/(left\s+)?join\s+public\.club_match_results/i);
  assert.ok(joinResultados, 'la migración ya no consulta club_match_results');
  assert.equal(
    /left/i.test(joinResultados[0]),
    false,
    'el join contra club_match_results volvió a ser LEFT: un partido sin resultado saldría en el historial'
  );
  assert.match(sql, /r\.estado\s*=\s*'confirmado'/);
  assert.match(sql, /m\.estado\s*=\s*'finalizado'/);
});

// ---------------------------------------------------------------------------
// 5. Varios partidos, y lo que se ve de cada uno
// ---------------------------------------------------------------------------

test('varios partidos: se normalizan todos y en el orden en que llegan', async () => {
  const filas = [
    fila({ id: 'm-nuevo', golesLocal: 2, golesVisitante: 0, fecha: '2026-08-10' }),
    fila({ id: 'm-medio', local: CLUB_B, visitante: CLUB_A, golesLocal: 1, golesVisitante: 1, fecha: '2026-08-01' }),
    fila({ id: 'm-viejo', golesLocal: 0, golesVisitante: 4, fecha: '2026-07-20' }),
  ];
  const cliente = clienteFalso({ [HISTORIAL_RPC]: filas });

  const { data, error } = await cargarHistorial(cliente, CLUB_A, { limit: 5 });

  assert.equal(error, null);
  assert.equal(data.length, 3);
  assert.deepEqual(
    data.map((p) => p.id),
    ['m-nuevo', 'm-medio', 'm-viejo']
  );
  assert.deepEqual(
    data.map((p) => p.resultado),
    [RESULTADO.VICTORIA, RESULTADO.EMPATE, RESULTADO.DERROTA]
  );
  assert.deepEqual(cliente.llamadas[0].args, { p_club_id: CLUB_A, p_limit: 5 });
});

test('cada partido trae escudos, fecha, hora y cancha', () => {
  const p = normalizarPartido(
    fila({ id: 'm9', golesLocal: 1, golesVisitante: 0, nivel: 'intermedio' }),
    CLUB_A
  );

  assert.equal(p.miLogoUrl, 'https://cdn/a.png');
  assert.equal(p.rivalLogoUrl, 'https://cdn/b.png');
  assert.equal(p.horaLabel, '21:00');
  assert.equal(p.canchaNombre, 'Cancha El Roble');
  assert.equal(p.soyIntegrante, true);
  assert.match(p.fechaLabel, /^28/);
});

test('el tipo de partido NO viaja al historial: en un encuentro entre clubes nadie lo elige', () => {
  // Hallazgo de la auditoría de la 6.3: ni `club_challenges` ni
  // `club_challenge_proposals` tienen nivel, y `aprobar_propuesta()` crea el
  // partido sin ponerlo, así que queda el `default 'recreativo'` de la tabla.
  // Los 7 partidos de clubes de producción están todos en 'recreativo' por
  // omisión. Mostrarlo era enseñar un valor por defecto como si fuera un dato.
  for (const nivel of ['recreativo', 'intermedio', 'competitivo', null]) {
    const p = normalizarPartido(fila({ id: 'm-nivel', golesLocal: 1, golesVisitante: 0, nivel }), CLUB_A);
    assert.equal(p.tipoLabel, undefined, `el nivel «${nivel}» volvió a la tarjeta`);
  }

  // Y la tarjeta tampoco lo espera ya.
  const tarjeta = fs.readFileSync(
    path.join(RAIZ, 'src', 'components', 'club', 'MatchHistoryCard.js'),
    'utf8'
  );
  assert.equal(tarjeta.includes('tipoLabel'), false, 'MatchHistoryCard sigue recibiendo tipoLabel');
});

test('la fecha no se corre un día: 2026-07-28 se lee 28, no 27', () => {
  // `new Date('2026-07-28')` es medianoche UTC y en Chile eso es el 27 a las
  // 20:00. `fecha` ya viene en hora de Chile, así que se parte a mano.
  assert.match(formatFechaCorta('2026-07-28'), /^28/);
  assert.match(formatFechaCorta('2026-01-01'), /^01/);
  assert.equal(formatFechaCorta(null), '');
  assert.equal(formatFechaCorta('no es fecha'), '');
});

test('a quien no es del club no le llegan hora ni cancha, pero sí el marcador', () => {
  const p = normalizarPartido(
    fila({ id: 'm10', golesLocal: 3, golesVisitante: 1, integrante: false }),
    CLUB_A
  );

  assert.equal(p.horaLabel, null);
  assert.equal(p.canchaNombre, null);
  assert.equal(p.soyIntegrante, false);
  // Lo público sigue estando: clubes, escudos, marcador y resultado.
  assert.equal(p.miMarcador, 3);
  assert.equal(p.resultado, RESULTADO.VICTORIA);
  assert.equal(p.rivalLogoUrl, 'https://cdn/b.png');
});

test('las etiquetas sueltas: hora y resultado sin datos', () => {
  assert.equal(formatHora(null), null);
  assert.equal(formatHora('esto no es una hora'), null);

  assert.equal(resultadoDesdeMarcador(null, 2), null);
  assert.equal(resultadoDesdeMarcador(2, undefined), null);
});

test('el límite se acota al máximo del servidor y a un número válido', () => {
  assert.deepEqual(argumentosHistorial(CLUB_A), { p_club_id: CLUB_A, p_limit: 20 });
  assert.deepEqual(argumentosHistorial(CLUB_A, 3), { p_club_id: CLUB_A, p_limit: 3 });
  assert.deepEqual(argumentosHistorial(CLUB_A, 999), { p_club_id: CLUB_A, p_limit: 50 });
  assert.deepEqual(argumentosHistorial(CLUB_A, 0), { p_club_id: CLUB_A, p_limit: 20 });
  assert.deepEqual(argumentosHistorial(CLUB_A, 'muchos'), { p_club_id: CLUB_A, p_limit: 20 });
  assert.deepEqual(argumentosEstadisticas(CLUB_A), { p_club_id: CLUB_A });
});

// ---------------------------------------------------------------------------
// 6. Estadísticas reales
// ---------------------------------------------------------------------------

test('estadísticas reales: PJ, V, E, D, GF y GC salen del servidor', async () => {
  const cliente = clienteFalso({
    [ESTADISTICAS_RPC]: [{ pj: 3, v: 2, e: 1, d: 0, gf: 7, gc: 3 }],
  });

  const { data, error } = await cargarEstadisticas(cliente, CLUB_A);

  assert.equal(error, null);
  assert.deepEqual(data, { pj: 3, v: 2, e: 1, d: 0, gf: 7, gc: 3 });
  assert.equal(cliente.llamadas[0].nombre, ESTADISTICAS_RPC);
  assert.deepEqual(cliente.llamadas[0].args, { p_club_id: CLUB_A });
});

test('estadísticas: una fila suelta (no un arreglo) se entiende igual', () => {
  assert.deepEqual(normalizarEstadisticas({ pj: 1, v: 0, e: 0, d: 1, gf: 0, gc: 2 }), {
    pj: 1,
    v: 0,
    e: 0,
    d: 1,
    gf: 0,
    gc: 2,
  });
});

test('estadísticas de un club que no jugó: ceros, nunca nulos', async () => {
  assert.deepEqual(normalizarEstadisticas(null), { ...ESTADISTICAS_VACIAS });
  assert.deepEqual(normalizarEstadisticas([]), { ...ESTADISTICAS_VACIAS });
  assert.deepEqual(normalizarEstadisticas([{ pj: null, v: null, e: null, d: null }]), {
    ...ESTADISTICAS_VACIAS,
  });

  const cliente = clienteFalso({ [ESTADISTICAS_RPC]: [] });
  const { data } = await cargarEstadisticas(cliente, CLUB_A);
  assert.deepEqual(data, { ...ESTADISTICAS_VACIAS });
});

test('el resumen de estadísticas se escribe en un solo lugar y lo usan las dos pantallas', () => {
  assert.equal(
    resumenEstadisticas({ pj: 8, v: 5, e: 1, d: 2, gf: 21, gc: 12 }),
    '8 partidos jugados · 21 goles a favor · 12 en contra'
  );
  // Singulares: «1 partido jugado» y «1 gol a favor», no «1 partidos».
  assert.equal(
    resumenEstadisticas({ pj: 1, v: 1, e: 0, d: 0, gf: 1, gc: 0 }),
    '1 partido jugado · 1 gol a favor · 0 en contra'
  );
  // Sin partidos no hay frase que mostrar.
  assert.equal(resumenEstadisticas(ESTADISTICAS_VACIAS), null);
  assert.equal(resumenEstadisticas(null), null);

  // Y ninguna de las dos pantallas se lo escribe por su cuenta: si una lo
  // hiciera, el mismo dato acabaría redactado de dos formas.
  for (const pantalla of ['ClubDetailScreen.js', 'ClubHistoryScreen.js']) {
    const texto = fs.readFileSync(path.join(RAIZ, 'src', 'screens', pantalla), 'utf8');
    assert.match(texto, /resumenEstadisticas/, `${pantalla} no usa el resumen compartido`);
    assert.equal(
      texto.includes('partidos jugados'),
      false,
      `${pantalla} volvió a armar la frase del resumen a mano`
    );
  }
});

test('el historial completo pide el tope real de la RPC, no los tres del perfil', () => {
  assert.equal(HISTORIAL_LIMITE_MAX, 50);
  assert.deepEqual(argumentosHistorial(CLUB_A, HISTORIAL_LIMITE_MAX), {
    p_club_id: CLUB_A,
    p_limit: 50,
  });

  const pantalla = fs.readFileSync(
    path.join(RAIZ, 'src', 'screens', 'ClubHistoryScreen.js'),
    'utf8'
  );
  assert.match(pantalla, /HISTORIAL_LIMITE_MAX/);
  // Reutiliza el servicio y la tarjeta del perfil: nada de una segunda
  // normalización que algún día muestre otra cosa del mismo partido.
  assert.match(pantalla, /getClubMatchHistory/);
  assert.match(pantalla, /MatchHistoryCard/);
});

test('«Ver todo» del historial ya no lleva a la bandeja de desafíos', () => {
  const perfil = fs.readFileSync(path.join(RAIZ, 'src', 'screens', 'ClubDetailScreen.js'), 'utf8');
  const seccion = perfil.slice(
    perfil.indexOf('Historial de partidos'),
    perfil.indexOf('Fotos del club')
  );
  assert.match(seccion, /navigate\('ClubHistory'/);
  assert.equal(
    seccion.includes("navigate('ClubChallenges'"),
    false,
    'el historial sigue mandando a la bandeja de desafíos'
  );

  // Y la ruta existe de verdad en el navegador: un `navigate` a una pantalla
  // no registrada no falla al compilar, falla al tocarlo.
  const nav = fs.readFileSync(path.join(RAIZ, 'src', 'navigation', 'AppNavigator.js'), 'utf8');
  assert.match(nav, /name="ClubHistory"/);
  assert.match(nav, /GuardedClubHistoryScreen/);
});

test('la tarjeta no ofrece destino a quien no es del club', () => {
  // Al partido de un encuentro entre clubes sólo entran sus integrantes (RLS
  // de la 44d): para el resto, el chevron prometía «este partido ya no está
  // disponible».
  const tarjeta = fs.readFileSync(
    path.join(RAIZ, 'src', 'components', 'club', 'MatchHistoryCard.js'),
    'utf8'
  );
  assert.match(tarjeta, /disabled=\{!onPress\}/);
  assert.match(tarjeta, /onPress \? <ChevronRight/);

  for (const pantalla of ['ClubDetailScreen.js', 'ClubHistoryScreen.js']) {
    const texto = fs.readFileSync(path.join(RAIZ, 'src', 'screens', pantalla), 'utf8');
    assert.match(
      texto,
      /soyIntegrante\s*\n?\s*\?\s*\(?\)?\s*=>?/,
      `${pantalla} navega al partido sin mirar si soy integrante`
    );
  }
});

test('un fallo de lectura no se disfraza de historial vacío', () => {
  for (const pantalla of ['ClubDetailScreen.js', 'ClubHistoryScreen.js']) {
    const texto = fs.readFileSync(path.join(RAIZ, 'src', 'screens', pantalla), 'utf8');
    assert.match(
      texto,
      /No se pudo cargar el historial/,
      `${pantalla} no distingue «no se pudo leer» de «no hay partidos»`
    );
    assert.match(texto, /Aún no hay partidos en el historial/);
  }
});

test('las estadísticas NO se derivan del historial cargado', () => {
  // El historial viaja paginado: sumar los goles de las filas que se
  // muestran daría un total falso en cuanto el club pase de 20 partidos. La
  // prueba fija el contrato: normalizar el historial no produce totales.
  const p = normalizarPartido(fila({ id: 'm11', golesLocal: 4, golesVisitante: 2 }), CLUB_A);
  assert.equal(p.pj, undefined);
  assert.equal(p.gf, undefined);
});

// ---------------------------------------------------------------------------
// 7. Caminos de error: «no se pudo leer» no es «no hay partidos»
// ---------------------------------------------------------------------------

test('sin la migración 49 el perfil se dibuja igual, con el historial vacío', async () => {
  await sinConsola(async () => {
    const cliente = clienteFalso({});
    const historial = await cargarHistorial(cliente, CLUB_A);
    const stats = await cargarEstadisticas(cliente, CLUB_A);

    assert.deepEqual(historial, { data: [], error: null });
    assert.deepEqual(stats, { data: { ...ESTADISTICAS_VACIAS }, error: null });
  });
});

test('cualquier otro error SÍ se devuelve: no se disfraza de historial vacío', async () => {
  await sinConsola(async () => {
    const cliente = clienteFalso({
      [HISTORIAL_RPC]: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }),
    });

    const { data, error } = await cargarHistorial(cliente, CLUB_A);
    assert.deepEqual(data, []);
    assert.equal(error.code, '42501');
  });
});

// ---------------------------------------------------------------------------
// 8. Las columnas existen, y los fixtures no
// ---------------------------------------------------------------------------

test('todas las columnas que consume la interfaz existen en la migración 49', () => {
  const sql = fs.readFileSync(MIGRACION, 'utf8');

  /**
   * Las columnas del `returns table` de una función.
   *
   * Se busca desde el `create or replace function` y no desde la primera
   * mención del nombre: las dos funciones se nombran también en la cabecera
   * del archivo, y arrancar ahí recortaba el bloque equivocado.
   */
  const declaradas = (funcion) => {
    const inicio = sql.indexOf(`create or replace function public.${funcion}`);
    assert.notEqual(inicio, -1, `la migración no crea ${funcion}`);
    const returns = sql.indexOf('returns table', inicio);
    const fin = sql.indexOf('language sql', returns);
    return sql
      .slice(returns, fin)
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((c) => /^[a-z_]+$/.test(c));
  };

  const historial = declaradas('historial_club');
  for (const columna of HISTORIAL_COLUMNAS) {
    assert.ok(historial.includes(columna), `historial_club() no declara la columna «${columna}»`);
  }

  const stats = declaradas('club_estadisticas');
  for (const columna of ESTADISTICAS_COLUMNAS) {
    assert.ok(stats.includes(columna), `club_estadisticas() no declara la columna «${columna}»`);
  }
});

test('club_estadisticas() reutiliza club_record() en vez de repetir su cálculo', () => {
  const sql = fs.readFileSync(MIGRACION, 'utf8');
  const cuerpo = sql.slice(sql.indexOf('create or replace function public.club_estadisticas'));
  assert.match(cuerpo, /public\.club_record\(p_club_id\)/);
});

test('no queda ningún fixture de historial en el código de producción', () => {
  const PROHIBIDOS = ['getDemoMatchHistory', 'usarHistorialDemo', 'DEMO_HISTORIAL'];
  const encontrados = [];

  const recorrer = (dir) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(completo);
      } else if (entrada.name.endsWith('.js') && completo !== __filename) {
        const texto = fs.readFileSync(completo, 'utf8');
        for (const símbolo of PROHIBIDOS) {
          if (texto.includes(símbolo)) encontrados.push(`${path.relative(RAIZ, completo)}: ${símbolo}`);
        }
      }
    }
  };
  recorrer(path.join(RAIZ, 'src'));

  assert.deepEqual(
    encontrados,
    [],
    `los fixtures del historial siguen vivos:\n${encontrados.join('\n')}`
  );
});

test('el servicio del historial no trae datos escritos a mano', () => {
  const servicio = fs.readFileSync(path.join(RAIZ, 'src', 'services', 'clubMatches.js'), 'utf8');

  // Los tres rivales de ejemplo que vivían en este archivo hasta la 6.2.
  for (const inventado of ['Deportivo Ñuñoa', 'Atlético Maipú', 'Los Cóndores']) {
    assert.equal(servicio.includes(inventado), false, `«${inventado}» sigue en el servicio`);
  }
  // Y todo lo que muestra pasa por las dos RPC de la 49.
  assert.match(servicio, /cargarHistorial/);
  assert.match(servicio, /cargarEstadisticas/);
});
