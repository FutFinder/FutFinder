/**
 * Pruebas de la lógica pura de los cambios negociados del partido de clubes
 * (migración 46): qué se puede pedir, hasta cuándo, y cómo se lee en el chat.
 *
 * Estas reglas son un ESPEJO del servidor, no la autoridad. La autoridad son
 * `proponer_cambio_partido` y `responder_cambio_partido`, que las vuelven a
 * comprobar con el reloj de PostgreSQL. Acá viven para no ofrecer un botón que
 * el servidor va a rechazar, y para que el texto del hilo se arme sin meter
 * lógica dentro de un componente.
 *
 * Las fechas se construyen con hora LOCAL (`new Date(a, m, d, h, min)`) a
 * propósito: así las aserciones sobre «17:00» no dependen de la zona horaria
 * de la máquina que corre las pruebas.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPOS_NEGOCIABLES,
  MARGEN_CAMBIO_HORAS,
  puedePedirCambios,
  construirCampos,
  frasesDeCambios,
  textoCambioPropuesto,
  textoCambioRespondido,
  accionesDeCambio,
  filasDeComparacion,
  mensajeDeEspera,
} = require('../cambioPartido.js');

const AHORA = new Date(2026, 7, 15, 12, 0); // 15 de agosto de 2026, 12:00 local

/** Un partido de clubes vigente: sábado 15 a las 17:00, cancha en Providencia. */
function partidoBase() {
  return {
    hora: new Date(2026, 7, 15, 17, 0).toISOString(),
    precio_cuota: 5000,
    cancha: {
      cancha_nombre: 'Cancha Uno',
      direccion: 'Av. Providencia 100',
      comuna: 'Providencia',
      region: 'Región Metropolitana de Santiago',
      latitud: -33.42,
      longitud: -70.61,
    },
  };
}

