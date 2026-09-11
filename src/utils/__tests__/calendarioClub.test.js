const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calendarioDePartidos,
  agruparPorFecha,
  diasDelMes,
  nombreMes,
  mesDeFundacion,
  esMesAnteriorAFundacion,
} = require('../calendarioClub.js');

const CLUB_A = 'club-a';
const CLUB_B = 'club-b';
const CLUB_AJENO = 'club-ajeno';

function proximo({ id, local = CLUB_A, visitante = CLUB_B, hora, estado = 'publicado' }) {
  return {
    id,
    hora,
    estado,
    cancha_nombre: 'Cancha Test',
    comuna: 'Ñuñoa',
    club_local_id: local,
    club_visitante_id: visitante,
    club_local: { id: local, nombre: local === CLUB_A ? 'Club A' : 'Club B', foto_url: 'a.png' },
    club_visitante: { id: visitante, nombre: visitante === CLUB_A ? 'Club A' : 'Club B', foto_url: 'b.png' },
  };
}

function historial({
  id,
  fecha,
  esLocal = true,
  rivalNombre = 'Club B',
  resultado = 'V',
  resultadoNombre = 'Victoria',
  soyIntegrante = true,
  horaLabel = '21:00',
  canchaNombre = 'Cancha Test',
}) {
  return {
    id,
    fecha,
    esLocal,
    rivalNombre,
    rivalLogoUrl: 'b.png',
    resultado,
    resultadoNombre,
    miMarcador: 2,
    suMarcador: 1,
    horaLabel,
    canchaNombre,
    soyIntegrante,
  };
}

// --------------------------------------------------------------------------
// calendarioDePartidos: próximos
// --------------------------------------------------------------------------

test('un próximo partido como local trae al visitante como rival', () => {
  const [e] = calendarioDePartidos(
    { proximos: [proximo({ id: 'p1', hora: '2026-09-15T20:00:00-03:00' })] },
    CLUB_A
  );
  assert.equal(e.id, 'p1');
  assert.equal(e.jugado, false);
  assert.equal(e.esLocal, true);
  assert.equal(e.rivalNombre, 'Club B');
  assert.equal(e.resultado, null);
});

test('un próximo partido como visitante trae al local como rival', () => {
  const [e] = calendarioDePartidos(
    { proximos: [proximo({ id: 'p2', local: CLUB_B, visitante: CLUB_A, hora: '2026-09-15T20:00:00-03:00' })] },
    CLUB_A
  );
  assert.equal(e.esLocal, false);
  assert.equal(e.rivalNombre, 'Club B');
});

test('un próximo partido trae hora y lugar, y siempre se puede abrir', () => {
  const [e] = calendarioDePartidos(
    { proximos: [proximo({ id: 'p6', hora: '2026-09-15T20:00:00-03:00' })] },
    CLUB_A
  );
  assert.equal(e.horaLabel, '20:00');
  assert.equal(e.lugar, 'Cancha Test · Ñuñoa');
  assert.equal(e.soyIntegrante, true);
});

test('un partido del historial trae hora y cancha del normalizado, no inventadas', () => {
  const [e] = calendarioDePartidos(
    { historial: [historial({ id: 'h3', fecha: '2026-08-01', horaLabel: '18:30', canchaNombre: 'Cancha Roble' })] },
    CLUB_A
  );
  assert.equal(e.horaLabel, '18:30');
  assert.equal(e.lugar, 'Cancha Roble');
});

test('un partido del historial sin cancha (no integrante) no inventa un lugar', () => {
  const [e] = calendarioDePartidos(
    { historial: [historial({ id: 'h4', fecha: '2026-08-01', canchaNombre: null, soyIntegrante: false })] },
    CLUB_A
  );
  assert.equal(e.lugar, null);
  assert.equal(e.soyIntegrante, false);
});

test('un partido de un club ajeno no entra al calendario', () => {
  const entradas = calendarioDePartidos(
    { proximos: [proximo({ id: 'p3', hora: '2026-09-15T20:00:00-03:00' })] },
    CLUB_AJENO
  );
  assert.deepEqual(entradas, []);
});

