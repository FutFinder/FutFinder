/**
 * Dividir la cuenta de una cancha entre los que van a jugar.
 *
 * LA REGLA QUE ORDENA TODO LO DEMÁS: el pago dividido es SOLO con Balance.
 * No es una limitación técnica, es la decisión que hace simple el resto.
 *
 * Con Balance nadie pone plata hasta el final: cada uno autoriza su cuota y
 * el cobro ocurre entero, a todos a la vez, cuando el grupo está completo.
 * De ahí salen las tres cosas que esta pantalla puede prometer sin mentir:
 *
 *   · La cancha NO se retiene mientras se arma. Gana el grupo que complete
 *     primero. Por eso el texto nunca dice «tu hora está reservada» antes de
 *     tiempo: decirlo sería prometer algo que el servidor no garantiza.
 *   · Si alguien no paga, NO HAY NADA QUE DEVOLVER. Nadie perdió plata.
 *   · Nadie tiene que tipear una tarjeta para poner su parte.
 *
 * Los números de plata se calculan igual que en el servidor (`ceil` de la
 * división), y `avanceDeGrupo` se LEE de `detalle_reserva`, no se deduce: el
 * servidor es el que sabe quién tiene autorización vigente por la cuota
 * vigente, y un recálculo de cuota invalida autorizaciones sin que la
 * pantalla se entere.
 *
 * El redondeo y el formato de plata NO se reescriben acá: salen de
 * `reservasRules`, que ya los tenía y que es lo que usa el resto del
 * vertical. Una segunda copia de `ceil(total / n)` es exactamente la forma
 * de que un día el botón diga $6.000 y el servidor conteste «El monto no
 * coincide con la cuota vigente».
 */
import { JUGADORES_LIMITS, computeCuota, formatCLP } from '../services/reservasRules.js';

export const MIN_JUGADORES = JUGADORES_LIMITS.min;
export const MAX_JUGADORES = JUGADORES_LIMITS.max;

/** Lo que le toca a cada uno, con las medidas ya validadas. */
export function cuotaPara(precioTotal, nJugadores) {
  // `Number(null)` y `Number('')` son 0, no NaN: sin este corte, una reserva
  // a la que todavía no le llegó el precio reparte «$0 cada uno», que se ve
  // como un dato verdadero y no como un dato que falta.
  if (precioTotal === null || precioTotal === undefined || precioTotal === '') return null;
  const total = Number(precioTotal);
  const n = Math.trunc(Number(nJugadores));
  if (!Number.isFinite(total) || total < 0) return null;
  if (!Number.isFinite(n) || n < MIN_JUGADORES) return null;
  return computeCuota(total, n);
}

/**
 * El reparto completo, con el excedente a la vista.
 *
 * `ceil` hace que la suma de las cuotas quede unos pesos POR ENCIMA del
 * total cuando la división no es exacta ($18.001 entre 3 son $6.001 cada uno,
 * o sea $6.003). Es la misma cuenta que hace el servidor, y se devuelve el
 * excedente en vez de esconderlo: la pantalla que muestra «$6.001 c/u» al
 * lado de «total $18.001» tiene que poder explicar los dos pesos si alguien
 * los suma. Nadie paga de menos; el redondeo nunca va contra el jugador.
 */
export function repartoDeCuotas(precioTotal, nJugadores) {
  const cuota = cuotaPara(precioTotal, nJugadores);
  if (cuota === null) return null;
  const n = Math.trunc(Number(nJugadores));
  const suma = cuota * n;
  return { cuota, n, suma, total: Number(precioTotal), excedente: suma - Number(precioTotal) };
}