function canchaNueva(extra = {}) {
  return {
    cancha_nombre: 'Cancha Dos',
    direccion: 'Av. Nueva 456',
    comuna: 'Ñuñoa',
    region: 'Región Metropolitana de Santiago',
    latitud: -33.4567,
    longitud: -70.6098,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// El plazo de 2 horas
// ---------------------------------------------------------------------------

test('los campos negociables son exactamente los tres que acepta el servidor', () => {
  assert.deepEqual(CAMPOS_NEGOCIABLES, ['hora', 'cancha', 'cuota']);
  assert.equal(MARGEN_CAMBIO_HORAS, 2);
});

test('se pueden pedir cambios con más de 2 horas de margen', () => {
  assert.equal(puedePedirCambios(new Date(2026, 7, 15, 17, 0).toISOString(), AHORA), true);
});

test('a exactamente 2 horas ya no se piden cambios: el borde queda cerrado', () => {
  assert.equal(puedePedirCambios(new Date(2026, 7, 15, 14, 0).toISOString(), AHORA), false);
});

test('a menos de 2 horas, y con el partido ya empezado, tampoco', () => {
  assert.equal(puedePedirCambios(new Date(2026, 7, 15, 13, 30).toISOString(), AHORA), false);
  assert.equal(puedePedirCambios(new Date(2026, 7, 15, 11, 0).toISOString(), AHORA), false);
});

test('sin hora o con una fecha ilegible se falla cerrado', () => {
  assert.equal(puedePedirCambios(null, AHORA), false);
  assert.equal(puedePedirCambios('mañana por la tarde', AHORA), false);
});

// ---------------------------------------------------------------------------
// construirCampos — sólo viaja lo que de verdad cambia
// ---------------------------------------------------------------------------

test('sólo viajan los campos que cambian, no el formulario entero', () => {
  const { campos, error } = construirCampos({
    partido: partidoBase(),
    hora: new Date(2026, 7, 15, 18, 0),
    cuota: 5000, // igual: no debe viajar
    ahora: AHORA,
  });

  assert.equal(error, null);
  assert.deepEqual(Object.keys(campos), ['hora']);
  assert.equal(campos.hora, new Date(2026, 7, 15, 18, 0).toISOString());
});

test('si no cambia nada, se explica en vez de mandar una solicitud vacía', () => {
  const { campos, error } = construirCampos({
    partido: partidoBase(),
    hora: new Date(2026, 7, 15, 17, 0),
    cuota: 5000,
    ahora: AHORA,
  });

  assert.equal(campos, null);
  assert.match(error, /al menos un dato/i);
});

test('una hora propuesta dentro de las 2 horas se rechaza antes de salir del teléfono', () => {
  const { campos, error } = construirCampos({
    partido: partidoBase(),
    hora: new Date(2026, 7, 15, 13, 0),
    ahora: AHORA,
  });

  assert.equal(campos, null);
  assert.match(error, /2 horas/);
});

test('la cuota tiene que ser un monto entero y no negativo', () => {
  for (const cuota of [-1, 1500.5, 'mil', NaN]) {
    const { campos, error } = construirCampos({ partido: partidoBase(), cuota, ahora: AHORA });
    assert.equal(campos, null, `la cuota ${cuota} no debería viajar`);
    assert.ok(error, `la cuota ${cuota} debería explicar el problema`);
  }
});

test('la cuota 0 es válida: un partido puede quedar sin cuota', () => {
  const { campos, error } = construirCampos({ partido: partidoBase(), cuota: 0, ahora: AHORA });
  assert.equal(error, null);
  assert.deepEqual(campos, { cuota: 0 });
});

test('una cancha sin punto en el mapa se rechaza, y un 0 no cuenta como coordenada', () => {
  // `Number(null)` es 0 en JavaScript: el guardia tiene que mirar la ausencia,
  // no sólo si el número es finito. Es el mismo agujero que la 43c cerró en el
  // servidor y que aquí publicaría el partido en medio del Atlántico.
  const sinPunto = construirCampos({
    partido: partidoBase(),
    cancha: canchaNueva({ latitud: null, longitud: null }),
    ahora: AHORA,
  });
  assert.equal(sinPunto.campos, null);
  assert.match(sinPunto.error, /mapa/i);

  const conCeros = construirCampos({
    partido: partidoBase(),
    cancha: canchaNueva({ latitud: 0, longitud: 0 }),
    ahora: AHORA,
  });
  assert.equal(conCeros.campos, null);
});

test('una cancha sin nombre, dirección, comuna o región se rechaza', () => {
  for (const clave of ['cancha_nombre', 'direccion', 'comuna', 'region']) {
    const { campos } = construirCampos({
      partido: partidoBase(),
      cancha: canchaNueva({ [clave]: '   ' }),
      ahora: AHORA,
    });
    assert.equal(campos, null, `una cancha sin ${clave} no debería viajar`);
  }
});

test('la cancha viaja completa, con los seis datos que el servidor exige', () => {
  const { campos, error } = construirCampos({
    partido: partidoBase(),
    cancha: canchaNueva(),
    ahora: AHORA,
  });

  assert.equal(error, null);
  assert.deepEqual(Object.keys(campos.cancha).sort(), [
    'cancha_nombre',
    'comuna',
    'direccion',
    'latitud',
    'longitud',
    'region',
  ]);
});

test('los tres campos pueden viajar juntos en una sola solicitud', () => {
  const { campos, error } = construirCampos({
    partido: partidoBase(),
    hora: new Date(2026, 7, 15, 18, 0),
    cancha: canchaNueva(),
    cuota: 8000,
    ahora: AHORA,
  });

  assert.equal(error, null);
  assert.deepEqual(Object.keys(campos).sort(), ['cancha', 'cuota', 'hora']);
});

// ---------------------------------------------------------------------------
// El texto del hilo — el enunciado del plan, palabra por palabra
// ---------------------------------------------------------------------------

const CAMBIO_HORA = {
  campo: 'hora',
  antes: new Date(2026, 7, 15, 17, 0).toISOString(),
  despues: new Date(2026, 7, 15, 18, 0).toISOString(),
};

test('«Club A propone cambiar la hora de 17:00 a 18:00»', () => {
  const texto = textoCambioPropuesto({
    club_proponente_nombre: 'Club A',
    cambios: [CAMBIO_HORA],
  });
  assert.equal(texto, 'Club A propone cambiar la hora de 17:00 a 18:00.');
});

test('si el cambio mueve el día, el texto deja de hablar de «la hora»', () => {
  const texto = textoCambioPropuesto({
    club_proponente_nombre: 'Club A',
    cambios: [
      {
        campo: 'hora',
        antes: new Date(2026, 7, 15, 17, 0).toISOString(),
        despues: new Date(2026, 7, 16, 18, 0).toISOString(),
      },
    ],
  });
  assert.match(texto, /la fecha de/);
  assert.match(texto, /17:00/);
  assert.match(texto, /18:00/);
});

test('la cuota se lee en pesos chilenos, y el 0 se dice «gratis»', () => {
  const conMonto = frasesDeCambios([{ campo: 'cuota', antes: 5000, despues: 8000 }]);
  assert.deepEqual(conMonto, ['la cuota de $5.000 a $8.000']);

  const gratis = frasesDeCambios([{ campo: 'cuota', antes: 0, despues: 12000 }]);
  assert.deepEqual(gratis, ['la cuota de gratis a $12.000']);
});

test('el cambio de cancha nombra la comuna sólo cuando también cambia', () => {
  const mismaComuna = frasesDeCambios([
    { campo: 'cancha', antes: 'Cancha Uno', despues: 'Cancha Dos',
      antes_comuna: 'Providencia', despues_comuna: 'Providencia' },
  ]);
  assert.deepEqual(mismaComuna, ['la cancha de Cancha Uno a Cancha Dos']);

  const otraComuna = frasesDeCambios([
    { campo: 'cancha', antes: 'Cancha Uno', despues: 'Cancha Dos',
      antes_comuna: 'Providencia', despues_comuna: 'Ñuñoa' },
  ]);
  assert.deepEqual(otraComuna, ['la cancha de Cancha Uno (Providencia) a Cancha Dos (Ñuñoa)']);
});

test('varios cambios se enumeran con comas y una «y» final', () => {
  const texto = textoCambioPropuesto({
    club_proponente_nombre: 'Club A',
    cambios: [
      CAMBIO_HORA,
      { campo: 'cancha', antes: 'Cancha Uno', despues: 'Cancha Dos' },
      { campo: 'cuota', antes: 5000, despues: 8000 },
    ],
  });
  assert.equal(
    texto,
    'Club A propone cambiar la hora de 17:00 a 18:00, la cancha de Cancha Uno a Cancha Dos y la cuota de $5.000 a $8.000.'
  );
});

test('la respuesta dice quién respondió y qué pasó con el partido', () => {
  const aceptado = textoCambioRespondido({
    club_responde_nombre: 'Club B',
    aceptado: true,
    cambios: [CAMBIO_HORA],
  });
  assert.equal(aceptado, 'Club B aceptó el cambio: la hora de 17:00 a 18:00.');

  const rechazado = textoCambioRespondido({
    club_responde_nombre: 'Club B',
    aceptado: false,
    cambios: [],
  });
  assert.equal(rechazado, 'Club B rechazó el cambio. El partido sigue igual.');
});

// ---------------------------------------------------------------------------
// Un payload que este cliente no entiende no puede romper el hilo
// ---------------------------------------------------------------------------

test('un campo que este cliente todavía no conoce no rompe la conversación', () => {
  const texto = textoCambioPropuesto({
    club_proponente_nombre: 'Club A',
    cambios: [{ campo: 'modalidad', antes: 'futbol7', despues: 'futbol11' }],
  });
  assert.ok(typeof texto === 'string' && texto.length > 0);
  assert.doesNotMatch(texto, /undefined|null|\[object/);
});

test('sin payload, sin club o sin cambios se devuelve una frase legible', () => {
  for (const payload of [null, undefined, {}, { cambios: [] }]) {
    const propuesto = textoCambioPropuesto(payload);
    const respondido = textoCambioRespondido(payload);
    assert.ok(propuesto.length > 0 && !/undefined|null/.test(propuesto));
    assert.ok(respondido.length > 0 && !/undefined|null/.test(respondido));
  }
});

// ---------------------------------------------------------------------------
// accionesDeCambio — quién ve qué botón
//
// Es el espejo de la autorización del servidor. Que la interfaz esconda un
// botón NO es la protección: `proponer_cambio_partido` y
// `responder_cambio_partido` comprueban las mismas condiciones con el reloj y
// las membresías de PostgreSQL. Esto existe para no ofrecer una acción que el
// servidor va a rechazar, que es la forma más rápida de que alguien crea que
// la app está rota.
// ---------------------------------------------------------------------------

const CLUB_A = 'club-a';
const CLUB_B = 'club-b';
const YO = 'user-yo';

function partidoDeClubes(extra = {}) {
  return {
    id: 'm1',
    challenge_proposal_id: 'prop-1',
    challenge_id: 'ch1',
    estado: 'abierto',
    hora: new Date(2026, 7, 15, 17, 0).toISOString(),
    club_local_id: CLUB_A,
    club_visitante_id: CLUB_B,
    ...extra,
  };
}

function solicitudPendiente(extra = {}) {
  return {
    id: 'cb1',
    match_id: 'm1',
    club_proponente_id: CLUB_A,
    propuesto_por: 'user-otro',
    estado: 'pendiente',
    campos: { hora: new Date(2026, 7, 15, 18, 0).toISOString() },
    valores_anteriores: { hora: new Date(2026, 7, 15, 17, 0).toISOString() },
    ...extra,
  };
}

test('un administrador de uno de los dos clubes puede pedir un cambio', () => {
  const a = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: null,
    userId: YO,
    clubesAdmin: [CLUB_A],
    clubesTodos: [CLUB_A],
    ahora: AHORA,
  });

  assert.equal(a.esDeClubes, true);
  assert.equal(a.soyAdmin, true);
  assert.equal(a.miClubId, CLUB_A);
  assert.equal(a.puedePedir, true);
  assert.equal(a.bloqueoPedir, null);
});

test('un integrante sin rol no ve ninguna acción', () => {
  const a = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: solicitudPendiente(),
    userId: YO,
    clubesAdmin: [],
    clubesTodos: [CLUB_B],
    ahora: AHORA,
  });

  assert.equal(a.soyAdmin, false);
  assert.equal(a.puedePedir, false);
  assert.equal(a.puedeResponder, false);
});

