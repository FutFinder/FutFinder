const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../clubMatchRules.js');

/**
 * Reglas de presentación del partido de clubes.
 *
 * Lo que de verdad se protege acá:
 *   - Los cupos NO son compartidos. Un partido de 9 por club tiene
 *     `cupos_totales = 18`, y decir «18 de 18 cupos» hace creer que
 *     cualquiera puede tomar cualquiera de los 18. Cada club tiene los suyos.
 *   - La dirección exacta es de los integrantes de los dos clubes. Un tercero
 *     ve el partido, pero no dónde es.
 *   - Un partido normal no puede cambiar de aspecto ni de textos por esto.
 */

const CLUB_A = { id: 'club-a', nombre: 'Deportivo Ñuñoa', foto_url: 'https://x/a.png' };
const CLUB_B = { id: 'club-b', nombre: 'Atlético Macul', foto_url: 'https://x/b.png' };

function partidoDeClubes(extra = {}) {
  return {
    id: 'm-clubes',
    titulo: 'Deportivo Ñuñoa vs Atlético Macul',
    hora: '2026-09-05T23:00:00.000Z',
    cancha_nombre: 'Complejo Ñuñoa',
    // Tras la migración 44b, en `matches` no hay calle y las coordenadas son
    // la aproximación pública. La exacta vive en `club_match_locations`.
    direccion: null,
    latitud: -33.46,
    longitud: -70.6,
    ubicacion_aproximada: true,
    comuna: 'Ñuñoa',
    region: 'Metropolitana',
    cupos_totales: 18,
    cupos_disponibles: 18,
    cupos_por_club: 9,
    metodo_inscripcion: 'orden_llegada',
    club_local_id: 'club-a',
    club_visitante_id: 'club-b',
    challenge_id: 'ch-1',
    challenge_proposal_id: 'prop-1',
    club_local: CLUB_A,
    club_visitante: CLUB_B,
    ...extra,
  };
}

function partidoNormal(extra = {}) {
  return {
    id: 'm-normal',
    titulo: 'Pichanga del jueves',
    hora: '2026-09-05T23:00:00.000Z',
    cancha_nombre: 'Cancha del barrio',
    direccion: 'Providencia 123',
    comuna: 'Providencia',
    cupos_totales: 10,
    cupos_disponibles: 4,
    ...extra,
  };
}

// ── qué es un partido de clubes ───────────────────────────────

test('un partido con los dos clubes es de clubes; uno normal no', () => {
  assert.equal(R.esPartidoDeClubes(partidoDeClubes()), true);
  assert.equal(R.esPartidoDeClubes(partidoNormal()), false);
  assert.equal(R.esPartidoDeClubes(null), false);
  assert.equal(R.esPartidoDeClubes({}), false);
});

test('un partido con un solo club no cuenta: no hay VS que dibujar', () => {
  assert.equal(R.esPartidoDeClubes(partidoDeClubes({ club_visitante_id: null })), false);
  assert.equal(R.esPartidoDeClubes(partidoDeClubes({ club_local_id: null })), false);
});

// ── de qué lado estoy ─────────────────────────────────────────

test('reconoce si soy del club local, del visitante o de ninguno', () => {
  const m = partidoDeClubes();
  assert.equal(R.miLadoEnPartido(m, ['club-a']), 'local');
  assert.equal(R.miLadoEnPartido(m, ['club-b']), 'visitante');
  assert.equal(R.miLadoEnPartido(m, ['club-z']), null);
  assert.equal(R.miLadoEnPartido(m, []), null);
  assert.equal(R.miLadoEnPartido(m, null), null);
});

test('en un partido normal no hay lado, aunque pertenezca a clubes', () => {
  assert.equal(R.miLadoEnPartido(partidoNormal(), ['club-a']), null);
});

// ── cupos: el corazón de U2 ───────────────────────────────────

test('un integrante ve los cupos DE SU CLUB, no el total compartido', () => {
  const m = partidoDeClubes();
  assert.equal(R.cuposLabel(m, ['club-a']), '9 cupos para tu club');
  assert.equal(R.cuposLabel(m, ['club-b']), '9 cupos para tu club');
});

test('un usuario ajeno ve cuántos cupos tiene cada club', () => {
  assert.equal(R.cuposLabel(partidoDeClubes(), []), '9 cupos por club');
  assert.equal(R.cuposLabel(partidoDeClubes(), ['club-z']), '9 cupos por club');
});

