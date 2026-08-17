/**
 * Prueba de regresión del expediente de sanciones con DOS sesiones abiertas.
 *
 * EL FALLO QUE REPRODUCE, encontrado en la comprobación manual de la 5.2 el
 * 2026-08-17. El hilo del desafío leía las sanciones, los informes de
 * incomparecencia y las revisiones UNA sola vez, al montar, y las volvía a
 * pedir sólo después de una acción PROPIA. El sondeo de 15 segundos —la única
 * vía, porque ninguna de esas tablas está en la publicación
 * `supabase_realtime`— refrescaba nada más la bitácora y la solicitud de
 * cambio, con un comentario que decía que la sanción no entraba «a propósito».
 *
 * Esa decisión valía para la 47, donde una sanción sobre MI club sólo podía
 * nacer de que mi propio club cancelara algo. La 47c la invalidó: informar una
 * incomparecencia deja una sanción provisional sobre el club CONTRARIO, así
 * que la sanción de mi club la crea la sesión del rival y mi sesión no se
 * entera. Comprobado a mano: después de la acusación cruzada, la sesión de
 * P51-A no mostraba «Solicitar revisión» hasta recargar la página.
 *
 * CÓMO SE PRUEBA. Con las MISMAS funciones que usa la pantalla y sus valores
 * por defecto: los cargadores reales de `expedienteSancion.js` (los que el
 * servicio `clubSanctions.js` ata al cliente de Supabase), el sondeo real de
 * `sondeo.js` con su intervalo por defecto, y `accionesDeRevision()` tal como
 * la llama `ChatThreadScreen`. Lo único falso es el transporte: un cliente con
 * la forma de PostgREST sobre una base en memoria, con la RLS de la 47c
 * aplicada a mano.
 *
 * LA SANCIÓN NO SE INYECTA EN LA PANTALLA. Se escribe en la base falsa, que es
 * lo que hace el servidor al informar la incomparecencia, y tiene que llegar
 * hasta el botón por el mismo camino que en producción. Pasarla a mano a
 * `accionesDeRevision()` probaría la función que nunca estuvo rota.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  EXPEDIENTE_VACIO,
  refrescarExpediente,
} = require('../expedienteSancion.js');
const { accionesDeRevision, accionesDeIncomparecencia } = require('../revisionSancion.js');
const { crearSondeo } = require('../sondeo.js');

// ---------------------------------------------------------------------------
// El expediente real de la comprobación manual, con sus identificadores.
// ---------------------------------------------------------------------------

const CLUB_A = '11111111-1111-4111-8111-111111111111';
const CLUB_C = '22222222-2222-4222-8222-222222222222';
const DESAFIO = '33333333-3333-4333-8333-333333333333';
const PARTIDO = '44444444-4444-4444-8444-444444444444';

/** Las dos sanciones provisionales que hoy están vivas en producción. */
const SANCION_DE_A = '4c169a9a-47d9-471b-932b-3856290cfc63';
const SANCION_DE_C = 'c1e94b25-c147-4c59-830d-fc73a7944563';

/** El desafío tal como lo devuelve `getChallenge`: en juego, sin congelar. */
const DESAFIO_EN_JUEGO = {
  id: DESAFIO,
  estado: 'en_juego',
  club_retador_id: CLUB_A,
  club_retado_id: CLUB_C,
  match_id: PARTIDO,
};

/** El partido publicado, ya jugado. `challenge_proposal_id` es lo que lo hace de clubes. */
const PARTIDO_JUGADO = {
  id: PARTIDO,
  challenge_proposal_id: '55555555-5555-4555-8555-555555555555',
  estado: 'en_curso',
  hora: '2026-08-16T22:00:00.000Z',
};

const AHORA = new Date('2026-08-17T01:00:00.000Z');

// ---------------------------------------------------------------------------
// El transporte falso
// ---------------------------------------------------------------------------

function baseVacia() {
  return {
    club_sanctions: [],
    club_match_noshow_reports: [],
    club_sanction_reviews: [],
  };
}

