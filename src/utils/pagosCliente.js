/**
 * La lectura del estado de un pago, del lado del jugador.
 *
 * Está separado de la pantalla porque acá vive la decisión más delicada de
 * todo el flujo de pago: CUÁNDO SE DEJA DE ESPERAR. Entre que alguien paga
 * en Flow y el aviso llega a nuestra base pasan segundos, y la persona
 * vuelve a la app antes que el aviso. Si la pantalla dijera «no se pudo» en
 * ese hueco, estaría mintiéndole a alguien a quien acaban de cobrarle.
 *
 * Por eso ningún estado intermedio se muestra como fracaso: mientras el pago
 * siga `pendiente`, o esté `pagado` pero la reserva todavía no se haya
 * confirmado, la respuesta es «esperando». El fracaso tiene que venir escrito
 * en la base, no deducido de que todavía no llegó.
 */

/** Fases de la pantalla de pago. La pantalla no inventa otras. */
export const FASES = [
  'preparando',   // pidiéndole a la base y a Flow que armen el pago
  'pagando',      // el jugador está en Flow
  'esperando',    // volvió y todavía no llega el aviso
  'confirmada',   // pagado y la cancha es suya
  'devolver',     // pagó y el bloque se lo llevó otro: hay que devolverle
  'rechazada',    // el banco dijo que no
  'expirada',     // nunca se pagó
  'nodisponible', // la pasarela todavía no está conectada
  'error',
];

/**
 * En qué quedó, mirando el pago Y la reserva.
 *
 * Se miran los dos porque ninguno solo alcanza: un pago `pagado` con la
 * reserva sin confirmar es el instante entre las dos escrituras de
 * `confirmar_pago`, no un éxito; y una reserva `confirmada` sin pago visible
 * es una reserva que se pagó por otro lado.
 */
export function faseDePago(pago, reserva) {
  if (reserva?.estado === 'confirmada') return 'confirmada';
  if (!pago) return reserva ? 'esperando' : 'error';

  switch (pago.estado) {
    case 'reversar':
    case 'reversado':
      return 'devolver';
    case 'fallido':
      return 'rechazada';
    case 'expirado':
      return 'expirada';
    case 'pagado':
      // Pagado pero la reserva todavía no dice confirmada: o es el instante
      // entre las dos escrituras, o la reserva quedó rechazada y el pago
      // alcanzó a marcarse antes. Lo segundo se ve abajo.
      return reserva?.estado === 'rechazada' ? 'devolver' : 'esperando';
    case 'pendiente':
    default:
      return 'pagando';
  }
}

/** Si todavía tiene sentido volver a preguntar. */
export function sigueEsperando(fase) {
  return fase === 'pagando' || fase === 'esperando' || fase === 'preparando';
}

/**
 * Cada cuánto volver a preguntar, en milisegundos.
 *
 * Arranca rápido y se va soltando: los primeros segundos después de volver
 * de Flow son cuando llega el aviso, y después ya no vale la pena castigar
 * la batería. Techo de 10 s.
 */
export function esperaSiguiente(intento) {
  const n = Number.isFinite(intento) && intento > 0 ? Math.floor(intento) : 0;
  return Math.min(2000 + n * 1000, 10000);
}

/**
 * Después de tanto rato sin noticias, dejar de insistir y decirlo.
 *
 * No es un fracaso del pago —puede haber salido perfecto— es que no vamos a
 * seguir mirando la pantalla. El texto tiene que dejar clarísima esa
 * diferencia.
 */
export const MINUTOS_MAX_ESPERA = 5;

export function seAcaboLaEspera(msEsperando) {
  return msEsperando >= MINUTOS_MAX_ESPERA * 60 * 1000;
}

const TEXTOS = {
  preparando: {
    tono: 'info',
    titulo: 'Preparando el pago',
    cuerpo: 'Un segundo, estamos armando el cobro.',
  },
  pagando: {
    tono: 'info',
    titulo: 'Te llevamos a pagar',
    cuerpo: 'Termina el pago en la ventana que se abrió y vuelve acá. Dejamos esta pantalla '
      + 'esperando; no la cierres.',
  },
  esperando: {
    tono: 'info',
    titulo: 'Confirmando con el banco',
    cuerpo: 'Ya recibimos tu vuelta y estamos esperando la confirmación. Suele tardar unos '
      + 'segundos.',
  },
  confirmada: {
    tono: 'success',
    titulo: 'La cancha es tuya',
    cuerpo: 'Pago confirmado y horario tomado. Puedes cancelar con devolución hasta 12 horas '
      + 'antes del partido.',
  },
  devolver: {
    tono: 'warning',
    titulo: 'Te devolvemos el pago',
    cuerpo: 'Otro grupo confirmó ese horario justo antes que tú. El cobro se revierte completo, '
      + 'sin descuentos. Puede tardar unos días hábiles en volver a tu tarjeta.',
  },
  rechazada: {
    tono: 'warning',
    titulo: 'El pago no se completó',
    cuerpo: 'El banco rechazó el cobro y no se te descontó nada. Puedes intentar de nuevo: la '
      + 'hora sigue disponible.',
  },
  expirada: {
    tono: 'warning',
    titulo: 'Se venció el enlace de pago',
    cuerpo: 'Pasó mucho rato y el cobro se anuló. No se te descontó nada y puedes volver a '
      + 'intentarlo.',
  },
  nodisponible: {
    tono: 'warning',
    titulo: 'Todavía no se puede pagar',
    cuerpo: 'La pasarela de pago aún no está conectada, así que esta reserva no se puede '
      + 'completar. Es lo único que falta.',
  },
  error: {
    tono: 'warning',
    titulo: 'No pudimos iniciar el pago',
    cuerpo: 'Algo falló antes de cobrarte. No se te descontó nada.',
  },
};

/** El título y el texto de una fase. Nunca devuelve vacío. */
export function textoDeFase(fase) {
  return TEXTOS[fase] || TEXTOS.error;
}

/**
 * Qué ofrece el botón principal según cómo quedó.
 *
 * `null` cuando no hay nada que ofrecer: mientras se espera, el único botón
 * sería «apurar», y no existe.
 */
export function accionDeFase(fase) {
  // Ojo: dice «volver al inicio» y no «ver mi reserva» porque TODAVÍA NO HAY
  // pantalla donde el jugador vea sus reservas. Prometer un destino que no
  // existe es peor que no ofrecerlo; el día que exista, esto cambia acá.
  if (fase === 'confirmada') return { label: 'Volver al inicio', accion: 'inicio' };
  if (fase === 'rechazada' || fase === 'expirada') return { label: 'Intentar de nuevo', accion: 'reintentar' };
  if (fase === 'devolver' || fase === 'error') return { label: 'Volver a buscar cancha', accion: 'buscar' };
  if (fase === 'nodisponible') return { label: 'Volver', accion: 'atras' };
  return null;
}