test('un próximo partido sin hora se descarta en vez de reventar', () => {
  const entradas = calendarioDePartidos({ proximos: [proximo({ id: 'p4', hora: null })] }, CLUB_A);
  assert.deepEqual(entradas, []);
});

test('la fecha de un próximo partido usa la hora LOCAL, no UTC', () => {
  // 23:30 en Chile (UTC-3 en septiembre, horario de verano) sigue siendo el
  // mismo día — pero en UTC ya es el día siguiente. Si `fechaLocalISO` usara
  // `toISOString()` esta fecha se correría al 16.
  const [e] = calendarioDePartidos(
    { proximos: [proximo({ id: 'p5', hora: '2026-09-15T23:30:00-03:00' })] },
    CLUB_A
  );
  assert.equal(e.fecha, '2026-09-15');
});

// --------------------------------------------------------------------------
// calendarioDePartidos: historial
// --------------------------------------------------------------------------

test('un partido del historial se pasa casi sin tocar, con jugado:true', () => {
  const [e] = calendarioDePartidos(
    { historial: [historial({ id: 'h1', fecha: '2026-08-01' })] },
    CLUB_A
  );
  assert.equal(e.id, 'h1');
  assert.equal(e.jugado, true);
  assert.equal(e.fecha, '2026-08-01');
  assert.equal(e.resultado, 'V');
  assert.equal(e.miMarcador, 2);
  assert.equal(e.soyIntegrante, true);
});

test('un partido del historial sin fecha se descarta', () => {
  const entradas = calendarioDePartidos({ historial: [historial({ id: 'h2', fecha: null })] }, CLUB_A);
  assert.deepEqual(entradas, []);
});

// --------------------------------------------------------------------------
// calendarioDePartidos: combinación y orden
// --------------------------------------------------------------------------

test('próximos e historial se combinan y quedan ordenados de más antiguo a más nuevo', () => {
  const entradas = calendarioDePartidos(
    {
      proximos: [proximo({ id: 'futuro', hora: '2026-09-20T20:00:00-03:00' })],
      historial: [
        historial({ id: 'viejo', fecha: '2026-07-01' }),
        historial({ id: 'medio', fecha: '2026-08-15' }),
      ],
    },
    CLUB_A
  );
  assert.deepEqual(entradas.map((e) => e.id), ['viejo', 'medio', 'futuro']);
});

test('sin datos no revienta: listas vacías o ausentes dan un calendario vacío', () => {
  assert.deepEqual(calendarioDePartidos({}, CLUB_A), []);
  assert.deepEqual(calendarioDePartidos(undefined, CLUB_A), []);
  assert.deepEqual(calendarioDePartidos({ proximos: null, historial: null }, CLUB_A), []);
});

// --------------------------------------------------------------------------
// agruparPorFecha
// --------------------------------------------------------------------------

test('agruparPorFecha junta varios partidos del mismo día bajo una sola clave', () => {
  const entradas = calendarioDePartidos(
    {
      historial: [
        historial({ id: 'h1', fecha: '2026-08-01' }),
        historial({ id: 'h2', fecha: '2026-08-01' }),
        historial({ id: 'h3', fecha: '2026-08-02' }),
      ],
    },
    CLUB_A
  );
  const mapa = agruparPorFecha(entradas);
  assert.equal(mapa.size, 2);
  assert.equal(mapa.get('2026-08-01').length, 2);
  assert.equal(mapa.get('2026-08-02').length, 1);
  assert.equal(mapa.get('2026-08-03'), undefined);
});

// --------------------------------------------------------------------------
// diasDelMes
// --------------------------------------------------------------------------