test('quien administra los DOS clubes no puede pedir ni responder', () => {
  const a = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: null,
    userId: YO,
    clubesAdmin: [CLUB_A, CLUB_B],
    clubesTodos: [CLUB_A, CLUB_B],
    ahora: AHORA,
  });

  assert.equal(a.puedePedir, false);
  assert.match(a.bloqueoPedir, /los dos clubes/i);
});

test('fuera del plazo de 2 horas no se pide nada, y se dice por qué', () => {
  const a = accionesDeCambio({
    partido: partidoDeClubes({ hora: new Date(2026, 7, 15, 13, 0).toISOString() }),
    cambio: null,
    userId: YO,
    clubesAdmin: [CLUB_A],
    clubesTodos: [CLUB_A],
    ahora: AHORA,
  });

  assert.equal(a.puedePedir, false);
  assert.match(a.bloqueoPedir, /2 horas/);
});

test('con una solicitud pendiente no se abre otra', () => {
  const a = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: solicitudPendiente(),
    userId: YO,
    clubesAdmin: [CLUB_A],
    clubesTodos: [CLUB_A],
    ahora: AHORA,
  });

  assert.equal(a.hayPendiente, true);
  assert.equal(a.puedePedir, false);
  assert.match(a.bloqueoPedir, /esperando respuesta/i);
});