/**
 * Lo que hace `reportar_incomparecencia()` en el servidor, reducido a sus dos
 * escrituras: la sanción PROVISIONAL sobre el club acusado y el informe.
 *
 * Va acá y no en la pantalla a propósito: el fallo era que la sesión rival no
 * veía estas dos filas, así que tienen que aparecer en la base y llegar solas.
 */
function informarIncomparecencia(db, { reportante, reportado, sancionId, motivo, creadoEn }) {
  db.club_sanctions.push({
    id: sancionId,
    club_id: reportado,
    challenge_id: DESAFIO,
    match_id: PARTIDO,
    tipo: 'incomparecencia',
    motivo,
    inicio_at: creadoEn,
    fin_at: '2026-08-31T01:00:00.000Z',
    estado: 'provisional',
    created_at: creadoEn,
  });
  db.club_match_noshow_reports.push({
    id: `informe:${reportante}`,
    challenge_id: DESAFIO,
    match_id: PARTIDO,
    club_reportante_id: reportante,
    club_reportado_id: reportado,
    motivo,
    sancion_id: sancionId,
    created_at: creadoEn,
  });
}

/**
 * Cliente con la forma de PostgREST y la RLS de la 47c aplicada a mano:
 * `club_sanctions` y `club_sanction_reviews` sólo muestran las filas del club
 * de quien consulta; el informe lo leen los dos clubes del encuentro, porque
 * al acusado hay que decirle de qué se le acusa.
 *
 * `lecturas` cuenta las consultas para poder afirmar que el sondeo no las
 * apila, y `fallar` simula un corte de red.
 */
function clienteDe(db, { clubesDelUsuario }) {
  const estado = { lecturas: 0, fallar: false };

  const cliente = {
    from(tabla) {
      let filas = [...(db[tabla] || [])];
      if (tabla === 'club_sanctions' || tabla === 'club_sanction_reviews') {
        filas = filas.filter((f) => clubesDelUsuario.includes(f.club_id));
      } else if (tabla === 'club_match_noshow_reports') {
        filas = filas.filter(
          (f) => clubesDelUsuario.includes(f.club_reportante_id)
            || clubesDelUsuario.includes(f.club_reportado_id)
        );
      }

      const q = {
        select() { return q; },
        eq(col, val) { filas = filas.filter((f) => f[col] === val); return q; },
        in(col, vals) { filas = filas.filter((f) => vals.includes(f[col])); return q; },
        order(col, { ascending = true } = {}) {
          filas.sort((a, b) => {
            const d = new Date(a[col]).getTime() - new Date(b[col]).getTime();
            return ascending ? d : -d;
          });
          return q;
        },
        then(resolver, rechazar) {
          estado.lecturas += 1;
          const respuesta = estado.fallar
            ? { data: null, error: { message: 'Network request failed' } }
            : { data: filas, error: null };
          return Promise.resolve(respuesta).then(resolver, rechazar);
        },
      };
      return q;
    },
  };

  return { cliente, estado };
}

/**
 * Una sesión abierta en el hilo: mantiene su expediente como lo mantiene la
 * pantalla y lo refresca con la misma función.
 */
function sesion(db, { clubesAdmin }) {
  const { cliente, estado } = clienteDe(db, { clubesDelUsuario: clubesAdmin });
  let expediente = EXPEDIENTE_VACIO;
  let cambios = 0;

  return {
    estado,
    get expediente() { return expediente; },
    get cambios() { return cambios; },

    /** El mismo paso que corre el sondeo del hilo, con sus valores por defecto. */
    async refrescar() {
      const r = await refrescarExpediente(cliente, {
        challengeId: DESAFIO,
        clubIds: clubesAdmin,
        anterior: expediente,
        ahora: AHORA,
      });
      if (r.cambio) cambios += 1;
      expediente = r.expediente;
      return r;
    },

    /** Lo que decide el botón, llamado como lo llama `ChatThreadScreen`. */
    revision(challenge = DESAFIO_EN_JUEGO) {
      return accionesDeRevision({
        challenge,
        partido: PARTIDO_JUGADO,
        clubesAdmin,
        sanciones: expediente.sanciones,
        revisiones: expediente.revisiones,
      });
    },

    incomparecencia(challenge = DESAFIO_EN_JUEGO) {
      return accionesDeIncomparecencia({
        challenge,
        partido: PARTIDO_JUGADO,
        clubesAdmin,
        reportes: expediente.informes,
        ahora: AHORA,
      });
    },
  };
}

