/**
 * Reglas centralizadas del ciclo de desafíos entre clubes.
 *
 * Igual que `matchRules.js` hace con el módulo Partidos, este archivo es la
 * única fuente de los plazos, los cupos, las transiciones y los textos del
 * ciclo. Ninguna pantalla ni componente vuelve a escribir uno de estos
 * números por su cuenta.
 *
 * ESPEJO EN POSTGRESQL — la función `desafio_reglas()` de la migración 41
 * devuelve estos mismos valores en JSON. El backend es la autoridad: valida
 * plazos y permisos con `now()` de PostgreSQL y con `club_members`, nunca con
 * lo que mande el cliente. Lo de acá sirve para dibujar y para avisar antes de
 * gastar una llamada, no para autorizar. Si un valor cambia, cambia en los dos
 * lados o el cliente empezará a ofrecer acciones que el servidor rechaza.
 *
 * El módulo es puro a propósito (sin React, sin Supabase, sin `Date.now()`
 * escondido): las funciones que dependen del tiempo reciben la hora como
 * argumento, para que las pruebas no tengan que congelar el reloj.
 */

// ─────────────────────────────────────────────── plazos del ciclo

/** Horas de negociación que se abren al aceptar un desafío. */
export const NEGOCIACION_HORAS = 72;

/** Horas de la prórroga final, cuando la negociación vence sin propuesta. */
export const PRORROGA_HORAS = 24;

/** Horas antes del inicio hasta las que todavía se puede proponer un cambio. */
export const CAMBIO_LIMITE_HORAS = 2;

/** Por debajo de estas horas, cancelar sanciona al club que cancela. */
export const CANCELACION_SANCION_HORAS = 2;

/** Días que dura una sanción de club. */
export const SANCION_DIAS = 14;

/** Días tras los que un desafío sin responder se da por expirado. */
export const EXPIRACION_PENDIENTE_DIAS = 7;

// ─────────────────────────────────────────────── cupos y formato

/**
 * Cupos POR CLUB, no del partido completo.
 *
 * El mínimo de 4 lo fija el enunciado. El máximo de 15 no es una preferencia:
 * `matches.cupos_totales` tiene `check (cupos_totales <= 30)` en
 * `supabase/schema.sql`, y el total de un partido de clubes es exactamente el
 * doble de los cupos por club.
 */
export const CUPOS_POR_CLUB = { min: 4, max: 15 };

/** Duraciones ofrecidas, las mismas que el módulo Partidos. */
export const DURACIONES = [60, 90, 120];

/** Modalidades soportadas por `matches.modalidad`. */
export const MODALIDADES = [
  { value: 'futbol7', label: 'Fútbol 7' },
  { value: 'futbol11', label: 'Fútbol 11' },
];

/** Cómo se llenan los cupos de cada club. */
export const METODOS_INSCRIPCION = [
  {
    value: 'orden_llegada',
    label: 'Orden de llegada',
    desc: 'Se inscriben solos hasta completar los cupos del club',
  },
  {
    value: 'seleccion_admin',
    label: 'Selección de administradores',
    desc: 'Los jugadores postulan y cada club confirma su nómina',
  },
];

/** Largo máximo del mensaje opcional (`club_challenges.mensaje`). */
export const MENSAJE_MAX = 300;

/** Largo máximo de las instrucciones de la propuesta oficial. */
export const INSTRUCCIONES_MAX = 500;

// ─────────────────────────────────────────────── máquina de estados

/**
 * Estados de `club_challenges.estado`.
 *
 * `ACEPTADO_LEGADO` no lo produce el código nuevo: existe sólo para las filas
 * anteriores a la migración 41, que conservan su DM entre dos administradores
 * gracias a `chat_valid_club_challenge_dm()`. No se migran.
 */
export const ESTADOS = {
  PENDIENTE: 'pendiente',
  NEGOCIACION: 'negociacion',
  ESPERANDO_APROBACION: 'esperando_aprobacion',
  PUBLICADO: 'publicado',
  EN_JUEGO: 'en_juego',
  ESPERANDO_RESULTADO: 'esperando_resultado',
  FINALIZADO: 'finalizado',
  RECHAZADO: 'rechazado',
  SIN_ACUERDO: 'sin_acuerdo',
  CANCELADO: 'cancelado',
  RESULTADO_EN_DISPUTA: 'resultado_en_disputa',
  BLOQUEADO_SANCION: 'bloqueado_sancion',
  EXPIRADO: 'expirado',
  ACEPTADO_LEGADO: 'aceptado',
};

