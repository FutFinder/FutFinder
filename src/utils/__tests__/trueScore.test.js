/**
 * Pruebas de la presentación de TrueScore (fase 1).
 *
 * La lógica de puntaje vive en Postgres y se prueba en
 * `supabase/tests/134_truescore_fase1_test.sql`. Acá se prueba lo único que
 * hace la app: pintar el nivel con la tabla que manda el servidor, saber si
 * la nómina está completa y redactar los costos que el servidor calculó.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  nivelTrueScore,
  marcasCompletas,
  plazoAsistenciaAbierto,
  textoCostoSalida,
  textoCostoCancelacion,
  describirEvento,
  puedeReclamar,
  textoEstadoReclamo,
} = require('../trueScore.js');

// La misma tabla que siembra la migración 134 en `truescore_config`.
const NIVELES = [
  { desde: 90, clave: 'muy_confiable', nombre: 'Muy confiable', color: 'verde' },
  { desde: 75, clave: 'confiable', nombre: 'Confiable', color: 'verde' },
  { desde: 50, clave: 'en_observacion', nombre: 'En observación', color: 'amarillo' },
  { desde: 0, clave: 'poco_confiable', nombre: 'Poco confiable', color: 'rojo' },
];

test('los bordes de cada nivel caen del lado correcto', () => {
  const casos = [
    [100, 'muy_confiable'], [90, 'muy_confiable'], [89, 'confiable'], [75, 'confiable'],
    [74, 'en_observacion'], [50, 'en_observacion'], [49, 'poco_confiable'], [0, 'poco_confiable'],
  ];
  for (const [p, clave] of casos) {
    assert.equal(nivelTrueScore(p, NIVELES).clave, clave, `puntaje ${p}`);
  }
});

test('el orden en que llega la tabla no importa', () => {
  assert.equal(nivelTrueScore(60, [...NIVELES].reverse()).color, 'amarillo');
});

test('sin tabla (TrueScore apagado) no hay nivel', () => {
  assert.equal(nivelTrueScore(80, null), null);
  assert.equal(nivelTrueScore(80, []), null);
  assert.equal(nivelTrueScore(undefined, NIVELES), null);
});

test('la nómina está completa sólo si cada jugador tiene una marca válida', () => {
  const nomina = [{ user_id: 'a' }, { user_id: 'b' }];
  assert.deepEqual(marcasCompletas(nomina, { a: 'asistio' }), { completas: false, faltan: 1 });
  assert.deepEqual(marcasCompletas(nomina, { a: 'asistio', b: 'presente' }), { completas: false, faltan: 1 });
  assert.deepEqual(marcasCompletas(nomina, { a: 'tarde', b: 'no_fue' }), { completas: true, faltan: 0 });
  assert.equal(marcasCompletas([], {}).completas, false);
});

test('el plazo de asistencia corre desde el fin del partido', () => {
  const hora = '2026-09-24T20:00:00Z';
  const match = { hora, duracion_min: 90 };
  const fin = Date.parse(hora) + 90 * 60000;
  assert.equal(plazoAsistenciaAbierto(match, 24, fin - 1), false);
  assert.equal(plazoAsistenciaAbierto(match, 24, fin), true);
  assert.equal(plazoAsistenciaAbierto(match, 24, fin + 24 * 3600000), true);
  assert.equal(plazoAsistenciaAbierto(match, 24, fin + 24 * 3600000 + 1), false);
  assert.equal(plazoAsistenciaAbierto({ ...match, asistencia_confirmada_at: hora }, 24, fin), false);
  assert.equal(plazoAsistenciaAbierto({ ...match, asistencia_vencida_at: hora }, 24, fin), false);
});

test('el costo de salir dice los puntos que calculó el servidor', () => {
  assert.match(textoCostoSalida({ ok: true, puntos: 13, rompe_racha: true }), /13 puntos.*racha/);
  assert.match(textoCostoSalida({ ok: true, puntos: 1, rompe_racha: false }), /1 punto de/);
  assert.equal(textoCostoSalida({ ok: false }), null);
});

test('cancelar por lluvia o cierre no cuesta; con poco aviso sí', () => {
  const costo = { ok: true, puntos: 15, horas_sin_costo: 12 };
  assert.match(textoCostoCancelacion(costo, 'lluvia'), /no pierdes puntos/);
  assert.match(textoCostoCancelacion(costo, 'cierre_cancha'), /no pierdes puntos/);
  assert.match(textoCostoCancelacion(costo, 'otro'), /baja 15 puntos.*menos de 12 h/);
  assert.match(textoCostoCancelacion({ ...costo, puntos: 0 }, 'otro'), /12 h o más.*no pierdes/);
});

test('el historial muestra lo aplicado, y el inicio muestra el puntaje', () => {
  assert.deepEqual(
    pick(describirEvento({ tipo: 'asistio', puntos_aplicados: 8, puntaje_despues: 89 })),
    { titulo: 'Asististe a tiempo', cambio: '+8', tono: 'positivo' }
  );
  assert.deepEqual(
    pick(describirEvento({ tipo: 'salida', puntos_aplicados: -13, puntaje_despues: 62 })),
    { titulo: 'Te saliste del partido', cambio: '-13', tono: 'negativo' }
  );
  // En 100, asistir aplica 0: se muestra como neutro, no como «+12».
  assert.equal(describirEvento({ tipo: 'asistio', puntos_aplicados: 0, puntaje_despues: 100 }).tono, 'neutro');
  assert.deepEqual(
    pick(describirEvento({ tipo: 'inicio', puntos_aplicados: -25, puntaje_despues: 75 })),
    { titulo: 'Inicio de TrueScore', cambio: '75', tono: 'neutro' }
  );
});

test('se reclama una tardanza o ausencia de un partido, dentro de plazo y una vez', () => {
  const creado = '2026-09-24T12:00:00Z';
  const base = { tipo: 'planton', match_id: 'm1', created_at: creado };
  const t0 = Date.parse(creado);
  const opts = { fase2: true, plazoHoras: 48, ahora: t0 + 3600000 };
  assert.equal(puedeReclamar(base, opts), true);
  assert.equal(puedeReclamar({ ...base, tipo: 'tarde' }, opts), true);
  assert.equal(puedeReclamar({ ...base, tipo: 'salida' }, opts), false);
  assert.equal(puedeReclamar({ ...base, match_id: null }, opts), false);
  assert.equal(puedeReclamar(base, { ...opts, fase2: false }), false);
  assert.equal(puedeReclamar(base, { ...opts, reclamo: { estado: 'abierto' } }), false);
  assert.equal(puedeReclamar(base, { ...opts, ahora: t0 + 48 * 3600000 }), true);
  assert.equal(puedeReclamar(base, { ...opts, ahora: t0 + 48 * 3600000 + 1 }), false);
});

test('el estado del reclamo se lee en una frase', () => {
  assert.match(textoEstadoReclamo({ estado: 'abierto', confirmaciones: 1, necesarias: 2 }), /1 de 2/);
  assert.match(textoEstadoReclamo({ estado: 'aceptado' }), /aceptado/);
  assert.match(textoEstadoReclamo({ estado: 'vencido' }), /se cerró/);
  assert.equal(textoEstadoReclamo(null), null);
});

test('los eventos nuevos de la fase 2 tienen título', () => {
  assert.equal(describirEvento({ tipo: 'reversion', puntos_aplicados: 58 }).titulo, 'Reclamo aceptado');
  assert.equal(describirEvento({ tipo: 'bono_organizador', puntos_aplicados: 5 }).cambio, '+5');
  assert.equal(describirEvento({ tipo: 'reclamo_organizador', puntos_aplicados: -20 }).tono, 'negativo');
});

test('la inactividad (fase 4) se muestra con su cambio, que puede subir o bajar', () => {
  assert.deepEqual(pick(describirEvento({ tipo: 'inactividad', puntos_aplicados: -2 })),
    { titulo: 'Tiempo sin jugar', cambio: '-2', tono: 'negativo' });
  assert.equal(describirEvento({ tipo: 'inactividad', puntos_aplicados: 2 }).cambio, '+2');
});

function pick(e) {
  return { titulo: e.titulo, cambio: e.cambio, tono: e.tono };
}

// ===========================================================================
// Correcciones T01–T07 del encargo del 25 de septiembre de 2026.
//
// Las siete son de la misma familia: la pantalla afirmaba algo que el
// servidor no había dicho. Un puntaje que no existe se pintaba como 100, uno
// que sí existe se escondía tras «N.A.», un costo que no había llegado se
// dejaba confirmar, y un error de red se presentaba como un dato.
// ===========================================================================

const { trustDisplay } = require('../playerMeta.js');
const { estadoCostoSalida, etiquetaTier, fusionarHistorial, sufijoCosto, textoEfectoGps } =
  require('../trueScore.js');

// --------------------------------------------------------------------- T01

test('T01: con TrueScore el puntaje inicial se muestra, no se esconde tras N.A.', () => {
  // Cuenta recién creada: el servidor le puso 75 con un evento «inicio» y
  // todavía no juega ningún partido. Antes salía «N.A.».
  const nueva = { trust_score: 75, asistencias_confirmadas: 0 };
  assert.deepEqual(
    { value: trustDisplay(nueva, { ts: true }).value, pct: trustDisplay(nueva, { ts: true }).pct },
    { value: '75', pct: 75 }
  );
});

test('T01: sin TrueScore sigue oculto, porque ahí el 100 es el valor por defecto de la BD', () => {
  const sinPartidos = { trust_score: 100, asistencias_confirmadas: 0 };
  assert.equal(trustDisplay(sinPartidos).value, 'N.A.');
  assert.equal(trustDisplay(sinPartidos).pct, null);
  // Con un partido cerrado sí es una reputación ganada.
  assert.equal(trustDisplay({ trust_score: 92, asistencias_confirmadas: 3 }).value, '92');
});

test('T01: si el dato falta, la interfaz NO inventa un puntaje en ninguna de las dos épocas', () => {
  for (const perfil of [null, {}, { trust_score: null }, { trust_score: undefined }]) {
    assert.equal(trustDisplay(perfil, { ts: true }).value, 'N.A.', JSON.stringify(perfil));
    assert.equal(trustDisplay(perfil, { ts: true }).pct, null);
    assert.equal(trustDisplay(perfil).value, 'N.A.');
  }
  // Y con TrueScore el texto dice que no se pudo cargar, no que falten partidos.
  assert.match(trustDisplay(null, { ts: true }).hint, /No pudimos cargar/);
});

test('T01: un cero real es un puntaje, no un hueco', () => {
  const cero = trustDisplay({ trust_score: 0, asistencias_confirmadas: 0 }, { ts: true });
  assert.equal(cero.value, '0');
  assert.equal(cero.pct, 0);
});

// --------------------------------------------------------------------- T02

test('T02: la etiqueta de Inicio sale de la tabla del servidor, no de tramos propios', () => {
  const con = (p) => etiquetaTier(p, { fase1: true, niveles: NIVELES });
  // El caso del informe: 75 es «Confiable» para el servidor, e Inicio decía «SÓLIDO».
  assert.equal(con(75), 'CONFIABLE');
  assert.equal(con(90), 'MUY CONFIABLE');
  assert.equal(con(89), 'CONFIABLE');
  assert.equal(con(50), 'EN OBSERVACIÓN');
  assert.equal(con(49), 'POCO CONFIABLE');
});

test('T02: sin TrueScore la portada conserva sus tramos antiguos', () => {
  assert.equal(etiquetaTier(95), 'ÉLITE');
  assert.equal(etiquetaTier(75), 'SÓLIDO');
  assert.equal(etiquetaTier(40), 'EN PRUEBA');
});

test('T02: sin puntaje no hay etiqueta — un hueco no es «ÉLITE»', () => {
  for (const p of [null, undefined, NaN, 'x']) {
    assert.equal(etiquetaTier(p, { fase1: true, niveles: NIVELES }), null, String(p));
    assert.equal(etiquetaTier(p), null, String(p));
  }
});

test('T02: con fase 1 y sin tabla de niveles no se inventa una etiqueta', () => {
  assert.equal(etiquetaTier(75, { fase1: true, niveles: [] }), null);
  assert.equal(etiquetaTier(75, { fase1: true, niveles: null }), null);
});

// --------------------------------------------------------------------- T03

test('T03: con fase 1 el texto del GPS no promete puntos', () => {
  const conTs = textoEfectoGps(true);
  assert.doesNotMatch(conTs, /suma/i);
  assert.match(conTs, /organizador/i);
  // Con el flujo antiguo detrás del flag apagado, el texto sigue siendo el suyo.
  assert.match(textoEfectoGps(false), /suma a tu Trust Score/);
});

// --------------------------------------------------------------------- T04

test('T04: mientras el costo no llega, el estado es «cargando» y no hay costo', () => {
  assert.deepEqual(estadoCostoSalida(undefined), { estado: 'cargando', costo: null, error: null });
});

test('T04: una RPC fallida es un error con mensaje, nunca un costo de cero', () => {
  const fallo = estadoCostoSalida(null);
  assert.equal(fallo.estado, 'error');
  assert.equal(fallo.costo, null);
  assert.match(fallo.error, /\S/);
});

test('T04: una respuesta del servidor que no es «ok» conserva su motivo', () => {
  const r = estadoCostoSalida({ ok: false, reason: 'No autenticado' });
  assert.equal(r.estado, 'error');
  assert.equal(r.error, 'No autenticado');
});

test('T04: un «ok» sin puntos usables tampoco habilita la acción', () => {
  assert.equal(estadoCostoSalida({ ok: true }).estado, 'error');
  assert.equal(estadoCostoSalida({ ok: true, puntos: null }).estado, 'error');
  assert.equal(estadoCostoSalida({ ok: true, puntos: 'siete' }).estado, 'error');
});

test('T04: cero es un costo válido y se muestra como tal', () => {
  const r = estadoCostoSalida({ ok: true, puntos: 0, horas_sin_costo: 12 });
  assert.equal(r.estado, 'listo');
  assert.equal(r.costo.puntos, 0);
  assert.equal(sufijoCosto(r.costo), ' (sin costo)');
});

test('T04: el botón dice los puntos exactos cuando los hay', () => {
  assert.equal(sufijoCosto({ puntos: 7 }), ' (−7 pts)');
  // Sin costo conocido el botón no puede prometer un número.
  assert.equal(sufijoCosto(null), '');
  assert.equal(sufijoCosto({}), '');
});

// --------------------------------------------------------------------- T06

test('T06: pasar de 100 eventos no pierde ninguno al pegar la página siguiente', () => {
  const evento = (id) => ({ id, tipo: 'asistio' });
  const pagina1 = Array.from({ length: 50 }, (_, i) => evento(101 - i)); // 101..52
  const pagina2 = Array.from({ length: 50 }, (_, i) => evento(51 - i)); // 51..2
  const pagina3 = [evento(1)];

  let { filas } = fusionarHistorial([], pagina1);
  ({ filas } = fusionarHistorial(filas, pagina2));
  ({ filas } = fusionarHistorial(filas, pagina3));

  assert.equal(filas.length, 101);
  assert.deepEqual(filas.map((f) => f.id), Array.from({ length: 101 }, (_, i) => 101 - i));
});

test('T06: las filas repetidas del borde se descartan, no se duplican', () => {
  // El historial antiguo pagina con `lte` sobre `created_at`, así que
  // devuelve a propósito las filas del empate otra vez.
  const cargado = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const { filas, agregadas } = fusionarHistorial(cargado, [{ id: 'c' }, { id: 'd' }]);
  assert.deepEqual(filas.map((f) => f.id), ['a', 'b', 'c', 'd']);
  assert.equal(agregadas, 1);
});

test('T06: una página entera de repetidas no agrega nada y avisa que no avanzó', () => {
  const cargado = [{ id: 1 }, { id: 2 }];
  const { filas, agregadas } = fusionarHistorial(cargado, [{ id: 2 }, { id: 1 }]);
  assert.deepEqual(filas.map((f) => f.id), [1, 2]);
  assert.equal(agregadas, 0);
});

test('T06: el orden de lo ya cargado no se altera al pegar una página', () => {
  const cargado = [{ id: 9 }, { id: 7 }, { id: 5 }];
  const { filas } = fusionarHistorial(cargado, [{ id: 4 }, { id: 3 }]);
  assert.deepEqual(filas.map((f) => f.id), [9, 7, 5, 4, 3]);
});

test('T06: un evento nuevo que llega en una página no se cuela dos veces', () => {
  // `id` 12 ya está arriba: aunque el servidor lo devuelva, no se repite.
  const cargado = [{ id: 12 }, { id: 11 }, { id: 10 }];
  const { filas } = fusionarHistorial(cargado, [{ id: 12 }, { id: 9 }]);
  assert.deepEqual(filas.map((f) => f.id), [12, 11, 10, 9]);
});

// --------------------------------------------------------------------- T07

const { estadoTelefono } = require('../trueScore.js');

test('T07: mientras la consulta del teléfono no llega, no se puede guardar', () => {
  const r = estadoTelefono(undefined);
  assert.equal(r.estado, 'cargando');
  assert.equal(r.puedeGuardar, false);
  assert.equal(r.datos, null);
});

test('T07: un error de consulta NO es «sin teléfono registrado»', () => {
  const r = estadoTelefono({ ok: false, reason: 'No pudimos consultar tu teléfono.' });
  assert.equal(r.estado, 'error');
  // Lo importante: no se ofrece el formulario ni se deja guardar, porque la
  // cuenta podría tener ya un número y estaríamos escribiendo a ciegas.
  assert.equal(r.puedeGuardar, false);
  assert.equal(r.datos, null);
  assert.equal(r.error, 'No pudimos consultar tu teléfono.');
});

test('T07: un null —lo que devolvía el servicio ante un error— tampoco pasa por dato', () => {
  assert.equal(estadoTelefono(null).estado, 'error');
  assert.equal(estadoTelefono(null).puedeGuardar, false);
  assert.match(estadoTelefono(null).error, /\S/);
});

test('T07: «no tiene teléfono» es un dato conocido y sí deja registrar', () => {
  const r = estadoTelefono({ ok: true, registrado: false, verificacion_sms: false });
  assert.equal(r.estado, 'listo');
  assert.equal(r.puedeGuardar, true);
  assert.equal(r.datos.registrado, false);
});

test('T07: una cuenta con número queda «lista» con su máscara intacta', () => {
  const r = estadoTelefono({ ok: true, registrado: true, mascara: '+56 9 •••• ••78' });
  assert.equal(r.estado, 'listo');
  assert.equal(r.datos.registrado, true);
});

// ---------------------------------------------- guardas contra la recaída

const fs = require('node:fs');
const path = require('node:path');

/** Todos los .js de `src/`, menos las pruebas. */
function fuentesDeLaApp(dir = path.resolve(__dirname, '..', '..')) {
  const salida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === '__tests__') continue;
      salida.push(...fuentesDeLaApp(ruta));
    } else if (entrada.name.endsWith('.js')) {
      salida.push(ruta);
    }
  }
  return salida;
}

test('T02: ningún archivo rellena un trust_score ausente con un 100 inventado', () => {
  // `trust_score` NACE en 100 en la BD, así que un `?? 100` en la app es
  // indistinguible de una reputación perfecta ganada. El hueco se dice.
  const culpables = fuentesDeLaApp().filter((f) =>
    /trust_score[^\n]*\?\?\s*100/.test(fs.readFileSync(f, 'utf8'))
  );
  assert.deepEqual(culpables.map((f) => path.basename(f)), []);
});

test('T05: ninguna pantalla vuelve a culpar al puntaje de una restricción', () => {
  // El motivo de una restricción no está en ninguna columna de `profiles`.
  const culpables = fuentesDeLaApp().filter((f) =>
    /(Trust ?Score|TrueScore)[^\n]{0,40}(llegó|llego) a 0/i.test(fs.readFileSync(f, 'utf8'))
  );
  assert.deepEqual(culpables.map((f) => path.basename(f)), []);
});
