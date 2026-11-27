/**
 * Qué muestra la tarjeta de la cancha en el chat del desafío (migración 202,
 * diseño «Clubes (preservas)», variante A).
 *
 * Recibe lo que devuelve `cancha_del_desafio()` y decide UNA vista. Es puro y
 * está probado para que la pantalla no repita la cuenta: quién ve botones y
 * quién sólo el estado es una regla de plata, no de estilo.
 *
 *   elegir          negociación, local que dirige: «Ver canchas» y «Reservar
 *                   cancha para este partido» (que elige cancha para la
 *                   propuesta; se paga después de aprobar).
 *   espera_local    negociación, visitante: reserva el club local.
 *   solo_lectura    negociación, alguien sin permiso.
 *   cancha_elegida  la propuesta lleva una cancha de FutFinder, sin pagar.
 *   reservar_ahora  partido publicado, cancha elegida: un toque.
 *   reservar        partido publicado, sin cancha elegida: buscar.
 *   pagar_local     hay reserva y el local todavía no pone su mitad.
 *   falta_rival     el local pagó; corre el reloj del rival.
 *   pagar_mi_mitad  el capitán rival, con su reloj.
 *   confirmada      pagaron los dos.
 *
 * `null` cuando no corresponde tarjeta: desafío cerrado, ya jugado, o datos
 * que no llegaron.
 */

const ESTADOS_CON_CANCHA = ['negociacion', 'esperando_aprobacion', 'publicado', 'en_juego'];

export function vistaDeLaCancha(info) {
  if (!info || !info.ok) return null;
  const estado = info.estado_desafio;
  if (!ESTADOS_CON_CANCHA.includes(estado)) return null;

  const local = info.club_local?.nombre || 'El club local';
  const r = info.reserva;
  const viva = r && ['armando', 'procesando', 'confirmada'].includes(r.estado);

  if (viva) {
    if (r.estado === 'confirmada') return { tipo: 'confirmada' };
    if (!r.pago_local) {
      return info.soy_local ? { tipo: 'pagar_local' } : { tipo: 'falta_local', texto: `${local} todavía no paga su mitad.` };
    }
    if (info.soy_capitan_rival && !r.pago_rival) return { tipo: 'pagar_mi_mitad' };
    return { tipo: 'falta_rival' };
  }

  if (estado === 'en_juego') return null;

  if (estado === 'publicado') {
    if (info.puedo_reservar) {
      return info.cancha_elegida ? { tipo: 'reservar_ahora' } : { tipo: 'reservar' };
    }
    if (info.soy_visitante) {
      return { tipo: 'espera_local', texto: `${local} reserva la cancha. Cuando reserve, aquí te aparece «Pagar mi mitad».` };
    }
    return { tipo: 'solo_lectura', texto: 'Aún no hay cancha reservada. Solo un administrador o capitán del club local puede reservarla.' };
  }

  // Negociación o esperando aprobación.
  if (info.cancha_elegida) return { tipo: 'cancha_elegida' };
  if (estado === 'negociacion' && info.puedo_elegir) return { tipo: 'elegir' };
  if (info.soy_visitante) {
    return { tipo: 'espera_local', texto: `El club local (${local}) reserva la cancha. Te avisamos cuando te toque pagar tu mitad.` };
  }
  return { tipo: 'solo_lectura', texto: 'Aún no hay cancha reservada. Solo un administrador o capitán del club local puede reservarla.' };
}

/** Segundos que quedan del plazo, o `null` si no hay plazo. Nunca negativo. */
export function restanteDelPlazo(plazoIso, ahora = Date.now()) {
  if (!plazoIso) return null;
  const fin = Date.parse(plazoIso);
  if (Number.isNaN(fin)) return null;
  return Math.max(0, Math.floor((fin - ahora) / 1000));
}

/** 760 → '12:40'. */
export function formatoReloj(segundos) {
  const s = Math.max(0, Math.floor(segundos || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * El día y la hora LOCALES de la propuesta, como los pide Reservas
 * ('YYYY-MM-DD' y 'HH:MM'). La propuesta guarda un instante (timestamptz);
 * la grilla del recinto habla en hora de reloj.
 */
export function bloqueDeLaPropuesta(fechaIso) {
  if (!fechaIso) return null;
  const d = new Date(fechaIso);
  if (Number.isNaN(d.getTime())) return null;
  const dos = (n) => String(n).padStart(2, '0');
  return {
    fecha: `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`,
    hora: `${dos(d.getHours())}:${dos(d.getMinutes())}`,
  };
}

/**
 * El bloque de esa hora en la grilla de disponibilidad, o `null`. Compara
 * por 'HH:MM' porque la base a veces trae los segundos.
 */
export function bloqueALaHora(horas, hora) {
  if (!hora) return null;
  return (horas || []).find((h) => String(h.hora).slice(0, 5) === String(hora).slice(0, 5)) || null;
}