/** Reloj falso, igual que en `sondeo.test.js`: mover 15 segundos de verdad no es una prueba. */
function relojFalso() {
  const activos = new Map();
  let siguiente = 1;
  return {
    timers: {
      setInterval: (fn, ms) => { activos.set(siguiente, { fn, ms }); return siguiente++; },
      clearInterval: (id) => activos.delete(id),
    },
    /**
     * Dispara un tick y espera a que se asiente lo que lanzó.
     *
     * `crearSondeo` no devuelve la promesa de `onTick` —se la guarda para no
     * solapar el tick siguiente— así que no hay nada que esperar directamente:
     * se cede el turno hasta que la cola de microtareas queda quieta, que es
     * lo mismo que hace el navegador entre dos intervalos.
     */
    async asentar() {
      for (let vuelta = 0; vuelta < 10; vuelta += 1) {
        await new Promise((r) => setImmediate(r));
      }
    },
    async tick(veces = 1) {
      for (let i = 0; i < veces; i += 1) {
        for (const { fn } of [...activos.values()]) fn();
        await this.asentar();
      }
    },
    vivos: () => activos.size,
  };
}

// ---------------------------------------------------------------------------
// La regresión
// ---------------------------------------------------------------------------

test('REGRESIÓN: la acusación cruzada llega sola a las dos sesiones', async () => {
  const db = baseVacia();
  const reloj = relojFalso();

  // Dos sesiones abiertas en el mismo hilo, cada una administrando un club.
  const sesionA = sesion(db, { clubesAdmin: [CLUB_A] });
  const sesionC = sesion(db, { clubesAdmin: [CLUB_C] });

  // Las dos con el sondeo real del hilo: intervalo por defecto, temporizadores
  // inyectados. Nada más va a refrescarlas — nadie recarga a mano.
  const detenerA = crearSondeo({
    activo: true,
    onTick: () => sesionA.refrescar(),
    timers: reloj.timers,
  });
  const detenerC = crearSondeo({
    activo: true,
    onTick: () => sesionC.refrescar(),
    timers: reloj.timers,
  });

  // Carga inicial, como al montar la pantalla: no hay ninguna medida todavía.
  await sesionA.refrescar();
  await sesionC.refrescar();
  assert.equal(sesionA.revision().puedeSolicitar, false);
  assert.equal(sesionC.revision().puedeSolicitar, false);
  assert.equal(
    sesionA.revision().bloqueo,
    'Todavía no hay ninguna cancelación ni sanción que revisar en este encuentro.'
  );

  // ── 1. A informa primero. La sanción provisional cae sobre C. ────
  informarIncomparecencia(db, {
    reportante: CLUB_A,
    reportado: CLUB_C,
    sancionId: SANCION_DE_C,
    motivo: 'No llegó nadie de P51-C.',
    creadoEn: '2026-08-17T00:10:00.000Z',
  });

  await reloj.tick();

  // La sesión de C, que no hizo nada, ya tiene su sanción y su botón.
  assert.equal(sesionC.expediente.sanciones.length, 1, 'C debería ver su sanción provisional');
  assert.equal(sesionC.expediente.sanciones[0].id, SANCION_DE_C);
  assert.equal(sesionC.revision().puedeSolicitar, true, 'C debería poder solicitar revisión');
  assert.equal(sesionC.revision().sancionId, SANCION_DE_C);

  // A no tiene ninguna sanción propia todavía: su botón sigue sin corresponder.
  assert.equal(sesionA.expediente.sanciones.length, 0, 'la RLS no le muestra a A la sanción de C');
  assert.equal(sesionA.revision().puedeSolicitar, false);

  // Pero el informe sí lo ven los dos, y C sabe que puede responder acusando.
  assert.equal(sesionC.expediente.informes.length, 1);
  assert.equal(sesionC.incomparecencia().yaInformada, false);
  assert.equal(sesionC.incomparecencia().puedeInformar, true);

  // ── 2. C informa después. Ahora la sanción cae sobre A. ──────────
  informarIncomparecencia(db, {
    reportante: CLUB_C,
    reportado: CLUB_A,
    sancionId: SANCION_DE_A,
    motivo: 'P51-A tampoco se presentó.',
    creadoEn: '2026-08-17T00:40:00.000Z',
  });

  await reloj.tick();

  // ── 3. Sin recargar, A recibe el estado nuevo y aparece el botón. ─
  // Esto es exactamente lo que fallaba: A se quedaba sin sanción y con
  // «Todavía no hay ninguna cancelación ni sanción que revisar».
  assert.equal(sesionA.expediente.sanciones.length, 1, 'A debería ver su sanción sin recargar');
  assert.equal(sesionA.expediente.sanciones[0].id, SANCION_DE_A);
  assert.equal(sesionA.expediente.sanciones[0].estado, 'provisional');
  assert.equal(sesionA.revision().puedeSolicitar, true, '«Solicitar revisión» debería aparecer en A');
  assert.equal(sesionA.revision().tipo, 'sancion');
  assert.equal(sesionA.revision().sancionId, SANCION_DE_A);
  assert.equal(sesionA.revision().bloqueo, null);

  // A también se entera de que lo acusaron, y de que ya no puede informar dos veces.
  assert.equal(sesionA.expediente.informes.length, 2);
  assert.equal(sesionA.incomparecencia().yaInformada, true);
  assert.equal(sesionA.incomparecencia().reporteContraMiClub.club_reportante_id, CLUB_C);
  assert.equal(
    sesionA.incomparecencia().bloqueo,
    'Ya informaste una incomparecencia en este encuentro.'
  );

  // ── 4. C recibe el cambio equivalente por el mismo camino. ───────
  assert.equal(sesionC.expediente.sanciones.length, 1, 'C sigue viendo sólo la suya');
  assert.equal(sesionC.expediente.sanciones[0].id, SANCION_DE_C);
  assert.equal(sesionC.revision().puedeSolicitar, true);
  assert.equal(sesionC.revision().sancionId, SANCION_DE_C);
  assert.equal(sesionC.expediente.informes.length, 2);
  assert.equal(sesionC.incomparecencia().yaInformada, true);

  detenerA();
  detenerC();
  assert.equal(reloj.vivos(), 0, 'los dos sondeos deberían quedar cancelados');
});