test('NUNCA se muestra el total como si fuera compartido', () => {
  for (const misClubes of [[], ['club-a'], ['club-b'], ['club-z']]) {
    const label = R.cuposLabel(partidoDeClubes(), misClubes);
    assert.doesNotMatch(label, /18/, `«${label}» no puede mencionar el total de 18`);
    assert.doesNotMatch(label, / de /, `«${label}» no puede sugerir un conteo compartido`);
  }
});

test('el número sale de cupos_por_club, no de dividir el total', () => {
  // Si algún día el total dejara de ser exactamente el doble, mandaría el
  // valor real de la columna y no una división inventada.
  const raro = partidoDeClubes({ cupos_por_club: 7, cupos_totales: 18 });
  assert.equal(R.cuposLabel(raro, ['club-a']), '7 cupos para tu club');
});

test('un partido normal conserva su etiqueta de siempre', () => {
  assert.equal(R.cuposLabel(partidoNormal(), []), '4 de 10 cupos');
  assert.equal(R.cuposLabel(partidoNormal({ cupos_disponibles: 0 }), []), 'Sin cupos');
});

test('un partido de clubes del flujo antiguo, sin cupos_por_club, cae en la etiqueta normal', () => {
  // Los partidos creados antes de la migración 44 tienen los dos clubes pero
  // no reparto por club. Inventarles un número sería mentir.
  const viejo = partidoDeClubes({
    challenge_proposal_id: null,
    cupos_por_club: null,
    cupos_disponibles: 6,
    cupos_totales: 14,
  });
  assert.equal(R.cuposLabel(viejo, ['club-a']), '6 de 14 cupos');
});

test('usaNominaPorClub sólo activa la ruta U3 en partidos nacidos de una propuesta con cupos por club', () => {
  assert.equal(R.usaNominaPorClub(partidoDeClubes()), true);
  assert.equal(
    R.usaNominaPorClub(partidoDeClubes({ challenge_proposal_id: null })),
    false,
    'el flujo antiguo de clubes conserva su CTA anterior'
  );
  assert.equal(
    R.usaNominaPorClub(partidoDeClubes({ cupos_por_club: null })),
    false,
    'sin reparto por club no se promete una nómina U3'
  );
  assert.equal(R.usaNominaPorClub({ id: 'normal', cupos_por_club: 9 }), false);
});

test('sin cargar el conteo real de inscritos por club no se simula un numerador', () => {
  // U3 puede entregar «3 de 9» cuando la nómina está cargada. Sin ese dato,
  // esta etiqueta no inventa un cero ni un conteo a partir del total global.
  const label = R.cuposLabel(partidoDeClubes(), ['club-a']);
  assert.equal(label, '9 cupos para tu club');
  assert.doesNotMatch(label, /inscrit/i);
});

// ── privacidad de la dirección ────────────────────────────────

test('la dirección exacta la ve un integrante de cualquiera de los dos clubes', () => {
  const m = partidoDeClubes();
  assert.equal(R.puedeVerDireccion(m, ['club-a']), true);
  assert.equal(R.puedeVerDireccion(m, ['club-b']), true);
});

test('un usuario ajeno NO ve la dirección exacta del partido de clubes', () => {
  const m = partidoDeClubes();
  assert.equal(R.puedeVerDireccion(m, []), false);
  assert.equal(R.puedeVerDireccion(m, ['club-z']), false);
  assert.equal(R.puedeVerDireccion(m, null), false);
});

test('en un partido normal la dirección se ve como siempre', () => {
  assert.equal(R.puedeVerDireccion(partidoNormal(), []), true);
});

test('la ubicación protegida se reconoce por challenge_proposal_id, no por tener dos clubes', () => {
  // Es el MISMO predicado que usa la migración 44b para decidir qué partidos
  // guardan su ubicación en `club_match_locations`. Si la interfaz usara otro,
  // diría una cosa y la base otra.
  assert.equal(R.esUbicacionProtegida(partidoDeClubes()), true);
  assert.equal(R.esUbicacionProtegida(partidoNormal()), false);
  assert.equal(R.esUbicacionProtegida(null), false);
});