/**
 * Transiciones autorizadas. La autoridad real son las RPC de las migraciones
 * 41-46; esta tabla evita que la interfaz ofrezca un camino que el servidor
 * va a rechazar.
 */
export const TRANSICIONES = {
  pendiente: ['negociacion', 'rechazado', 'cancelado', 'expirado', 'bloqueado_sancion'],
  negociacion: ['esperando_aprobacion', 'sin_acuerdo', 'cancelado', 'bloqueado_sancion'],
  esperando_aprobacion: [
    'publicado',
    'negociacion',
    'sin_acuerdo',
    'cancelado',
    'bloqueado_sancion',
  ],
  publicado: ['en_juego', 'cancelado', 'bloqueado_sancion'],
  en_juego: ['esperando_resultado', 'cancelado', 'bloqueado_sancion'],
  esperando_resultado: ['finalizado', 'resultado_en_disputa', 'bloqueado_sancion'],
  // Sólo la moderación puede reabrir una disputa; nunca se cierra sola.
  resultado_en_disputa: ['esperando_resultado'],
  // Retirar la sanción devuelve el desafío al estado en que estaba.
  bloqueado_sancion: [
    'pendiente',
    'negociacion',
    'esperando_aprobacion',
    'publicado',
    'en_juego',
    'esperando_resultado',
  ],
  // Legado: se puede reconducir a mano al ciclo nuevo, o cancelar.
  aceptado: ['negociacion', 'cancelado'],
  // Terminales.
  finalizado: [],
  rechazado: [],
  sin_acuerdo: [],
  cancelado: [],
  expirado: [],
};

/** Estados en que el hilo de negociación acepta mensajes nuevos. */
export const ESTADOS_ACTIVOS = [
  'negociacion',
  'esperando_aprobacion',
  'publicado',
  'en_juego',
  'esperando_resultado',
  'resultado_en_disputa',
];

/** Estados que ya no admiten ninguna acción. */
export const ESTADOS_CERRADOS = [
  'finalizado',
  'rechazado',
  'sin_acuerdo',
  'cancelado',
  'expirado',
];

const ESTADO_LABEL = {
  pendiente: 'Pendiente',
  negociacion: 'Negociación',
  // Ver C1 del plan: «Propuesta oficial» y «Esperando aprobación» son el mismo
  // instante, así que se persiste un estado y se etiqueta con el nombre que la
  // gente entiende.
  esperando_aprobacion: 'Propuesta oficial enviada',
  publicado: 'Partido publicado',
  en_juego: 'En juego',
  esperando_resultado: 'Esperando resultado',
  finalizado: 'Finalizado',
  rechazado: 'Rechazado',
  sin_acuerdo: 'Sin acuerdo',
  cancelado: 'Cancelado',
  resultado_en_disputa: 'Resultado en disputa',
  bloqueado_sancion: 'Club sancionado',
  expirado: 'Expirado',
  aceptado: 'Aceptado',
};

/** ¿La transición está permitida por la máquina de estados? */
export function puedeTransicionar(desde, hacia) {
  const salidas = TRANSICIONES[desde];
  if (!salidas) return false;
  return salidas.includes(hacia);
}

/** ¿El desafío sigue vivo, es decir, el chat acepta mensajes? */
export function esEstadoActivo(estado) {
  return ESTADOS_ACTIVOS.includes(estado);
}

/** ¿El desafío ya terminó, con o sin partido? */
export function esEstadoCerrado(estado) {
  return ESTADOS_CERRADOS.includes(estado);
}

/** Etiqueta en español de un estado. Nunca devuelve el valor crudo. */
export function estadoLabel(estado) {
  return ESTADO_LABEL[estado] || 'Desconocido';
}

/** Etiqueta del método de inscripción. */
export function metodoLabel(value) {
  return METODOS_INSCRIPCION.find((m) => m.value === value)?.label || 'Sin definir';
}

/** «7 por club» — deja explícito que el número no es el total del partido. */
export function cuposLabel(cuposPorClub) {
  const n = Number(cuposPorClub);
  if (!Number.isFinite(n) || n <= 0) return 'Cupos sin definir';
  return `${n} por club`;
}