test('el administrador del club contrario sí puede responder', () => {
  const a = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: solicitudPendiente(),
    userId: YO,
    clubesAdmin: [CLUB_B],
    clubesTodos: [CLUB_B],
    ahora: AHORA,
  });

  assert.equal(a.puedeResponder, true);
  assert.equal(a.bloqueoResponder, null);
  assert.equal(a.esMiSolicitud, false);
});

test('quien pidió el cambio no puede responderlo', () => {
  const a = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: solicitudPendiente({ club_proponente_id: CLUB_B, propuesto_por: YO }),
    userId: YO,
    clubesAdmin: [CLUB_B],
    clubesTodos: [CLUB_B],
    ahora: AHORA,
  });

  assert.equal(a.esMiSolicitud, true);
  assert.equal(a.puedeResponder, false);
  assert.match(a.bloqueoResponder, /tu propia solicitud/i);
});

test('otro administrador del club que pidió el cambio tampoco responde', () => {
  const a = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: solicitudPendiente(), // la pide el club A, otro usuario
    userId: YO,
    clubesAdmin: [CLUB_A],
    clubesTodos: [CLUB_A],
    ahora: AHORA,
  });

  assert.equal(a.puedeResponder, false);
  assert.match(a.bloqueoResponder, /club contrario/i);
});