/** Día de la semana (0=domingo…6=sábado) de un 'YYYY-MM-DD', en fecha LOCAL. */
function diaDeSemana(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

test('diasDelMes: la grilla de cada mes del año arranca en lunes y termina en domingo', () => {
  for (let mes = 1; mes <= 12; mes++) {
    const dias = diasDelMes(2026, mes);
    assert.equal(dias.length % 7, 0, `mes ${mes}: ${dias.length} días no es múltiplo de 7`);
    assert.equal(diaDeSemana(dias[0].fecha), 1, `mes ${mes}: no arranca en lunes`);
    assert.equal(diaDeSemana(dias.at(-1).fecha), 0, `mes ${mes}: no termina en domingo`);
  }
});

test('diasDelMes: todos los días reales del mes aparecen una vez, en orden, marcados enMes', () => {
  const dias = diasDelMes(2026, 9); // septiembre tiene 30 días
  const delMes = dias.filter((d) => d.enMes);
  assert.equal(delMes.length, 30);
  assert.deepEqual(delMes.map((d) => d.dia), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.ok(delMes.every((d) => d.fecha.startsWith('2026-09-')));
});

test('diasDelMes: los días de relleno son de los meses vecinos, marcados enMes:false', () => {
  const dias = diasDelMes(2026, 9);
  const relleno = dias.filter((d) => !d.enMes);
  for (const d of relleno) {
    assert.ok(
      d.fecha.startsWith('2026-08-') || d.fecha.startsWith('2026-10-'),
      `día de relleno inesperado: ${d.fecha}`
    );
  }
});

test('diasDelMes: sin huecos ni repetidos, un día calendario tras otro', () => {
  const dias = diasDelMes(2026, 2); // febrero: buen caso porque es corto
  const comoDate = (fechaISO) => {
    const [y, m, d] = fechaISO.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  for (let i = 1; i < dias.length; i++) {
    const esperado = comoDate(dias[i - 1].fecha);
    esperado.setDate(esperado.getDate() + 1);
    assert.equal(comoDate(dias[i].fecha).getTime(), esperado.getTime(), `hueco/salto entre ${dias[i - 1].fecha} y ${dias[i].fecha}`);
  }
  const fechas = dias.map((d) => d.fecha);
  assert.equal(new Set(fechas).size, fechas.length, 'hay fechas repetidas en la grilla');
});

test('diasDelMes: funciona igual en diciembre/enero, cruzando de año', () => {
  const dic = diasDelMes(2026, 12);
  const relleno = dic.filter((d) => !d.enMes);
  for (const d of relleno) {
    assert.ok(
      d.fecha.startsWith('2026-11-') || d.fecha.startsWith('2027-01-'),
      `diciembre: día de relleno inesperado ${d.fecha}`
    );
  }
});

// --------------------------------------------------------------------------
// nombreMes
// --------------------------------------------------------------------------

test('nombreMes devuelve el nombre en español con mayúscula inicial', () => {
  assert.equal(nombreMes(2026, 9), 'Septiembre');
  assert.equal(nombreMes(2026, 1), 'Enero');
  assert.equal(nombreMes(2026, 12), 'Diciembre');
});

// --------------------------------------------------------------------------
// mesDeFundacion / esMesAnteriorAFundacion
// --------------------------------------------------------------------------

test('mesDeFundacion lee el año y mes de created_at', () => {
  assert.deepEqual(mesDeFundacion('2026-03-15T12:00:00-03:00'), { anio: 2026, mes: 3 });
  assert.deepEqual(mesDeFundacion(new Date(2025, 0, 1)), { anio: 2025, mes: 1 });
});

test('mesDeFundacion sin fecha válida no revienta: devuelve null', () => {
  assert.equal(mesDeFundacion(null), null);
  assert.equal(mesDeFundacion('no es una fecha'), null);
  assert.equal(mesDeFundacion(undefined), null);
});

test('esMesAnteriorAFundacion sólo bloquea meses estrictamente anteriores', () => {
  const fundacion = { anio: 2026, mes: 3 };
  assert.equal(esMesAnteriorAFundacion(2026, 2, fundacion), true);
  assert.equal(esMesAnteriorAFundacion(2025, 12, fundacion), true);
  assert.equal(esMesAnteriorAFundacion(2026, 3, fundacion), false); // el mismo mes SÍ se puede ver
  assert.equal(esMesAnteriorAFundacion(2026, 4, fundacion), false);
});

test('esMesAnteriorAFundacion sin fecha de fundación no bloquea nada', () => {
  assert.equal(esMesAnteriorAFundacion(2000, 1, null), false);
});