test('el partido de clubes del flujo antiguo NO tiene ubicación protegida', () => {
  // Nunca pasó por una propuesta protegida: su dirección siempre fue pública,
  // también en la base. Esconderla sólo en pantalla sería la incoherencia que
  // esto viene a cerrar.
  const viejo = partidoDeClubes({ challenge_proposal_id: null });
  assert.equal(R.esUbicacionProtegida(viejo), false);
  assert.equal(R.puedeVerDireccion(viejo, []), true, 'un ajeno la sigue viendo, como siempre');
  assert.equal(R.esPartidoDeClubes(viejo), true, 'pero sigue mereciendo la tarjeta de clubes');
});

test('en la lista, el partido de clubes no muestra calle a nadie: no la tiene', () => {
  // La calle no viaja en `matches`. En una lista tampoco se pide la protegida
  // —sería una consulta por tarjeta—, así que el texto es el mismo para todos.
  const m = partidoDeClubes();
  assert.equal(R.lugarLabel(m, ['club-a']), 'Complejo Ñuñoa · Ñuñoa');
  assert.equal(R.lugarLabel(m, []), 'Complejo Ñuñoa · Ñuñoa');
});

test('si la calle llega por la ubicación protegida, se muestra a quien corresponde', () => {
  // Es lo que hace el detalle: fusiona la protegida y vuelve a preguntar.
  const conCalle = { ...partidoDeClubes(), direccion: 'Av. Grecia 3401' };
  assert.equal(R.lugarLabel(conCalle, ['club-a']), 'Complejo Ñuñoa · Av. Grecia 3401 · Ñuñoa');
  assert.equal(R.lugarLabel(conCalle, []), 'Complejo Ñuñoa · Ñuñoa');
  assert.doesNotMatch(R.lugarLabel(conCalle, []), /Grecia/);
});

test('la aproximación se reconoce por la marca de la base, no por adivinarla', () => {
  assert.equal(R.esUbicacionAproximada(partidoDeClubes()), true);
  assert.equal(R.esUbicacionAproximada(partidoNormal()), false);
  assert.equal(R.esUbicacionAproximada(null), false);
});

test('el partido de clubes CONSERVA coordenadas públicas: por eso se puede descubrir', () => {
  // Si fueran nulas, desaparecería del mapa, del cuadrante y del filtro por
  // distancia, que es justo lo que no se quiere.
  const m = partidoDeClubes();
  assert.equal(typeof m.latitud, 'number');
  assert.equal(typeof m.longitud, 'number');
});

// ── los dos clubes, para pintarlos ────────────────────────────

test('devuelve los dos clubes con nombre y escudo', () => {
  const { local, visitante } = R.clubesDelPartido(partidoDeClubes());
  assert.equal(local.nombre, 'Deportivo Ñuñoa');
  assert.equal(local.fotoUrl, 'https://x/a.png');
  assert.equal(visitante.nombre, 'Atlético Macul');
  assert.equal(visitante.fotoUrl, 'https://x/b.png');
});

test('un club sin escudo entrega iniciales para dibujar en su lugar', () => {
  const m = partidoDeClubes({ club_local: { ...CLUB_A, foto_url: null } });
  const { local } = R.clubesDelPartido(m);
  assert.equal(local.fotoUrl, null);
  assert.equal(local.iniciales, 'DÑ');
});

test('un club sin datos no revienta ni deja el nombre vacío', () => {
  const { local, visitante } = R.clubesDelPartido(
    partidoDeClubes({ club_local: null, club_visitante: undefined })
  );
  assert.equal(local.nombre, 'Club local');
  assert.equal(visitante.nombre, 'Club visitante');
  assert.equal(local.fotoUrl, null);
  assert.ok(local.iniciales.length > 0);
});

test('las iniciales toman una letra por palabra, hasta dos, y saltan las partículas', () => {
  assert.equal(R.iniciales('Deportivo Ñuñoa'), 'DÑ');
  assert.equal(R.iniciales('Club Deportivo de los Andes'), 'CD');
  assert.equal(R.iniciales('Macul'), 'MA');
  assert.equal(R.iniciales('   '), 'FF');
  assert.equal(R.iniciales(null), 'FF');
});

test('un nombre larguísimo se entrega entero: recortar es cosa de la tarjeta', () => {
  const largo = 'Club Social Deportivo y Cultural Estrella Roja de Peñalolén Alto';
  const { local } = R.clubesDelPartido(partidoDeClubes({ club_local: { nombre: largo } }));
  assert.equal(local.nombre, largo);
});