test('la revisión pedida por mi club llega sola y cierra el botón', async () => {
  // La otra mitad del mismo problema: pedida la revisión en una sesión, la
  // otra tiene que dejar de ofrecer el botón sin recargar. Acá se comprueba
  // sobre la propia sesión, que es lo que la RLS permite ver.
  const db = baseVacia();
  const s = sesion(db, { clubesAdmin: [CLUB_A] });

  informarIncomparecencia(db, {
    reportante: CLUB_C,
    reportado: CLUB_A,
    sancionId: SANCION_DE_A,
    motivo: 'P51-A no se presentó.',
    creadoEn: '2026-08-17T00:40:00.000Z',
  });
  await s.refrescar();
  assert.equal(s.revision().puedeSolicitar, true);

  // `solicitar_revision_sancion()` deja la fila pendiente y congela el desafío.
  db.club_sanction_reviews.push({
    id: 'revision:A',
    club_id: CLUB_A,
    challenge_id: DESAFIO,
    match_id: PARTIDO,
    sancion_id: SANCION_DE_A,
    tipo: 'sancion',
    motivo: 'Sí llegamos, hay fotos.',
    estado: 'pendiente',
    decision: null,
    nota: null,
    resuelta_at: null,
    created_at: '2026-08-17T00:50:00.000Z',
  });

  await s.refrescar();
  const congelado = { ...DESAFIO_EN_JUEGO, estado: 'bloqueado_sancion' };
  assert.equal(s.expediente.revisiones.length, 1);
  assert.equal(s.revision(congelado).puedeSolicitar, false);
  assert.equal(s.revision(congelado).bloqueo, 'Ya pediste una revisión: está en cola.');
});