// ─────────────────────────────────────────────── plazos

const HORA_MS = 3600 * 1000;

function aFecha(valor) {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Cuánto falta para un vencimiento, medido contra la hora que se le pase.
 *
 * `ahora` debería venir del servidor (la fila trae `now()` de PostgreSQL en su
 * propio campo), no del reloj del dispositivo: un teléfono desajustado no
 * puede regalarse ni quitarse horas de negociación.
 */
export function plazoRestante(venceAt, ahora = new Date()) {
  const vence = aFecha(venceAt);
  if (!vence) return { ms: 0, vencido: false, label: '' };

  const base = aFecha(ahora) || new Date();
  const ms = vence.getTime() - base.getTime();
  if (ms <= 0) return { ms: 0, vencido: true, label: 'vencido' };

  const min = Math.round(ms / 60000);
  if (min < 60) return { ms, vencido: false, label: `${min} min` };

  const h = Math.floor(min / 60);
  const resto = min % 60;
  if (h < 24) {
    return { ms, vencido: false, label: resto ? `${h} h ${resto}` : `${h} h` };
  }

  const d = Math.floor(h / 24);
  return { ms, vencido: false, label: d === 1 ? '1 día' : `${d} días` };
}

/** ¿Falta más que el límite para proponer un cambio del partido? */
export function puedeProponerCambio(horaInicio, ahora = new Date()) {
  const inicio = aFecha(horaInicio);
  if (!inicio) return false;
  const base = aFecha(ahora) || new Date();
  return inicio.getTime() - base.getTime() > CAMBIO_LIMITE_HORAS * HORA_MS;
}

/** ¿Cancelar ahora mismo dispara la sanción automática de 14 días? */
export function cancelacionSanciona(horaInicio, ahora = new Date()) {
  const inicio = aFecha(horaInicio);
  if (!inicio) return false;
  const base = aFecha(ahora) || new Date();
  return inicio.getTime() - base.getTime() <= CANCELACION_SANCION_HORAS * HORA_MS;
}

/** Fecha de término de una sanción aplicada en `desde`. */
export function finDeSancion(desde = new Date()) {
  const base = aFecha(desde) || new Date();
  return new Date(base.getTime() + SANCION_DIAS * 24 * HORA_MS);
}

// ─────────────────────────────────────────────── validaciones

function textoVacio(v) {
  return !v || String(v).trim().length === 0;
}

function esEnteroEnRango(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max;
}

function validarCupos(errors, cuposPorClub) {
  if (!esEnteroEnRango(cuposPorClub, CUPOS_POR_CLUB.min, CUPOS_POR_CLUB.max)) {
    errors.cuposPorClub = `Entre ${CUPOS_POR_CLUB.min} y ${CUPOS_POR_CLUB.max} cupos por club`;
  }
}

function validarMetodo(errors, metodoInscripcion) {
  if (!METODOS_INSCRIPCION.some((m) => m.value === metodoInscripcion)) {
    errors.metodoInscripcion = 'Elige cómo se llenarán los cupos';
  }
}

function validarModalidad(errors, modalidad) {
  if (!MODALIDADES.some((m) => m.value === modalidad)) {
    errors.modalidad = 'Elige la modalidad del partido';
  }
}

/**
 * `true` si el par de coordenadas es un punto real del planeta.
 *
 * Los rangos son los mismos que el CHECK de `matches.latitud`/`longitud`, que
 * además son NOT NULL: una propuesta sin coordenadas no se puede convertir en
 * partido, así que exigirlas acá es lo que evita una propuesta que nace
 * imposible de aprobar. Se rechaza `null`, `undefined`, `NaN`, infinitos y
 * cualquier cosa que no sea número — un `''` de un campo de texto vacío se
 * convertiría en 0 con `Number()`, y (0, 0) es una coordenada válida en medio
 * del Atlántico.
 */
export function coordenadasValidas(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Propuesta preliminar: lo que viaja al crear el desafío, antes de que exista
 * ninguna negociación. La fecha es tentativa y la zona aproximada a propósito.
 */
export function validarPropuestaPreliminar(draft = {}) {
  const errors = {};

  if (textoVacio(draft.retadorClubId)) {
    errors.retadorClubId = 'Elige con qué club desafías';
  }
  if (textoVacio(draft.rivalClubId)) {
    errors.rivalClubId = 'Elige el club rival';
  } else if (draft.rivalClubId === draft.retadorClubId) {
    errors.rivalClubId = 'Un club no puede desafiarse a sí mismo';
  }

  validarModalidad(errors, draft.modalidad);

  const desde = aFecha(draft.fechaDesde);
  if (!desde) {
    errors.fechaDesde = 'Indica una fecha tentativa';
  }
  const hasta = aFecha(draft.fechaHasta);
  if (draft.fechaHasta && !hasta) {
    errors.fechaHasta = 'La fecha final no es válida';
  } else if (desde && hasta && hasta.getTime() < desde.getTime()) {
    errors.fechaHasta = 'El rango no puede terminar antes de empezar';
  }

  if (textoVacio(draft.zona)) {
    errors.zona = 'Indica la zona aproximada';
  }

  validarCupos(errors, draft.cuposPorClub);
  validarMetodo(errors, draft.metodoInscripcion);

  if (draft.mensaje && String(draft.mensaje).length > MENSAJE_MAX) {
    errors.mensaje = `Máximo ${MENSAJE_MAX} caracteres`;
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Propuesta oficial: la que, al aprobarla el club contrario, publica el
 * partido. Acá ya no hay rangos ni aproximaciones — dirección exacta, hora y
 * cuota, porque es lo que verán todos los integrantes de ambos clubes.
 */
export function validarPropuestaOficial(draft = {}, ahora = new Date()) {
  const errors = {};

  const fecha = aFecha(draft.fecha);
  if (!fecha) {
    errors.fecha = 'Indica la fecha y hora del partido';
  } else {
    const base = aFecha(ahora) || new Date();
    if (fecha.getTime() <= base.getTime()) {
      errors.fecha = 'La fecha del partido tiene que ser futura';
    }
  }

  if (!DURACIONES.includes(draft.duracionMin)) {
    errors.duracionMin = 'Elige una duración';
  }

  if (textoVacio(draft.direccion)) errors.direccion = 'Indica la dirección exacta';
  if (textoVacio(draft.canchaNombre)) errors.canchaNombre = 'Indica la cancha o recinto';
  if (textoVacio(draft.comuna)) errors.comuna = 'Indica la comuna';
  if (textoVacio(draft.region)) errors.region = 'Indica la región';

  // La dirección escrita a mano no basta: el partido necesita coordenadas
  // para nacer, y sólo las trae el buscador de lugares.
  if (!coordenadasValidas(draft.latitud, draft.longitud)) {
    errors.ubicacion = 'Elige la cancha en el buscador para fijar su ubicación en el mapa';
  }

  validarModalidad(errors, draft.modalidad);
  validarCupos(errors, draft.cuposPorClub);
  validarMetodo(errors, draft.metodoInscripcion);

  if (!Number.isInteger(draft.cuotaPorPersona) || draft.cuotaPorPersona < 0) {
    errors.cuotaPorPersona = 'La cuota es un monto entero, o 0 si no hay';
  }

  if (draft.instrucciones && String(draft.instrucciones).length > INSTRUCCIONES_MAX) {
    errors.instrucciones = `Máximo ${INSTRUCCIONES_MAX} caracteres`;
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Traduce el borrador de la pantalla al payload que espera
 * `crear_propuesta_oficial(p_payload jsonb)`.
 *
 * Existe por la misma razón que `challengeCtaContext`: el borrador está en
 * camelCase y las columnas de `club_challenge_proposals` en snake_case, y esa
 * traducción escrita a mano dentro de la pantalla es exactamente donde un
 * nombre mal puesto se convierte en un campo que llega vacío al servidor sin
 * que nadie se entere. Acá ocurre en un solo lugar, con pruebas que fijan los
 * nombres.
 *
 * La fecha viaja en ISO: PostgreSQL la interpreta con zona horaria explícita
 * y no depende de cómo tenga configurado el teléfono quien propone.
 */
export function propuestaOficialPayload(draft = {}) {
  const fecha = aFecha(draft.fecha);
  const texto = (v) => (v == null ? null : String(v).trim() || null);
  // `Number(null)` y `Number('')` son 0, no NaN. Con la versión ingenua
  // —`Number.isFinite(Number(v)) ? Number(v) : null`— una propuesta sin
  // ubicación viajaba con latitud 0 y longitud 0 en vez de nulas, el servidor
  // no la veía como ausente y el partido nacía en medio del Atlántico.
  const numero = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    fecha: fecha ? fecha.toISOString() : null,
    duracion_min: draft.duracionMin ?? null,
    direccion: texto(draft.direccion),
    cancha_nombre: texto(draft.canchaNombre),
    comuna: texto(draft.comuna),
    region: texto(draft.region),
    latitud: numero(draft.latitud),
    longitud: numero(draft.longitud),
    modalidad: draft.modalidad ?? null,
    cupos_por_club: draft.cuposPorClub ?? null,
    metodo_inscripcion: draft.metodoInscripcion ?? null,
    cuota_por_persona: draft.cuotaPorPersona ?? 0,
    instrucciones: texto(draft.instrucciones),
    // «No» es lo que pasa si nadie dice nada, acá y en el servidor. No se
    // manda `undefined`: `coalesce((payload->>'proponente_juega')::boolean,
    // false)` ya resuelve la ausencia, pero mandar el valor explícito deja el
    // registro de que la pregunta se hizo y la respuesta fue no.
    proponente_juega: draft.proponenteJuega === true,
  };
}

// ─────────────────────────────────────────────── CTA y bloqueos

/**
 * Por qué el usuario no puede operar sobre este desafío.
 *
 * Devuelve `null` cuando no hay impedimento. El orden importa: se informa
 * primero lo que el usuario puede resolver (la conexión), después lo que
 * depende de su rol, y al final la sanción del club.
 *
 * ctx = { challenge, myClubId, soyAdmin, online, sancion }
 */
export function getChallengeBlockReason(ctx = {}) {
  const { online = true, soyAdmin = false, sancion = null } = ctx;

  if (!online) {
    return {
      code: 'sin_conexion',
      title: 'Sin conexión',
      detail: 'Necesitas conexión para responder o negociar el desafío.',
    };
  }

  if (!soyAdmin) {
    return {
      code: 'no_admin',
      title: 'Solo los administradores',
      detail: 'Puedes seguir el desafío, pero solo un administrador del club puede responder.',
    };
  }

  if (sancion) {
    const hasta = aFecha(sancion.fin_at);
    const cuando = hasta
      ? hasta.toLocaleDateString('es-CL', { day: '2-digit', month: 'long' })
      : null;
    return {
      code: 'club_sancionado',
      title: 'Tu club está sancionado',
      detail: cuando
        ? `${sancion.motivo}. La sanción termina el ${cuando}.`
        : `${sancion.motivo}.`,
    };
  }

  return null;
}

const CERRADO = {
  kind: 'cerrado',
  label: 'Desafío cerrado',
  tone: 'muted',
  disabled: true,
};

/**
 * Qué acción principal ofrece la pantalla del desafío.
 *
 * ctx = { challenge, myClubId, soyAdmin, propuesta, resultado,
 *         miRespuestaProrroga, online, sancion }
 *
 * `kind` es el que decide la interfaz; `label` ya viene en español y listo
 * para pintarse.
 */
export function getChallengeCta(ctx = {}) {
  const {
    challenge = {},
    myClubId = null,
    soyAdmin = false,
    propuesta = null,
    resultado = null,
    miRespuestaProrroga = null,
    online = true,
    sancion = null,
    pertenezcoAlProponente = false,
  } = ctx;

  const estado = challenge.estado;

  if (!online) {
    return {
      kind: 'sin_conexion',
      label: 'Sin conexión',
      tone: 'muted',
      disabled: true,
      hint: 'Vuelve a intentarlo cuando recuperes la señal.',
    };
  }

  if (!soyAdmin) {
    return {
      kind: 'solo_lectura',
      label: 'Solo lectura',
      tone: 'muted',
      disabled: true,
      hint: 'Un administrador de tu club responde por el equipo.',
    };
  }

  // EL ESTADO CERRADO MANDA SOBRE LA SANCIÓN, y ese orden es el arreglo de un
  // fallo real de la comprobación manual del 2026-08-14. Con la sanción
  // primero, el hilo de un encuentro YA CANCELADO mostraba «Club sancionado»
  // con el motivo de una sanción anterior del club —por otro encuentro— justo
  // donde se lee el motivo de esta cancelación. El servidor tenía el dato
  // bien; lo que estaba mal era preguntar por la sanción antes de mirar si
  // quedaba algo que bloquear.
  //
  // En un desafío cerrado no hay ninguna acción que la sanción pueda impedir:
  // lo que corresponde mostrar es su propio estado. La restricción del club
  // sigue anunciándose en los desafíos vivos, que es donde significa algo, y
  // en la barra de cancelación de arriba, que la redacta como lo que es.
  if (esEstadoCerrado(estado)) {
    return { ...CERRADO, hint: estadoLabel(estado) };
  }

  if (sancion) {
    return {
      kind: 'sancionado',
      label: 'Club sancionado',
      tone: 'danger',
      disabled: true,
      // El motivo NUNCA va solo. Suelto empieza por «Canceló el encuentro
      // con menos de 2 horas de aviso: …» y se lee como el motivo del hilo en
      // el que está pintado; con el sujeto delante queda claro que es una
      // restricción del club y no algo que le pasó a este desafío.
      hint: sancion.motivo
        ? `Tu club está sancionado: ${sancion.motivo}`
        : 'Tu club no puede operar desafíos por ahora.',
    };
  }

  const soyRetador = myClubId && myClubId === challenge.club_retador_id;

  switch (estado) {
    case 'pendiente':
      return soyRetador
        ? {
            kind: 'esperar_respuesta',
            label: 'Esperando al club rival',
            tone: 'muted',
            disabled: true,
          }
        : { kind: 'responder', label: 'Responder desafío', tone: 'primary' };

    case 'negociacion': {
      if (challenge.prorroga_abierta_at) {
        return miRespuestaProrroga == null
          ? {
              kind: 'responder_prorroga',
              label: '¿Este partido se disputará?',
              tone: 'primary',
              hint: 'Basta con que responda un administrador de tu club.',
            }
          : {
              kind: 'esperar_prorroga',
              label: 'Esperando al otro club',
              tone: 'muted',
              disabled: true,
            };
      }
      return { kind: 'crear_propuesta', label: 'Crear propuesta oficial', tone: 'primary' };
    }

    case 'esperando_aprobacion': {
      const proponente = propuesta?.club_proponente_id;
      if (proponente && myClubId && proponente !== myClubId) {
        // Espejo exacto de la condición B de `aprobar_propuesta` y
        // `rechazar_propuesta`: quien pertenece también al club proponente no
        // responde por el rival, ni siquiera si administra el otro club.
        // Ofrecer el botón aquí sería mandar al usuario contra un error del
        // servidor.
        if (pertenezcoAlProponente) {
          return {
            kind: 'conflicto_pertenencia',
            label: 'No puedes responder por el rival',
            tone: 'muted',
            disabled: true,
            hint: 'Perteneces a los dos clubes. Responde otro administrador de tu club.',
          };
        }
        return { kind: 'aprobar_propuesta', label: 'Revisar propuesta', tone: 'primary' };
      }
      return {
        kind: 'esperar_aprobacion',
        label: 'Esperando aprobación del rival',
        tone: 'muted',
        disabled: true,
      };
    }

    case 'publicado':
    case 'en_juego':
      return { kind: 'ver_partido', label: 'Ver el partido', tone: 'primary' };

    case 'esperando_resultado': {
      if (!resultado || resultado.estado !== 'propuesto') {
        return { kind: 'proponer_resultado', label: 'Registrar resultado', tone: 'primary' };
      }
      return resultado.club_proponente_id === myClubId
        ? {
            kind: 'esperar_confirmacion',
            label: 'Esperando confirmación del rival',
            tone: 'muted',
            disabled: true,
          }
        : { kind: 'confirmar_resultado', label: 'Confirmar resultado', tone: 'primary' };
    }

    case 'resultado_en_disputa':
      return {
        kind: 'en_disputa',
        label: 'Resultado en disputa',
        tone: 'danger',
        disabled: true,
        hint: 'Las estadísticas no cambian hasta que se resuelva.',
      };

    case 'bloqueado_sancion':
      return {
        kind: 'sancionado',
        label: 'Club sancionado',
        tone: 'danger',
        disabled: true,
      };

    case 'aceptado':
      // Desafío anterior a la migración 41: conserva su conversación directa.
      return { kind: 'chat_legado', label: 'Abrir la conversación', tone: 'primary' };

    default:
      return { ...CERRADO, label: 'Desafío no disponible' };
  }
}