// ── la sección de Inicio ──────────────────────────────────────

const AHORA = new Date('2026-09-01T12:00:00.000Z');

function conHora(id, iso, extra = {}) {
  return partidoDeClubes({ id, hora: iso, ...extra });
}

test('elige el próximo partido de clubes de alguno de mis clubes', () => {
  const lista = [
    conHora('m3', '2026-09-10T20:00:00.000Z'),
    conHora('m1', '2026-09-03T20:00:00.000Z'),
    conHora('m2', '2026-09-07T20:00:00.000Z'),
  ];
  const elegido = R.proximoPartidoDeClub(lista, ['club-a'], { ahora: AHORA });
  assert.equal(elegido.id, 'm1', 'tiene que ser el más próximo, no el primero de la lista');
});

test('a quien no pertenece a ninguno de los dos clubes no le toca sección', () => {
  const lista = [conHora('m1', '2026-09-03T20:00:00.000Z')];
  assert.equal(R.proximoPartidoDeClub(lista, ['club-z'], { ahora: AHORA }), null);
  assert.equal(R.proximoPartidoDeClub(lista, [], { ahora: AHORA }), null);
});

test('los partidos ya pasados no cuentan como próximos', () => {
  const lista = [conHora('m1', '2026-08-20T20:00:00.000Z')];
  assert.equal(R.proximoPartidoDeClub(lista, ['club-a'], { ahora: AHORA }), null);
});

test('un partido cancelado no se ofrece como el próximo', () => {
  const lista = [
    conHora('m1', '2026-09-03T20:00:00.000Z', { estado: 'cancelado' }),
    conHora('m2', '2026-09-08T20:00:00.000Z'),
  ];
  assert.equal(R.proximoPartidoDeClub(lista, ['club-a'], { ahora: AHORA }).id, 'm2');
});

test('un partido normal nunca entra en esta sección, aunque sea el más próximo', () => {
  const lista = [
    { ...partidoNormal(), id: 'n1', hora: '2026-09-02T20:00:00.000Z' },
    conHora('m1', '2026-09-05T20:00:00.000Z'),
  ];
  assert.equal(R.proximoPartidoDeClub(lista, ['club-a'], { ahora: AHORA }).id, 'm1');
});

// ── el reparto de Inicio: destacado + resto, sin repetir ──────

test('SIN DUPLICADOS: el partido que sube a destacado se quita de la lista de cercanos', () => {
  const club = conHora('m1', '2026-09-03T20:00:00.000Z');
  const normal = { ...partidoNormal(), id: 'n1', hora: '2026-09-04T20:00:00.000Z' };
  const { destacado, resto } = R.seleccionInicio([club, normal], [club, normal], ['club-a'], {
    ahora: AHORA,
  });

  assert.equal(destacado.id, 'm1');
  assert.deepEqual(resto.map((m) => m.id), ['n1'], 'm1 no puede salir dos veces en la misma pantalla');
});

test('un partido de clubes que se juega LEJOS igual se destaca', () => {
  // `cercanos` viene filtrado por radio; `todos` no. El partido de mi club me
  // importa aunque me quede lejos: es de mi club.
  const lejano = conHora('m1', '2026-09-03T20:00:00.000Z');
  const { destacado, resto } = R.seleccionInicio([lejano], [], ['club-a'], { ahora: AHORA });
  assert.equal(destacado.id, 'm1');
  assert.deepEqual(resto, []);
});

test('sin partido de club, el destacado es null y la lista de cercanos queda intacta', () => {
  const cercanos = [{ ...partidoNormal(), id: 'n1' }, { ...partidoNormal(), id: 'n2' }];
  const { destacado, resto } = R.seleccionInicio(cercanos, cercanos, ['club-a'], { ahora: AHORA });
  assert.equal(destacado, null, 'ESTADO VACÍO: no hay sección que dibujar');
  assert.deepEqual(resto.map((m) => m.id), ['n1', 'n2']);
});

test('a un usuario sin clubes no se le destaca nada y no se le quita nada', () => {
  const club = conHora('m1', '2026-09-03T20:00:00.000Z');
  const { destacado, resto } = R.seleccionInicio([club], [club], [], { ahora: AHORA });
  assert.equal(destacado, null);
  assert.deepEqual(resto.map((m) => m.id), ['m1'], 'lo sigue viendo, pero como un partido más');
});