test('un fallo de red conserva el último expediente bueno y se recupera solo', async () => {
  // Un sondeo que falla NO puede vaciar el expediente: eso apagaría el botón
  // en cada corte de red, que es peor que no refrescar. Y tampoco puede dejar
  // la pantalla trabada: el siguiente tick bueno la pone al día.
  const db = baseVacia();
  const s = sesion(db, { clubesAdmin: [CLUB_A] });

  informarIncomparecencia(db, {
    reportante: CLUB_C,
    reportado: CLUB_A,
    sancionId: SANCION_DE_A,
    motivo: 'P51-A no se presentó.',
    creadoEn: '2026-08-17T00:40:00.000Z',
  });
  await s.refrescar();
  assert.equal(s.revision().puedeSolicitar, true);

  s.estado.fallar = true;
  const conFallo = await s.refrescar();
  assert.ok(conFallo.error, 'el fallo debería informarse, no tragarse');
  assert.equal(conFallo.cambio, false, 'sin datos nuevos no hay nada que repintar');
  assert.equal(s.expediente.sanciones.length, 1, 'la sanción no puede desaparecer por un corte');
  assert.equal(s.revision().puedeSolicitar, true, 'el botón tiene que seguir ahí');

  s.estado.fallar = false;
  const recuperado = await s.refrescar();
  assert.equal(recuperado.error, null);
  assert.equal(s.revision().puedeSolicitar, true);
});

test('el sondeo no apila consultas cuando la red va lenta', async () => {
  // `crearSondeo` se salta el tick si el anterior sigue en vuelo. Con seis
  // consultas por vuelta —el expediente son tres— apilarlas pintaría la
  // respuesta vieja encima de la nueva.
  const db = baseVacia();
  const reloj = relojFalso();
  const s = sesion(db, { clubesAdmin: [CLUB_A] });

  let liberar;
  const lenta = new Promise((r) => { liberar = r; });
  const detener = crearSondeo({
    activo: true,
    onTick: () => lenta.then(() => s.refrescar()),
    timers: reloj.timers,
  });

  await reloj.tick(3);
  assert.equal(s.estado.lecturas, 0, 'nada debería haberse leído todavía');

  liberar();
  await reloj.asentar();

  // Tres consultas: las de UN solo refresco. Los otros dos ticks se saltaron
  // mientras el primero seguía en vuelo.
  assert.equal(s.estado.lecturas, 3, 'los ticks solapados deberían haberse saltado');
  detener();
});

test('sin ningún club administrado no se consulta nada', async () => {
  // Quien sólo mira el hilo no tiene expediente que refrescar: sondearlo
  // sería una consulta cada quince segundos a cambio de nada.
  const db = baseVacia();
  const { cliente, estado } = clienteDe(db, { clubesDelUsuario: [] });

  const r = await refrescarExpediente(cliente, {
    challengeId: DESAFIO,
    clubIds: [],
    anterior: EXPEDIENTE_VACIO,
    ahora: AHORA,
  });

  assert.equal(estado.lecturas, 0);
  assert.equal(r.cambio, false);
  assert.deepEqual(r.expediente, EXPEDIENTE_VACIO);
});

test('sin novedades el expediente conserva su identidad y no repinta', async () => {
  // Reemplazar los tres arreglos cada quince segundos volvería a calcular la
  // barra y sus botones sin que haya pasado nada. La firma evita el repintado,
  // igual que la de la bitácora del hilo.
  const db = baseVacia();
  const s = sesion(db, { clubesAdmin: [CLUB_A] });

  informarIncomparecencia(db, {
    reportante: CLUB_C,
    reportado: CLUB_A,
    sancionId: SANCION_DE_A,
    motivo: 'P51-A no se presentó.',
    creadoEn: '2026-08-17T00:40:00.000Z',
  });

  const primero = await s.refrescar();
  assert.equal(primero.cambio, true);
  const referencia = s.expediente;

  const segundo = await s.refrescar();
  assert.equal(segundo.cambio, false);
  assert.equal(s.expediente, referencia, 'el mismo expediente debería ser el mismo objeto');
});

