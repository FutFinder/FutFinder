/**
 * Cambios negociados de un partido entre clubes (migración 46).
 *
 * Publicado el partido, ninguno de los dos clubes lo edita por su cuenta: pide
 * un cambio y el club contrario lo acepta o lo rechaza. Este archivo es la
 * parte que puede vivir fuera del servidor —armar la solicitud y leer el
 * evento del chat— y no toca React, Supabase ni colores.
 *
 * ES UN ESPEJO, NO LA AUTORIDAD. `proponer_cambio_partido` y
 * `responder_cambio_partido` vuelven a comprobar cada regla con el `now()` de
 * PostgreSQL, y ésa es la que manda: el reloj del teléfono no puede regalar ni
 * quitar margen. Lo de acá existe para no ofrecer un botón que el servidor va
 * a rechazar y para que el hilo se pinte sin meter lógica en un componente.
 *
 * EL TEXTO SE ARMA ACÁ Y NO EN LA BASE, por lo mismo que el resto de los
 * eventos del desafío: la fila guarda `tipo` y `payload` (datos), no una
 * frase. Así la redacción se corrige sin migrar filas.
 */

/** Lo único negociable después de publicar. Espejo del CHECK de la 46. */
export const CAMPOS_NEGOCIABLES = ['hora', 'cancha', 'cuota'];

/**
 * Bajo este margen ya no se negocia: a esa altura la gente va en camino.
 * El servidor lo calcula con `v_match.hora - interval '2 hours' <= now()`.
 */
export const MARGEN_CAMBIO_HORAS = 2;

const MARGEN_MS = MARGEN_CAMBIO_HORAS * 60 * 60 * 1000;