test('seleccionInicio aguanta listas ausentes', () => {
  const { destacado, resto } = R.seleccionInicio(null, null, ['club-a'], { ahora: AHORA });
  assert.equal(destacado, null);
  assert.deepEqual(resto, []);
});

test('sin partidos, sin lista o con entradas basura devuelve null, no revienta', () => {
  assert.equal(R.proximoPartidoDeClub([], ['club-a'], { ahora: AHORA }), null);
  assert.equal(R.proximoPartidoDeClub(null, ['club-a'], { ahora: AHORA }), null);
  assert.equal(R.proximoPartidoDeClub([null, undefined], ['club-a'], { ahora: AHORA }), null);
});

test('sirve para los dos clubes: el rival ve el mismo partido en su Inicio', () => {
  const lista = [conHora('m1', '2026-09-03T20:00:00.000Z')];
  assert.equal(R.proximoPartidoDeClub(lista, ['club-b'], { ahora: AHORA }).id, 'm1');
});

// ─────────────────────────────────────────────────────── Nómina por club
//
// El conteo por club es la regla entera de U3. Lo que se fija acá:
//   - `pendiente` NO ocupa cupo, ni en la base ni en pantalla.
//   - lo del club A no le quita nada al club B.
//   - la interfaz no ofrece un botón que la RPC vaya a rechazar.

function nomina() {
  return [
    { id: '1', id_jugador: 'u1', club_id: 'club-a', estado: 'inscrito', origen: 'orden_llegada' },
    { id: '2', id_jugador: 'u2', club_id: 'club-a', estado: 'confirmado_gps', origen: 'orden_llegada' },
    { id: '3', id_jugador: 'u3', club_id: 'club-a', estado: 'pendiente', origen: 'postulacion' },
    { id: '4', id_jugador: 'u4', club_id: 'club-b', estado: 'inscrito', origen: 'reserva_aprobador' },
  ];
}

test('resumenNomina: `pendiente` no ocupa cupo', () => {
  const r = R.resumenNomina(nomina(), 'club-a', 9);
  assert.equal(r.inscritos, 2, 'inscrito + confirmado_gps');
  assert.equal(r.pendientes, 1);
  assert.equal(r.disponibles, 7, 'la postulación no reserva');
});

test('resumenNomina: cada club cuenta lo suyo', () => {
  assert.equal(R.resumenNomina(nomina(), 'club-b', 9).inscritos, 1);
  assert.equal(R.resumenNomina(nomina(), 'club-b', 9).disponibles, 8);
  // Que el club A tenga gente no le quita cupos al club B, ni al revés.
  assert.equal(R.resumenNomina(nomina(), 'club-a', 9).disponibles, 7);
});

test('resumenNomina: nunca devuelve cupos negativos', () => {
  const llena = Array.from({ length: 12 }, (_, i) => ({
    id: String(i), id_jugador: `x${i}`, club_id: 'club-a', estado: 'inscrito',
  }));
  assert.equal(R.resumenNomina(llena, 'club-a', 9).disponibles, 0);
});

test('cuposLabel: con el conteo real dice el numerador; sin él, no lo inventa', () => {
  const m = partidoDeClubes();
  assert.equal(
    R.cuposLabel(m, ['club-a'], { inscritosDeMiClub: 3 }),
    '3 de 9 inscritos de tu club'
  );
  // Cero es un número que se sabe: es distinto de no saberlo.
  assert.equal(
    R.cuposLabel(m, ['club-a'], { inscritosDeMiClub: 0 }),
    '0 de 9 inscritos de tu club'
  );
  assert.equal(R.cuposLabel(m, ['club-a']), '9 cupos para tu club');
  assert.equal(R.cuposLabel(m, ['club-a'], { inscritosDeMiClub: null }), '9 cupos para tu club');
});

test('cuposLabel: a un ajeno no se le dice cómo va la nómina', () => {
  assert.equal(R.cuposLabel(partidoDeClubes(), ['club-z'], { inscritosDeMiClub: 3 }), '9 cupos por club');
});