/** Las opciones que ofrece el selector, sin pasarse del tipo de cancha. */
export function opcionesDeReparto(precioTotal, maximo = MAX_JUGADORES) {
  const tope = Math.min(MAX_JUGADORES, Math.max(MIN_JUGADORES, Math.trunc(Number(maximo)) || MIN_JUGADORES));
  const out = [];
  for (let n = MIN_JUGADORES; n <= tope; n += 1) {
    const r = repartoDeCuotas(precioTotal, n);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Las palabras de cada modalidad.
 *
 * SON DOS FLUJOS CON LA MISMA MÁQUINA. El servidor los trata casi igual
 * —cada uno autoriza su cuota y el último confirma— pero para la persona no
 * son lo mismo: en 'capitanes' no invitas a un grupo, eliges a UNA persona, y
 * esa persona representa al otro equipo. Llamarle «invitar jugadores» a eso
 * haría pensar que después vienen más.
 *
 * CAPITANES SON DOS, NUNCA TRES. Con tres, la mitad deja de ser una mitad y
 * el reparto se complica sin que nadie gane nada: para eso está «lo
 * dividimos entre todos», que ya reparte entre los que sean. El servidor lo
 * sostiene desde la migración 55 («Ya hay un segundo capitán invitado») y acá
 * el cupo es 1 para que ni siquiera se pueda marcar a un tercero.
 */
const TEXTOS = {
  capitanes: {
    rol: 'capitan',
    cupos: 2,
    invitar: 'Elegir al otro capitán',
    tituloInvitar: 'El otro capitán',
    ayudaInvitar: 'Va a pagar la mitad de la cancha. Son dos capitanes y no más.',
    quienes: 'Los dos capitanes',
    faltaUno: 'Falta el otro capitán',
  },
  jugadores: {
    rol: 'jugador',
    cupos: null,
    invitar: 'Invitar jugadores',
    tituloInvitar: 'Invitar jugadores',
    ayudaInvitar: 'Cada uno pone su parte. La cancha se cierra cuando estén todos.',
    quienes: 'Quiénes van',
    faltaUno: 'Falta 1 jugador',
  },
};

export function textosDeModalidad(modalidad) {
  return TEXTOS[modalidad] || TEXTOS.jugadores;
}

/** Una fila de `detalle_reserva().participantes` con nombres de pantalla. */
export function comoParticipante(p) {
  if (!p) return null;
  return {
    userId: p.user_id,
    nombre: p.username || 'Jugador',
    fotoUrl: p.foto_url || null,
    rol: p.rol,
    estado: p.estado,
    montoAutorizado: p.monto_autorizado ?? null,
    listo: !!p.listo,
    soyYo: !!p.soy_yo,
  };
}

/** La respuesta de `detalle_reserva` con los nombres que usa la pantalla. */
export function comoDetalle(json) {
  if (!json || !json.ok) return null;
  const r = json.reserva || {};
  const k = json.cancha || {};
  return {
    id: r.id,
    fecha: r.fecha,
    horaInicio: String(r.hora_inicio || '').slice(0, 5),
    horaFin: String(r.hora_fin || '').slice(0, 5),
    inicio: r.inicio,
    estado: r.estado,
    modalidad: r.modalidad,
    medioPago: r.medio_pago,
    precioTotal: r.precio_total,
    nJugadores: r.n_jugadores,
    cuota: r.cuota,
    organizadorId: r.organizador_id,
    canchaNombre: k.nombre,
    canchaTipo: k.tipo,
    complejoId: k.complejo_id,
    complejoNombre: k.complejo_nombre,
    direccion: k.complejo_direccion,
    comuna: k.complejo_comuna,
    fotoUrl: k.complejo_foto_url,
    soyOrganizador: !!json.soy_organizador,
    miEstado: json.mi_estado || null,
    miListo: !!json.mi_listo,
    participantes: (json.participantes || []).map(comoParticipante).filter(Boolean),
    cupos: json.cupos ?? 0,
    listos: json.listos ?? 0,
    enReserva: json.en_reserva ?? 0,
    faltanInvitar: json.faltan_invitar ?? 0,
    faltanAutorizar: json.faltan_autorizar ?? 0,
  };
}

/**
 * El avance, en una frase.
 *
 * Se dice «2 de 3 pusieron su parte», no «falta 1»: el número grande es el
 * que da la sensación de que esto avanza, y el que falta se ve igual en la
 * lista de abajo con su nombre.
 */
export function avanceDeGrupo(detalle) {
  if (!detalle) return null;
  const { listos = 0, cupos = 0, faltanInvitar = 0, faltanAutorizar = 0 } = detalle;
  const completo = cupos > 0 && listos >= cupos;
  let texto;
  const t = textosDeModalidad(detalle.modalidad);
  if (completo) texto = 'Todos pusieron su parte';
  else if (faltanInvitar > 0 && listos === 0) {
    texto = detalle.modalidad === 'capitanes'
      ? t.faltaUno
      : `Invita a ${faltanInvitar} ${faltanInvitar === 1 ? 'jugador' : 'jugadores'} más`;
  } else texto = `${listos} de ${cupos} pusieron su parte`;
  return { listos, cupos, completo, faltanInvitar, faltanAutorizar, texto };
}

/**
 * Qué puede hacer AHORA la persona que está mirando.
 *
 * Una sola acción principal por vez. La pantalla del organizador y la del
 * invitado son la misma; lo que cambia es esto.
 */
export function miAccion(detalle) {
  if (!detalle) return null;
  if (detalle.estado === 'confirmada') return { clave: 'listo', label: 'Reserva confirmada' };
  if (detalle.estado !== 'armando' && detalle.estado !== 'procesando') return null;

  if (!detalle.miListo && detalle.miEstado !== 'rechazado') {
    return { clave: 'autorizar', label: `Poner mi parte · ${formatCLP(detalle.cuota)}` };
  }
  if (detalle.soyOrganizador && detalle.faltanInvitar > 0) {
    return { clave: 'invitar', label: textosDeModalidad(detalle.modalidad).invitar };
  }
  return { clave: 'esperar', label: 'Esperando a los demás' };
}

/** La etiqueta de cada fila de la nómina. */
export function etiquetaDeParticipante(p) {
  if (!p) return null;
  if (p.estado === 'rechazado') return { texto: 'No va', tono: 'neutral' };
  if (p.listo) return { texto: 'Puso su parte', tono: 'green' };
  // «Reconfirmar» solo si de verdad HUBO una confirmación antes. El
  // organizador entra como 'aceptado' desde que crea la reserva, sin haber
  // puesto nada: decirle «falta reconfirmar» en una reserva recién creada lo
  // manda a buscar algo que nunca hizo. `montoAutorizado` es lo que
  // distingue «nunca puso» de «puso un monto que ya no sirve».
  if (p.estado === 'aceptado' && p.montoAutorizado != null) {
    return { texto: 'Falta reconfirmar', tono: 'amber' };
  }
  return { texto: 'Falta su parte', tono: 'amber' };
}

/** El organizador solo puede empujar si de verdad falta alguien. */
export function puedeRecordar(detalle) {
  return !!(detalle && detalle.soyOrganizador && detalle.estado === 'armando'
    && detalle.faltanAutorizar > 0 && detalle.enReserva > 1);
}

/** Y solo puede sacar a alguien que no sea él mismo, mientras se arma. */
export function puedeQuitar(detalle, participante) {
  return !!(detalle && participante && detalle.soyOrganizador
    && detalle.estado === 'armando' && !participante.soyYo
    && participante.userId !== detalle.organizadorId);
}

/**
 * Los motivos del servidor, en chileno.
 *
 * `ocupado` es el que más importa: la persona hizo todo bien y perdió la
 * hora igual, así que el texto tiene que decir de inmediato lo único que la
 * tranquiliza —que no se le cobró nada— antes de proponerle otra cosa.
 */
const MOTIVOS = {
  ocupado: 'Justo tomaron esa hora. No se te cobró nada: elige otro horario.',
  cupos_llenos: 'Ya invitaste a todos los cupos. Saca a alguien o cambia entre cuántos se divide.',
  saldo_insuficiente: 'A alguien del grupo no le alcanza el saldo. Todavía no se cobró nada.',
  faltan_jugadores: 'Falta gente por sumarse.',
  falta_capitan: 'Falta el segundo capitán.',
  autorizacion_pendiente: 'Falta que alguien ponga su parte.',
  error_al_confirmar: 'No se pudo cerrar la reserva. No se cobró nada: vuelve a intentar.',
};

export function motivoLegible(reason) {
  if (!reason) return null;
  return MOTIVOS[reason] || reason;
}