test('pertenecer al club que pidió el cambio, aunque sea como jugador, bloquea la respuesta', () => {
  // La regla estricta de la 43d: administro el club B, pero también soy
  // integrante del A. Responder sería darme el visto bueno a mí mismo.
  const a = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: solicitudPendiente(),
    userId: YO,
    clubesAdmin: [CLUB_B],
    clubesTodos: [CLUB_B, CLUB_A],
    ahora: AHORA,
  });

  assert.equal(a.puedeResponder, false);
  assert.match(a.bloqueoResponder, /perteneces/i);
});

test('dentro de las 2 horas la solicitud pendiente ya no se puede aceptar', () => {
  const a = accionesDeCambio({
    partido: partidoDeClubes({ hora: new Date(2026, 7, 15, 13, 0).toISOString() }),
    cambio: solicitudPendiente(),
    userId: YO,
    clubesAdmin: [CLUB_B],
    clubesTodos: [CLUB_B],
    ahora: AHORA,
  });

  assert.equal(a.puedeResponder, false);
  assert.match(a.bloqueoResponder, /2 horas/);
});

test('un partido normal no ofrece ninguna de las dos acciones', () => {
  const a = accionesDeCambio({
    partido: partidoDeClubes({ challenge_proposal_id: null }),
    cambio: null,
    userId: YO,
    clubesAdmin: [CLUB_A],
    clubesTodos: [CLUB_A],
    ahora: AHORA,
  });

  assert.equal(a.esDeClubes, false);
  assert.equal(a.puedePedir, false);
  assert.equal(a.puedeResponder, false);
});

test('un partido cancelado o ya jugado no admite cambios', () => {
  for (const estado of ['cancelado', 'finalizado', 'en_juego']) {
    const a = accionesDeCambio({
      partido: partidoDeClubes({ estado }),
      cambio: null,
      userId: YO,
      clubesAdmin: [CLUB_A],
      clubesTodos: [CLUB_A],
      ahora: AHORA,
    });
    assert.equal(a.puedePedir, false, `un partido «${estado}» no debería admitir cambios`);
  }
});

test('sin datos no revienta y no ofrece nada', () => {
  const a = accionesDeCambio({});
  assert.equal(a.puedePedir, false);
  assert.equal(a.puedeResponder, false);
  assert.equal(a.esDeClubes, false);
});