test('accionNomina: orden de llegada ofrece inscribirse; selección administrativa, postular', () => {
  const base = { match: partidoDeClubes(), misClubIds: ['club-a'], miFila: null,
    resumen: R.resumenNomina(nomina(), 'club-a', 9), ahora: new Date('2026-09-01T00:00:00Z') };
  assert.equal(R.accionNomina(base).accion, 'inscribirse');
  assert.equal(
    R.accionNomina({ ...base, match: partidoDeClubes({ metodo_inscripcion: 'seleccion_admin' }) }).accion,
    'postular'
  );
});

test('accionNomina: quien ya está sale; quien postuló retira', () => {
  const base = { match: partidoDeClubes(), misClubIds: ['club-a'],
    resumen: R.resumenNomina(nomina(), 'club-a', 9), ahora: new Date('2026-09-01T00:00:00Z') };
  assert.equal(R.accionNomina({ ...base, miFila: { estado: 'inscrito' } }).accion, 'salir');
  assert.equal(R.accionNomina({ ...base, miFila: { estado: 'confirmado_gps' } }).accion, 'salir');
  assert.equal(
    R.accionNomina({ ...base, miFila: { estado: 'pendiente' } }).accion,
    'cancelar_postulacion'
  );
});

test('accionNomina: sin cupo no se ofrece inscribirse, pero sí postular', () => {
  const lleno = { inscritos: 9, pendientes: 0, disponibles: 0, cupos: 9 };
  const base = { misClubIds: ['club-a'], miFila: null, resumen: lleno,
    ahora: new Date('2026-09-01T00:00:00Z') };
  assert.equal(R.accionNomina({ ...base, match: partidoDeClubes() }).accion, 'ninguna');
  // En selección administrativa postular NO reserva, así que el club lleno no
  // impide postular: el límite lo aplica el administrador al confirmar.
  assert.equal(
    R.accionNomina({ ...base, match: partidoDeClubes({ metodo_inscripcion: 'seleccion_admin' }) }).accion,
    'postular'
  );
});

test('accionNomina: un ajeno, un partido empezado y uno cancelado no ofrecen nada', () => {
  const resumen = R.resumenNomina(nomina(), 'club-a', 9);
  const ahora = new Date('2026-09-01T00:00:00Z');
  assert.equal(
    R.accionNomina({ match: partidoDeClubes(), misClubIds: ['club-z'], miFila: null, resumen, ahora }).accion,
    'ninguna'
  );
  assert.equal(
    R.accionNomina({ match: partidoDeClubes(), misClubIds: ['club-a'], miFila: null, resumen,
      ahora: new Date('2026-09-06T00:00:00Z') }).accion,
    'ninguna'
  );
  assert.equal(
    R.accionNomina({ match: partidoDeClubes({ estado: 'cancelado' }), misClubIds: ['club-a'],
      miFila: null, resumen, ahora }).accion,
    'ninguna'
  );
});

test('accionNomina: cuando no hay acción, siempre explica por qué', () => {
  const casos = [
    { match: null },
    { match: partidoDeClubes({ estado: 'cancelado' }), misClubIds: ['club-a'] },
    { match: partidoDeClubes(), misClubIds: ['club-z'] },
  ];
  for (const c of casos) {
    const r = R.accionNomina({ ahora: new Date('2026-09-01T00:00:00Z'), ...c });
    assert.equal(r.accion, 'ninguna');
    assert.ok(r.motivo && r.motivo.length > 0, 'un botón que no está tiene que decir por qué');
  }
});

test('miFilaEnNomina: encuentra la mía y sólo la mía', () => {
  assert.equal(R.miFilaEnNomina(nomina(), 'u3').estado, 'pendiente');
  assert.equal(R.miFilaEnNomina(nomina(), 'nadie'), null);
  assert.equal(R.miFilaEnNomina(nomina(), null), null);
});

test('puedoConfirmarNomina: administrar el club RIVAL no da ningún derecho', () => {
  assert.equal(R.puedoConfirmarNomina('club-a', ['club-a']), true);
  assert.equal(R.puedoConfirmarNomina('club-a', ['club-b']), false);
  assert.equal(R.puedoConfirmarNomina('club-a', []), false);
  assert.equal(R.puedoConfirmarNomina(null, ['club-a']), false);
});

test('ACCION_LABEL: toda acción posible tiene texto', () => {
  for (const a of ['inscribirse', 'postular', 'salir', 'cancelar_postulacion']) {
    assert.ok(R.ACCION_LABEL[a], `falta la etiqueta de ${a}`);
  }
});