// ---------------------------------------------------------------------------
// El cableado de la pantalla
// ---------------------------------------------------------------------------

/**
 * `ChatThreadScreen` no se puede montar con el runner de Node —es JSX sobre
 * React Native— pero sí se puede leer, igual que estas pruebas leen las
 * migraciones para contrastar nombres de columna. Lo que se fija acá es lo
 * único que las pruebas de arriba no pueden demostrar: que el sondeo de verdad
 * pasa por el expediente. Todo lo demás puede estar impecable y el fallo
 * volver entero si alguien vuelve a sacarlo del refresco periódico.
 */
const PANTALLA = fs.readFileSync(
  path.join(path.resolve(__dirname, '..', '..', '..'), 'src', 'screens', 'ChatThreadScreen.js'),
  'utf8'
);

/** El cuerpo de un `useCallback` declarado como `const <nombre> = useCallback(`. */
function cuerpoDe(nombre) {
  const inicio = PANTALLA.indexOf(`const ${nombre} = useCallback(`);
  assert.notEqual(inicio, -1, `ChatThreadScreen debería declarar ${nombre}`);
  const fin = PANTALLA.indexOf('\n  );', inicio);
  assert.notEqual(fin, -1, `no se encontró el final de ${nombre}`);
  return PANTALLA.slice(inicio, fin);
}

test('REGRESIÓN: el sondeo del hilo refresca el expediente y la fila del desafío', () => {
  // El sondeo llama a `refrescarDesafio` y a nada más: es el único punto donde
  // hay que mirar qué se refresca cada quince segundos.
  assert.match(
    PANTALLA,
    /crearSondeo\(\{\s*activo: isChallengeThread && !!challengeId,\s*onTick: \(\) => refrescarDesafio\(\{ silencioso: true \}\)/,
    'el sondeo debería seguir corriendo `refrescarDesafio`'
  );

  const refresco = cuerpoDe('refrescarDesafio');
  assert.match(refresco, /cargarExpediente\(\)/, 'el refresco debería recargar el expediente');
  assert.match(refresco, /getChallenge\(challengeId\)/, 'el refresco debería releer la fila del desafío');
  assert.match(refresco, /listChallengeEvents\(challengeId\)/);
  assert.match(refresco, /cargarCambio\(\{ silencioso \}\)/);

  // Y el expediente se lee con el cargador real, no con una consulta suelta
  // que algún día contaría distinto que la de esta prueba.
  const expediente = cuerpoDe('cargarExpediente');
  assert.match(expediente, /refrescarExpedienteDeSancion\(/);
  assert.match(expediente, /anterior: expedienteRef\.current/);
  assert.match(expediente, /if \(!cambio \|\| !mountedRef\.current\) return;/,
    'no se puede tocar el estado sin novedades ni con la pantalla desmontada');
});

test('REGRESIÓN: informar y pedir revisión refrescan por el mismo camino que el sondeo', () => {
  // Dos rutas distintas para el mismo dato terminan discrepando el día que
  // sólo se arregla una. Las acciones propias no releen nada por su cuenta.
  for (const accion of ['informarIncomparecencia', 'pedirRevision', 'cancelarEncuentro']) {
    const cuerpo = cuerpoDe(accion);
    assert.match(cuerpo, /await refrescarDesafio\(\);/, `${accion} debería refrescar por el camino común`);
    assert.doesNotMatch(cuerpo, /listSancionesDeClubes|listRevisionesDeDesafio|listIncomparecenciasDeDesafio/,
      `${accion} no debería tener su propia lectura del expediente`);
  }
});