// ---------------------------------------------------------------------------
// filasDeComparacion — el «actual → propuesto» de la tarjeta
// ---------------------------------------------------------------------------

test('la tarjeta compara valor actual y propuesto, campo por campo', () => {
  const filas = filasDeComparacion({
    campos: {
      hora: new Date(2026, 7, 15, 18, 0).toISOString(),
      cuota: 8000,
    },
    valores_anteriores: {
      hora: new Date(2026, 7, 15, 17, 0).toISOString(),
      cuota: 5000,
    },
  });

  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0], { campo: 'hora', etiqueta: 'Hora', antes: '17:00', despues: '18:00' });
  assert.deepEqual(filas[1], { campo: 'cuota', etiqueta: 'Cuota', antes: '$5.000', despues: '$8.000' });
});

test('la cancha se compara por nombre y comuna, nunca por la calle exacta', () => {
  const filas = filasDeComparacion({
    campos: {
      cancha: {
        cancha_nombre: 'Cancha Dos', comuna: 'Ñuñoa', direccion: 'Av. Nueva 456',
        region: 'RM', latitud: -33.45, longitud: -70.6,
      },
    },
    valores_anteriores: {
      cancha: {
        cancha_nombre: 'Cancha Uno', comuna: 'Providencia', direccion: 'Av. Providencia 100',
        region: 'RM', latitud: -33.42, longitud: -70.61,
      },
    },
  });

  assert.equal(filas.length, 1);
  assert.equal(filas[0].etiqueta, 'Cancha');
  assert.equal(filas[0].antes, 'Cancha Uno · Providencia');
  assert.equal(filas[0].despues, 'Cancha Dos · Ñuñoa');
  // La calle vive en `club_match_locations` y ya se muestra en el detalle del
  // partido a quien corresponde; repetirla acá sería una segunda puerta.
  assert.doesNotMatch(JSON.stringify(filas), /Av\. (Nueva|Providencia)/);
});

test('si el valor anterior no viajó, la fila lo dice en vez de mostrar «undefined»', () => {
  const filas = filasDeComparacion({ campos: { cuota: 8000 }, valores_anteriores: {} });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].despues, '$8.000');
  assert.ok(filas[0].antes.length > 0);
  assert.doesNotMatch(filas[0].antes, /undefined|null/);
});

test('sin solicitud, la comparación es una lista vacía y no un error', () => {
  assert.deepEqual(filasDeComparacion(null), []);
  assert.deepEqual(filasDeComparacion({}), []);
});

// ---------------------------------------------------------------------------
// El actor y el motivo en el texto del hilo
// ---------------------------------------------------------------------------

test('el evento nombra al club y, si el servidor lo entregó, al administrador', () => {
  const texto = textoCambioPropuesto({
    club_proponente_nombre: 'Club A',
    actor_username: 'vicente',
    cambios: [CAMBIO_HORA],
  });
  assert.equal(texto, 'Club A (@vicente) propone cambiar la hora de 17:00 a 18:00.');
});

test('sin username el texto sigue nombrando al club: el club es lo que no puede faltar', () => {
  const texto = textoCambioPropuesto({ club_proponente_nombre: 'Club A', cambios: [CAMBIO_HORA] });
  assert.equal(texto, 'Club A propone cambiar la hora de 17:00 a 18:00.');
});

test('el rechazo con motivo lo muestra entre comillas, y sin motivo no inventa nada', () => {
  const conMotivo = textoCambioRespondido({
    club_responde_nombre: 'Club B',
    actor_username: 'juan',
    aceptado: false,
    motivo: 'ese día no tenemos arquero',
    cambios: [],
  });
  assert.equal(
    conMotivo,
    'Club B (@juan) rechazó el cambio: «ese día no tenemos arquero». El partido sigue igual.'
  );

  const sinMotivo = textoCambioRespondido({
    club_responde_nombre: 'Club B',
    aceptado: false,
    cambios: [],
  });
  assert.equal(sinMotivo, 'Club B rechazó el cambio. El partido sigue igual.');
});