/** Los seis datos que el servidor exige para una cancha; media no se aplica. */
const CLAVES_CANCHA = ['cancha_nombre', 'direccion', 'comuna', 'region', 'latitud', 'longitud'];
const CLAVES_CANCHA_TEXTO = ['cancha_nombre', 'direccion', 'comuna', 'region'];

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Fecha válida o null. Nunca lanza: una fecha ilegible es un dato, no un error. */
function aFecha(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ¿Todavía se pueden pedir cambios?
 *
 * Falla CERRADO: sin hora o con una fecha ilegible devuelve `false`. Dejar
 * pasar la duda abriría el formulario para un partido que quizá empieza en
 * diez minutos.
 */
export function puedePedirCambios(horaPartido, ahora = new Date()) {
  const hora = aFecha(horaPartido);
  if (!hora) return false;
  const ref = aFecha(ahora);
  if (!ref) return false;
  return hora.getTime() - ref.getTime() > MARGEN_MS;
}

function esTextoConContenido(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Una coordenada de verdad.
 *
 * `Number(null)` es 0 en JavaScript, así que `Number.isFinite(Number(v))` deja
 * pasar la ausencia: es exactamente el fallo que habría publicado un partido
 * en medio del Atlántico y que la 43c cerró en el servidor. Acá se mira la
 * ausencia primero, y además se rechaza el par (0, 0), que en esta app nunca
 * es una cancha sino la marca de que no se eligió ninguna.
 */
function esCoordenada(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function canchaEsIgual(a, b) {
  if (!a || !b) return false;
  return CLAVES_CANCHA.every((k) => a[k] === b[k]);
}

/**
 * Arma el `campos` que viaja a `proponer_cambio_partido`.
 *
 * SÓLO VIAJA LO QUE CAMBIA. Mandar el formulario entero convertiría cada
 * solicitud en «cambiar la hora de 17:00 a 17:00 y la cancha de Uno a Uno»:
 * el club contrario tendría que adivinar qué se le está pidiendo, y el evento
 * del chat sería ilegible.
 *
 * Devuelve `{ campos, error }`. `campos` es null cuando hay algo que corregir,
 * y `error` es el texto en español que la pantalla muestra tal cual.
 */
export function construirCampos({ partido, hora, cancha, cuota, ahora = new Date() } = {}) {
  const actual = partido || {};
  const campos = {};

  if (hora !== undefined && hora !== null && hora !== '') {
    const nueva = aFecha(hora);
    if (!nueva) return { campos: null, error: 'La hora propuesta no es una fecha válida.' };

    const vigente = aFecha(actual.hora);
    if (!vigente || nueva.getTime() !== vigente.getTime()) {
      const ref = aFecha(ahora) || new Date();
      if (nueva.getTime() - ref.getTime() <= MARGEN_MS) {
        return {
          campos: null,
          error: `La hora propuesta tiene que estar al menos ${MARGEN_CAMBIO_HORAS} horas más adelante.`,
        };
      }
      campos.hora = nueva.toISOString();
    }
  }

  if (cuota !== undefined && cuota !== null && cuota !== '') {
    if (!Number.isInteger(cuota) || cuota < 0 || cuota > 1000000) {
      return {
        campos: null,
        error: 'La cuota tiene que ser un monto entero entre 0 y 1.000.000.',
      };
    }
    if (cuota !== actual.precio_cuota) campos.cuota = cuota;
  }

  if (cancha) {
    for (const clave of CLAVES_CANCHA_TEXTO) {
      if (!esTextoConContenido(cancha[clave])) {
        return {
          campos: null,
          error: 'La cancha necesita nombre, dirección, comuna y región.',
        };
      }
    }
    if (!esCoordenada(cancha.latitud) || !esCoordenada(cancha.longitud)) {
      return { campos: null, error: 'Ubica la cancha en el mapa antes de proponerla.' };
    }
    if (cancha.latitud === 0 && cancha.longitud === 0) {
      return { campos: null, error: 'Ubica la cancha en el mapa antes de proponerla.' };
    }
    if (cancha.latitud < -90 || cancha.latitud > 90
        || cancha.longitud < -180 || cancha.longitud > 180) {
      return { campos: null, error: 'La ubicación de la cancha no es un punto válido del mapa.' };
    }

    const limpia = {};
    for (const clave of CLAVES_CANCHA) {
      limpia[clave] = typeof cancha[clave] === 'string' ? cancha[clave].trim() : cancha[clave];
    }
    if (!canchaEsIgual(limpia, actual.cancha)) campos.cancha = limpia;
  }

  if (Object.keys(campos).length === 0) {
    return { campos: null, error: 'Elige al menos un dato que quieras cambiar.' };
  }
  return { campos, error: null };
}

// ---------------------------------------------------------------------------
// El texto del hilo
// ---------------------------------------------------------------------------

function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

function horaCorta(d) {
  return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
}

function diaCorto(d) {
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

function mismoDia(a, b) {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

/**
 * Pesos chilenos con punto de miles, sin `Intl`.
 *
 * A mano y no con `toLocaleString`: Hermes puede venir sin los datos de
 * localización y devolvería «5,000», que en Chile se lee como cinco.
 */
export function montoCLP(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'gratis';
  return `$${Math.trunc(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function fraseHora(cambio) {
  const antes = aFecha(cambio.antes);
  const despues = aFecha(cambio.despues);
  if (!antes || !despues) return null;

  if (mismoDia(antes, despues)) {
    return `la hora de ${horaCorta(antes)} a ${horaCorta(despues)}`;
  }
  // Si se mueve el día, decir «la hora» sería engañoso: lo que cambió es
  // cuándo se juega, no a qué hora.
  return `la fecha de ${diaCorto(antes)} ${horaCorta(antes)} a ${diaCorto(despues)} ${horaCorta(despues)}`;
}

function fraseCancha(cambio) {
  if (!esTextoConContenido(cambio.antes) || !esTextoConContenido(cambio.despues)) return null;

  const cambiaComuna =
    esTextoConContenido(cambio.antes_comuna)
    && esTextoConContenido(cambio.despues_comuna)
    && cambio.antes_comuna !== cambio.despues_comuna;

  if (!cambiaComuna) return `la cancha de ${cambio.antes} a ${cambio.despues}`;
  return `la cancha de ${cambio.antes} (${cambio.antes_comuna}) a ${cambio.despues} (${cambio.despues_comuna})`;
}

function fraseCuota(cambio) {
  const antes = montoCLP(cambio.antes);
  const despues = montoCLP(cambio.despues);
  if (!antes || !despues) return null;
  return `la cuota de ${antes} a ${despues}`;
}

/**
 * Una frase por campo cambiado, en español.
 *
 * Un campo que este cliente todavía no conoce —una migración más nueva en el
 * servidor— se OMITE en vez de pintarse crudo. Vale más una frase corta que
 * «modalidad de futbol7 a futbol11» escrito en jerga de base de datos.
 */
export function frasesDeCambios(cambios) {
  if (!Array.isArray(cambios)) return [];
  const frases = [];
  for (const cambio of cambios) {
    if (!cambio || typeof cambio !== 'object') continue;
    let frase = null;
    if (cambio.campo === 'hora') frase = fraseHora(cambio);
    else if (cambio.campo === 'cancha') frase = fraseCancha(cambio);
    else if (cambio.campo === 'cuota') frase = fraseCuota(cambio);
    if (frase) frases.push(frase);
  }
  return frases;
}

/** «la hora de 17:00 a 18:00, la cancha de Uno a Dos y la cuota de $5.000 a $8.000» */
function enumerar(frases) {
  if (frases.length === 0) return '';
  if (frases.length === 1) return frases[0];
  return `${frases.slice(0, -1).join(', ')} y ${frases[frases.length - 1]}`;
}

/**
 * El sujeto de la frase: el CLUB primero y, si el servidor lo entregó, el
 * administrador.
 *
 * El club es lo que no puede faltar —un cambio lo pide un club, no una
 * persona— y el `username` es trazabilidad para los otros administradores del
 * hilo. Sale de `profiles` dentro de la RPC, nunca de lo que mande el cliente:
 * un nombre de actor enviado por quien actúa se puede escribir solo. En la
 * fila queda además `actor_id`, que es la auditoría de verdad.
 */
function sujetoDelEvento(club, username) {
  const nombre = esTextoConContenido(club) ? club : 'Un club';
  if (!esTextoConContenido(username)) return nombre;
  return `${nombre} (@${username.trim()})`;
}

/** «Club A (@vicente) propone cambiar la hora de 17:00 a 18:00.» */
export function textoCambioPropuesto(payload) {
  const sujeto = sujetoDelEvento(payload?.club_proponente_nombre, payload?.actor_username);
  const lista = enumerar(frasesDeCambios(payload?.cambios));
  if (!lista) return `${sujeto} propone un cambio en el partido.`;
  return `${sujeto} propone cambiar ${lista}.`;
}

/** «Club B (@juan) rechazó el cambio: «no tenemos arquero». El partido sigue igual.» */
export function textoCambioRespondido(payload) {
  const sujeto = sujetoDelEvento(payload?.club_responde_nombre, payload?.actor_username);

  if (payload?.aceptado === true) {
    const lista = enumerar(frasesDeCambios(payload?.cambios));
    return lista ? `${sujeto} aceptó el cambio: ${lista}.` : `${sujeto} aceptó el cambio.`;
  }
  if (payload?.aceptado === false) {
    // El motivo es opcional a propósito: obligar a escribirlo sólo consigue
    // que la gente ponga «no» para poder pulsar el botón.
    const motivo = esTextoConContenido(payload?.motivo) ? payload.motivo.trim() : null;
    return motivo
      ? `${sujeto} rechazó el cambio: «${motivo}». El partido sigue igual.`
      : `${sujeto} rechazó el cambio. El partido sigue igual.`;
  }
  return `${sujeto} respondió la solicitud de cambio.`;
}

// ---------------------------------------------------------------------------
// Lo que ve la interfaz
// ---------------------------------------------------------------------------

/** Cómo se llama cada campo en pantalla. */
const ETIQUETAS = { hora: 'Hora', cancha: 'Cancha', cuota: 'Cuota' };

function valorLegible(campo, valor) {
  if (valor === undefined || valor === null) return null;
  if (campo === 'cuota') return montoCLP(valor);
  if (campo === 'hora') {
    const d = aFecha(valor);
    return d ? `${diaCorto(d)} ${horaCorta(d)}` : null;
  }
  if (campo === 'cancha') {
    const nombre = esTextoConContenido(valor.cancha_nombre) ? valor.cancha_nombre.trim() : null;
    if (!nombre) return null;
    // La CALLE no entra: vive protegida en `club_match_locations` y ya se
    // muestra en el detalle a quien corresponde. Repetirla en una tarjeta que
    // se pinta en el hilo sería abrirle una segunda puerta.
    const comuna = esTextoConContenido(valor.comuna) ? valor.comuna.trim() : null;
    return comuna ? `${nombre} · ${comuna}` : nombre;
  }
  return null;
}

/**
 * Las filas «valor actual → valor propuesto» que dibuja la tarjeta.
 *
 * Se arman desde la fila de `club_match_changes` (`campos` y
 * `valores_anteriores`), no desde el evento del chat: la tarjeta tiene que
 * poder mostrarse aunque el hilo no se haya cargado.
 *
 * Cuando el cambio mueve el DÍA, la etiqueta pasa de «Hora» a «Fecha»: decir
 * «Hora: 17:00 → 18:00» escondería que el partido se corrió al día siguiente.
 */
export function filasDeComparacion(cambio) {
  const campos = cambio?.campos;
  if (!campos || typeof campos !== 'object') return [];
  const previos = cambio?.valores_anteriores && typeof cambio.valores_anteriores === 'object'
    ? cambio.valores_anteriores
    : {};

  const filas = [];
  for (const campo of CAMPOS_NEGOCIABLES) {
    if (!(campo in campos)) continue;

    let etiqueta = ETIQUETAS[campo];
    let antes = valorLegible(campo, previos[campo]);
    let despues = valorLegible(campo, campos[campo]);

    if (campo === 'hora') {
      const a = aFecha(previos[campo]);
      const d = aFecha(campos[campo]);
      if (a && d && mismoDia(a, d)) {
        antes = horaCorta(a);
        despues = horaCorta(d);
      } else {
        etiqueta = 'Fecha';
      }
    }

    filas.push({
      campo,
      etiqueta,
      antes: antes || 'sin registro',
      despues: despues || 'sin registro',
    });
  }
  return filas;
}

/**
 * Qué acciones corresponde ofrecer, y por qué no las demás.
 *
 * ESPEJO DE LA AUTORIZACIÓN DEL SERVIDOR, no la protección. Esconder un botón
 * no impide nada: `proponer_cambio_partido` y `responder_cambio_partido`
 * vuelven a comprobar membresías y plazo con los datos de PostgreSQL. Esto
 * existe para dos cosas: no ofrecer una acción que el servidor va a rechazar,
 * y poder EXPLICAR por qué no está disponible en vez de dejar un hueco.
 *
 * `clubesAdmin` son los clubes del partido donde soy administrador;
 * `clubesTodos`, todas mis membresías en esos dos clubes con cualquier rol. La
 * diferencia importa: la regla estricta de la 43d prohíbe responder un cambio
 * de un club al que uno pertenece aunque sea como jugador.
 */
export function accionesDeCambio({
  partido = null,
  cambio = null,
  userId = null,
  clubesAdmin = [],
  clubesTodos = [],
  ahora = new Date(),
} = {}) {
  const p = partido || {};
  const delPartido = [p.club_local_id, p.club_visitante_id].filter(Boolean);
  const admin = (Array.isArray(clubesAdmin) ? clubesAdmin : [])
    .filter((id) => id && delPartido.includes(id));
  const todos = [
    ...new Set([
      ...admin,
      ...(Array.isArray(clubesTodos) ? clubesTodos : []).filter(Boolean),
    ]),
  ];

  const esDeClubes = !!p.challenge_proposal_id && delPartido.length === 2;
  const administroLosDos = admin.length > 1;
  const soyAdmin = admin.length > 0;
  const miClubId = admin.length === 1 ? admin[0] : null;

  const pendiente = cambio && cambio.estado === 'pendiente' ? cambio : null;
  const hayPendiente = !!pendiente;
  const esMiSolicitud = !!pendiente && !!userId && pendiente.propuesto_por === userId;

  const salida = {
    esDeClubes,
    soyAdmin,
    administroLosDos,
    miClubId,
    hayPendiente,
    esMiSolicitud,
    pendiente,
    puedePedir: false,
    bloqueoPedir: null,
    puedeResponder: false,
    bloqueoResponder: null,
  };

  if (!esDeClubes) return salida;

  const abierto = p.estado === 'abierto' || p.estado === 'lleno';
  const enPlazo = puedePedirCambios(p.hora, ahora);
  const AMBOS_CLUBES =
    'Administras los dos clubes de este partido: no puedes pedir un cambio en nombre de uno y responderlo en nombre del otro.';
  const FUERA_DE_PLAZO = `Faltan menos de ${MARGEN_CAMBIO_HORAS} horas para el partido: ya no se pueden pedir cambios.`;

  if (!soyAdmin) {
    salida.bloqueoPedir = 'Solo un administrador de alguno de los dos clubes puede pedir cambios.';
  } else if (administroLosDos) {
    salida.bloqueoPedir = AMBOS_CLUBES;
  } else if (!abierto) {
    salida.bloqueoPedir = 'Este partido ya no admite cambios.';
  } else if (!enPlazo) {
    salida.bloqueoPedir = FUERA_DE_PLAZO;
  } else if (hayPendiente) {
    salida.bloqueoPedir = 'Ya hay una solicitud esperando respuesta.';
  }
  salida.puedePedir = !salida.bloqueoPedir;

  if (hayPendiente) {
    const AJENO = 'Solo un administrador del club contrario puede responder este cambio.';
    if (!soyAdmin) {
      salida.bloqueoResponder = AJENO;
    } else if (esMiSolicitud) {
      salida.bloqueoResponder = 'No puedes responder tu propia solicitud: la responde el club contrario.';
    } else if (administroLosDos) {
      salida.bloqueoResponder = AMBOS_CLUBES;
    } else if (miClubId === pendiente.club_proponente_id) {
      salida.bloqueoResponder = AJENO;
    } else if (todos.includes(pendiente.club_proponente_id)) {
      salida.bloqueoResponder = 'No puedes responder un cambio pedido por un club al que perteneces.';
    } else if (!abierto) {
      salida.bloqueoResponder = 'Este partido ya no admite cambios.';
    } else if (!enPlazo) {
      salida.bloqueoResponder = `Faltan menos de ${MARGEN_CAMBIO_HORAS} horas para el partido: esta solicitud ya no puede aplicarse.`;
    }
    salida.puedeResponder = !salida.bloqueoResponder;
  }

  return salida;
}
