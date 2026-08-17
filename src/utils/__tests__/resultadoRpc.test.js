/**
 * Pruebas de la parte del resultado del encuentro que se puede probar sin
 * abrir Supabase: cómo se arman los argumentos de `proponer_resultado` y
 * `confirmar_resultado`, cómo se traduce lo que devuelven, y qué botón
 * corresponde mostrar (migración 48).
 *
 * POR QUÉ ESTO VIVE FUERA DEL SERVICIO. `services/clubResults.js` importa el
 * cliente de Supabase y con él media aplicación; no se puede cargar en
 * `node --test`. Los NOMBRES de los argumentos sí se pueden y se deben
 * probar: PostgREST no avisa «te faltó un parámetro», contesta 404 «function
 * not found», igual que ya documentó `cambioRpc.test.js` para la 46.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  argumentosProponerResultado,
  argumentosConfirmarResultado,
  comoResultadoResultado,
  accionesDeResultado,
  textoResultadoPropuesto,
  textoResultadoConfirmado,
  textoResultadoDisputado,
  FALTA_MIGRACION_RESULTADO,
} = require('../resultadoRpc.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const MIGRACION = fs.readFileSync(
  path.join(RAIZ, 'supabase', 'migrations', '48_resultado_y_historial.sql'),
  'utf8'
);

/** Los nombres de argumento que declara una función en la migración. */
function argumentosDe(nombre) {
  const inicio = MIGRACION.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nombre}\\s*\\(`, 'i')
  );
  assert.notEqual(inicio, -1, `la migración 48 debería declarar ${nombre}`);
  const desde = MIGRACION.indexOf('(', inicio);
  const hasta = MIGRACION.indexOf(')', desde);
  return MIGRACION.slice(desde + 1, hasta)
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Los nombres de los argumentos
// ---------------------------------------------------------------------------

test('proponer manda exactamente los argumentos que declara la migración', () => {
  const args = argumentosProponerResultado('ch1', 3, 1, ['j1', 'j2']);
  assert.deepEqual(
    Object.keys(args).sort(),
    ['p_asistencia', 'p_challenge_id', 'p_goles_local', 'p_goles_visitante']
  );

  const declarados = argumentosDe('proponer_resultado');
  for (const clave of Object.keys(args)) {
    assert.ok(declarados.includes(clave), `«${clave}» no existe en la firma de la migración`);
  }
});

test('confirmar manda exactamente los argumentos que declara la migración', () => {
  const args = argumentosConfirmarResultado('r1', true);
  assert.deepEqual(Object.keys(args).sort(), ['p_aceptar', 'p_result_id']);

  const declarados = argumentosDe('confirmar_resultado');
  for (const clave of Object.keys(args)) {
    assert.ok(declarados.includes(clave), `«${clave}» no existe en la firma de la migración`);
  }
});

test('los valores viajan con el tipo que espera PostgreSQL', () => {
  const args = argumentosProponerResultado('ch1', '3', '1', ['j1']);
  assert.equal(args.p_challenge_id, 'ch1');
  assert.equal(args.p_goles_local, 3);
  assert.equal(args.p_goles_visitante, 1);
  assert.deepEqual(args.p_asistencia, ['j1']);

  // `p_aceptar` es boolean en la firma: mandar 1 o 'false' haría que
  // `coalesce(p_aceptar, false)` recibiera algo que no puede castear.
  assert.equal(argumentosConfirmarResultado('r1', 1).p_aceptar, true);
  assert.equal(argumentosConfirmarResultado('r1', undefined).p_aceptar, false);
});

test('la asistencia ausente viaja como null, y un arreglo vacío se conserva', () => {
  // `null` significa «no toques la asistencia» (una repropuesta tras un
  // rechazo); `[]` significa «nadie de los inscritos llegó», y son
  // respuestas distintas del lado del servidor. Colapsar la segunda en la
  // primera perdería el caso «nadie asistió».
  assert.equal(argumentosProponerResultado('ch1', 3, 1).p_asistencia, null);
  assert.equal(argumentosProponerResultado('ch1', 3, 1, null).p_asistencia, null);
  assert.deepEqual(argumentosProponerResultado('ch1', 3, 1, []).p_asistencia, []);
});

// ---------------------------------------------------------------------------
// La traducción de la respuesta
// ---------------------------------------------------------------------------

test('un `ok:false` es una respuesta del negocio, no un error del sistema', () => {
  const { data, error } = comoResultadoResultado(
    { ok: false, reason: 'Este desafío no está esperando un resultado' },
    null
  );
  assert.equal(data, null);
  assert.equal(error.message, 'Este desafío no está esperando un resultado');
});

test('un `ok:true` devuelve la fila y ningún error', () => {
  const { data, error } = comoResultadoResultado({ ok: true, resultId: 'r1', estado: 'propuesto' }, null);
  assert.equal(error, null);
  assert.equal(data.resultId, 'r1');
});

test('PostgREST puede envolver el resultado en un arreglo de uno', () => {
  const { data } = comoResultadoResultado([{ ok: true, resultId: 'r1' }], null);
  assert.equal(data.resultId, 'r1');
});

test('la migración ausente se traduce a un mensaje que se puede accionar', () => {
  for (const code of ['42883', 'PGRST202', '42P01', '42703']) {
    const { error } = comoResultadoResultado(null, { code, message: 'x' });
    assert.equal(error.message, FALTA_MIGRACION_RESULTADO.message, `el código ${code} debería avisarlo`);
  }
  const porTexto = comoResultadoResultado(null, {
    code: 'XXXXX',
    message: 'function public.confirmar_resultado does not exist',
  });
  assert.equal(porTexto.error.message, FALTA_MIGRACION_RESULTADO.message);
});

test('cualquier otro error conserva su mensaje: no se traga ni se disfraza', () => {
  const { data, error } = comoResultadoResultado(null, { code: '40001', message: 'deadlock' });
  assert.equal(data, null);
  assert.equal(error.message, 'deadlock');
});

// ---------------------------------------------------------------------------
// Qué botón corresponde mostrar
// ---------------------------------------------------------------------------

const DESAFIO = { club_retador_id: 'A', club_retado_id: 'B', estado: 'esperando_resultado' };

test('sin encuentro entre dos clubes no hay nada que proponer ni confirmar', () => {
  const s = accionesDeResultado({ challenge: { estado: 'esperando_resultado' } });
  assert.equal(s.esDeClubes, false);
  assert.equal(s.puedeProponer, false);
  assert.equal(s.puedeConfirmar, false);
});

test('un ajeno no puede proponer ni confirmar', () => {
  const s = accionesDeResultado({ challenge: DESAFIO, clubesAdmin: [] });
  assert.equal(s.puedeProponer, false);
  assert.match(s.bloqueoProponer, /administrador/);
});

test('quien administra los dos clubes no puede proponer', () => {
  const s = accionesDeResultado({ challenge: DESAFIO, clubesAdmin: ['A', 'B'] });
  assert.equal(s.puedeProponer, false);
  assert.match(s.bloqueoProponer, /Administras los dos/);
});

test('el admin de un club puede proponer si no hay un resultado activo', () => {
  const s = accionesDeResultado({ challenge: DESAFIO, clubesAdmin: ['A'], resultadoActivo: null });
  assert.equal(s.puedeProponer, true);
  assert.equal(s.bloqueoProponer, null);
});

test('no se puede proponer si ya hay uno propuesto esperando confirmación', () => {
  const s = accionesDeResultado({
    challenge: DESAFIO,
    clubesAdmin: ['A'],
    resultadoActivo: { estado: 'propuesto', club_proponente_id: 'B', propuesto_por: 'u-b' },
  });
  assert.equal(s.puedeProponer, false);
  assert.match(s.bloqueoProponer, /Ya hay un resultado propuesto/);
});

test('el proponente no puede confirmar su propio resultado', () => {
  const s = accionesDeResultado({
    challenge: DESAFIO,
    clubesAdmin: ['A'],
    miUserId: 'u-a',
    resultadoActivo: { estado: 'propuesto', club_proponente_id: 'A', propuesto_por: 'u-a' },
  });
  assert.equal(s.puedeConfirmar, false);
  assert.match(s.bloqueoConfirmar, /propio resultado/);
});

test('el admin del club contrario sí puede confirmar', () => {
  const s = accionesDeResultado({
    challenge: DESAFIO,
    clubesAdmin: ['B'],
    miUserId: 'u-b',
    resultadoActivo: { estado: 'propuesto', club_proponente_id: 'A', propuesto_por: 'u-a' },
  });
  assert.equal(s.puedeConfirmar, true);
  assert.equal(s.bloqueoConfirmar, null);
});

test('quien administra los dos clubes no puede confirmar: pertenece también al proponente', () => {
  const s = accionesDeResultado({
    challenge: DESAFIO,
    clubesAdmin: ['A', 'B'],
    miUserId: 'u-ambos',
    resultadoActivo: { estado: 'propuesto', club_proponente_id: 'A', propuesto_por: 'u-a' },
  });
  assert.equal(s.puedeConfirmar, false);
  assert.match(s.bloqueoConfirmar, /club al que perteneces/);
});

test('en disputa nadie propone de nuevo: sólo la moderación reabre (48b)', () => {
  const enDisputa = { ...DESAFIO, estado: 'resultado_en_disputa' };
  const s = accionesDeResultado({ challenge: enDisputa, clubesAdmin: ['A'] });
  assert.equal(s.puedeProponer, false);
  assert.match(s.bloqueoProponer, /no está esperando un resultado/);
});

test('sin ningún resultado propuesto no hay nada que confirmar', () => {
  const s = accionesDeResultado({ challenge: DESAFIO, clubesAdmin: ['B'], resultadoActivo: null });
  assert.equal(s.puedeConfirmar, false);
  const confirmado = accionesDeResultado({
    challenge: DESAFIO,
    clubesAdmin: ['B'],
    resultadoActivo: { estado: 'confirmado', club_proponente_id: 'A' },
  });
  assert.equal(confirmado.puedeConfirmar, false);
});

// ---------------------------------------------------------------------------
// Las tres frases del hilo (Tarea 6.3)
// ---------------------------------------------------------------------------
//
// EL FALLO QUE CIERRAN. Las tres burbujas del resultado eran las únicas del
// hilo que tiraban su `payload` a la basura: decían «Se registró un resultado,
// a la espera de confirmación» sin el marcador ni el club, mientras el aviso
// push del MISMO evento —armado en la migración 48— sí decía «chatgpt2 propuso
// 3-1 en «…»». El hilo al que ese push manda contaba menos que el push.

/** El payload tal como lo escribe `proponer_resultado()` (migración 48). */
const PAYLOAD_PROPUESTO = {
  result_id: 'r1',
  match_id: 'm1',
  club_proponente_id: 'A',
  club_proponente_nombre: 'Club A',
  actor_id: 'u-a',
  actor_username: 'vicente',
  goles_local: 3,
  goles_visitante: 1,
};

/** El de `confirmar_resultado()` al aceptar. */
const PAYLOAD_CONFIRMADO = {
  result_id: 'r1',
  match_id: 'm1',
  club_confirma_id: 'B',
  club_confirma_nombre: 'Club B',
  actor_id: 'u-b',
  actor_username: 'juan',
  goles_local: 3,
  goles_visitante: 1,
};

/** Y el de rechazar. */
const PAYLOAD_DISPUTADO = {
  result_id: 'r1',
  match_id: 'm1',
  club_responde_id: 'B',
  club_responde_nombre: 'Club B',
  actor_id: 'u-b',
  actor_username: 'juan',
  goles_local: 3,
  goles_visitante: 1,
};

test('la frase del resultado propuesto nombra al club, al administrador y el marcador', () => {
  const t = textoResultadoPropuesto(PAYLOAD_PROPUESTO);
  assert.match(t, /Club A \(@vicente\)/);
  assert.match(t, /3-1 \(local-visitante\)/);
  assert.match(t, /confirme el club contrario/);
});

test('la frase del confirmado dice que quedó en el historial de los dos clubes', () => {
  const t = textoResultadoConfirmado(PAYLOAD_CONFIRMADO);
  assert.match(t, /Club B \(@juan\)/);
  assert.match(t, /3-1 \(local-visitante\)/);
  assert.match(t, /historial de los dos clubes/);
});

test('la frase del rechazo NO invita a proponer otro: es la regla de la 48b', () => {
  const t = textoResultadoDisputado(PAYLOAD_DISPUTADO);
  assert.match(t, /Club B \(@juan\)/);
  assert.match(t, /rechazó el marcador 3-1 \(local-visitante\)/);
  assert.match(t, /sólo la moderación puede reabrirlo/);
  assert.equal(/propon/i.test(t.replace('propuesto', '')), false, `la frase invita a proponer: ${t}`);
});

test('el marcador va siempre anclado a local-visitante', () => {
  // El payload trae `goles_local` y `goles_visitante` pero no dice qué club fue
  // local, y en un hilo donde están los dos clubes un «3-1» suelto se lee al
  // revés la mitad de las veces. La perspectiva de cada club es cosa del
  // historial, no del hilo.
  for (const texto of [
    textoResultadoPropuesto(PAYLOAD_PROPUESTO),
    textoResultadoConfirmado(PAYLOAD_CONFIRMADO),
    textoResultadoDisputado(PAYLOAD_DISPUTADO),
  ]) {
    assert.match(texto, /\(local-visitante\)/);
  }
});

test('sin marcador en el payload la frase sigue siendo legible, sin «undefined»', () => {
  const sinGoles = { club_proponente_nombre: 'Club A', actor_username: 'vicente' };
  for (const texto of [
    textoResultadoPropuesto(sinGoles),
    textoResultadoConfirmado(sinGoles),
    textoResultadoDisputado(sinGoles),
  ]) {
    assert.equal(texto.includes('undefined'), false, texto);
    assert.equal(texto.includes('NaN'), false, texto);
    assert.equal(texto.includes('null'), false, texto);
  }
  // Un 0-0 sí es un marcador y tiene que salir.
  assert.match(
    textoResultadoConfirmado({ ...PAYLOAD_CONFIRMADO, goles_local: 0, goles_visitante: 0 }),
    /0-0 \(local-visitante\)/
  );
});

test('sin club ni username la frase no queda coja', () => {
  const t = textoResultadoPropuesto({ goles_local: 2, goles_visitante: 0 });
  assert.match(t, /^Un club registró el resultado: 2-0/);
  assert.equal(t.includes('(@'), false);
});

test('la burbuja del hilo usa estas tres funciones y no un texto fijo', () => {
  // Se lee el componente como fuente porque no se puede cargar en node (importa
  // react-native), igual que `expedienteSancion.test.js` lee ChatThreadScreen.
  const burbuja = fs.readFileSync(
    path.join(RAIZ, 'src', 'components', 'clubes', 'ChallengeEventBubble.js'),
    'utf8'
  );
  for (const fn of [
    'textoResultadoPropuesto',
    'textoResultadoConfirmado',
    'textoResultadoDisputado',
  ]) {
    assert.match(burbuja, new RegExp(fn), `la burbuja no usa ${fn}`);
  }
  // Y ya no quedan las frases mudas que ignoraban el payload.
  for (const viejo of [
    'Se registró un resultado, a la espera de confirmación',
    'El resultado quedó confirmado.',
    'El resultado quedó en disputa.',
  ]) {
    assert.equal(burbuja.includes(viejo), false, `sigue el texto fijo: ${viejo}`);
  }
});

test('el servidor tampoco invita ya a proponer otro resultado (migraciones 50 y 50b)', () => {
  // La 48b corrigió la GUARDA de `proponer_resultado()` pero dejó dos frases
  // diciendo lo contrario en `confirmar_resultado()`: el aviso del rechazo
  // («Propongan uno nuevo.») y el motivo de error al confirmar un rechazado
  // («pide que propongan uno nuevo»). Un aviso que pide una acción que el
  // servidor rechaza acto seguido es peor que no avisar.
  const m50 = fs.readFileSync(
    path.join(RAIZ, 'supabase', 'migrations', '50_partido_de_clubes_una_sola_puerta.sql'),
    'utf8'
  );
  const m50b = fs.readFileSync(
    path.join(RAIZ, 'supabase', 'migrations', '50b_frase_del_rechazo.sql'),
    'utf8'
  );

  // El cuerpo de la función que quedó aplicada es el de la 50b.
  const cuerpo = m50b.slice(m50b.indexOf('create or replace function public.confirmar_resultado'));
  assert.equal(cuerpo.includes('Propongan uno nuevo'), false);
  assert.equal(cuerpo.includes('pide que propongan uno nuevo'), false);
  assert.match(cuerpo, /sólo la moderación puede reabrirlo/);
  assert.match(cuerpo, /hasta que la moderación lo revise/);
  // La 48 exige «ya fue rechazado» en su caso 10: la frase lo conserva.
  assert.match(cuerpo, /Este resultado ya fue rechazado/);

  // Y las dos guardas de la 50 siguen en el archivo: son las que impiden
  // finalizar o cancelar un encuentro entre clubes por la puerta genérica.
  assert.match(m50, /save_match_attendance/);
  assert.match(m50, /cancel_match/);
  const guardas = m50.match(/if v_match\.challenge_proposal_id is not null then/g) || [];
  assert.equal(guardas.length, 2, 'la 50 debería tener las dos guardas');
});