test('un username vacío o en blanco no deja paréntesis huérfanos', () => {
  for (const actor_username of ['', '   ', null, undefined]) {
    const texto = textoCambioPropuesto({
      club_proponente_nombre: 'Club A',
      actor_username,
      cambios: [CAMBIO_HORA],
    });
    assert.doesNotMatch(texto, /\(\s*@?\s*\)/);
    assert.doesNotMatch(texto, /undefined|null/);
  }
});

// ---------------------------------------------------------------------------
// mensajeDeEspera — qué dice la tarjeta a quien no puede responder
//
// REGRESIÓN de la comprobación manual del 2026-08-13: al proponente la
// tarjeta le mostraba «No puedes responder tu propia solicitud», que es la
// razón interna por la que no se le dibujan botones, no lo que necesita
// leer. Quien acaba de pedir el cambio no está bloqueado: está esperando.
// ---------------------------------------------------------------------------

test('REGRESIÓN: a quien pidió el cambio se le dice que espera, no que no puede', () => {
  const acciones = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: solicitudPendiente({ club_proponente_id: CLUB_A, propuesto_por: YO }),
    userId: YO,
    clubesAdmin: [CLUB_A],
    clubesTodos: [CLUB_A],
    ahora: AHORA,
  });

  const texto = mensajeDeEspera(acciones, 'chatgpt2');
  assert.equal(texto, 'Esperando la respuesta de chatgpt2.');
  assert.doesNotMatch(texto, /no puedes/i);
});

test('sin saber el nombre del club contrario, la espera sigue siendo legible', () => {
  const acciones = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: solicitudPendiente({ club_proponente_id: CLUB_A, propuesto_por: YO }),
    userId: YO,
    clubesAdmin: [CLUB_A],
    clubesTodos: [CLUB_A],
    ahora: AHORA,
  });

  const texto = mensajeDeEspera(acciones, null);
  assert.match(texto, /Esperando la respuesta/);
  assert.doesNotMatch(texto, /undefined|null/);
});

test('a quien sí está bloqueado se le sigue explicando por qué', () => {
  const jugador = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: solicitudPendiente(),
    userId: YO,
    clubesAdmin: [],
    clubesTodos: [CLUB_B],
    ahora: AHORA,
  });
  assert.match(mensajeDeEspera(jugador, 'chatgpt'), /administrador del club contrario/i);

  const fueraDePlazo = accionesDeCambio({
    partido: partidoDeClubes({ hora: new Date(2026, 7, 15, 13, 0).toISOString() }),
    cambio: solicitudPendiente(),
    userId: YO,
    clubesAdmin: [CLUB_B],
    clubesTodos: [CLUB_B],
    ahora: AHORA,
  });
  assert.match(mensajeDeEspera(fueraDePlazo, 'chatgpt'), /2 horas/);
});

test('quien sí puede responder no necesita ningún mensaje', () => {
  const acciones = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: solicitudPendiente(),
    userId: YO,
    clubesAdmin: [CLUB_B],
    clubesTodos: [CLUB_B],
    ahora: AHORA,
  });
  assert.equal(mensajeDeEspera(acciones, 'chatgpt'), null);
});

test('sin solicitud pendiente no hay nada que esperar', () => {
  const acciones = accionesDeCambio({
    partido: partidoDeClubes(),
    cambio: null,
    userId: YO,
    clubesAdmin: [CLUB_A],
    clubesTodos: [CLUB_A],
    ahora: AHORA,
  });
  assert.equal(mensajeDeEspera(acciones, 'chatgpt2'), null);
  assert.equal(mensajeDeEspera(null, 'chatgpt2'), null);
});
