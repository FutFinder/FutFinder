/**
 * «Vengo a reservar la cancha de ESTE partido».
 *
 * EL PROBLEMA: entre tocar «Reservar la cancha» en un desafío de clubes y
 * llegar al resumen hay cinco pantallas —buscar recinto, verlo, elegir
 * cancha, elegir hora, resumen— y ninguna tiene por qué saber de clubes.
 * Pasar el partido como parámetro obligaría a que las cinco lo arrastren, y
 * la que lo olvide rompe el flujo sin decir nada.
 *
 * Por eso la intención se guarda una vez y la lee solo quien la necesita.
 *
 * SE VE SIEMPRE. El resumen muestra un aviso con el nombre del partido y un
 * botón para soltarla: una intención invisible que cambia lo que se está
 * creando sería exactamente el tipo de magia que hace desconfiar de una app
 * cuando hay plata de por medio.
 *
 * Y CADUCA. Si alguien empieza desde el desafío, se distrae y media hora
 * después reserva una cancha cualquiera, esa reserva NO tiene por qué ser
 * del partido. Media hora es de sobra para recorrer cinco pantallas y corta
 * antes de que la intención se vuelva una sorpresa.
 */

/** Media hora: alcanza para el flujo y no llega al día siguiente. */
export const VIGENCIA_MS = 30 * 60 * 1000;

let intencion = null;

/** Guarda a qué partido pertenece la reserva que se va a crear. */
export function guardarIntencion(datos, ahora = Date.now()) {
  if (!datos || !datos.matchId) return null;
  intencion = {
    matchId: datos.matchId,
    titulo: datos.titulo || null,
    clubRival: datos.clubRival || null,
    capitanRival: datos.capitanRival || null,
    horaPartido: datos.horaPartido || null,
    guardadaEn: ahora,
  };
  return intencion;
}

/** La intención vigente, o `null` si no hay o ya caducó. */
export function leerIntencion(ahora = Date.now()) {
  if (!intencion) return null;
  if (ahora - intencion.guardadaEn > VIGENCIA_MS) {
    intencion = null;
    return null;
  }
  return intencion;
}

/** La suelta: al usarla, al cancelarla, o al salirse del flujo. */
export function olvidarIntencion() {
  intencion = null;
}

/**
 * Si la hora elegida calza con la del partido.
 *
 * NO BLOQUEA, AVISA. El recinto puede no tener libre la hora exacta del
 * desafío, y obligar a que calcen dejaría sin reservar a quien igual quiere
 * la cancha —y después mueve el partido—. Pero reservar las 20:00 para un
 * partido de las 19:00 y no enterarse hasta el día del encuentro es peor que
 * cualquier aviso.
 */
export function calzaConElPartido(horaPartido, fechaIso, horaInicio) {
  if (!horaPartido || !fechaIso || !horaInicio) return null;
  const partido = new Date(horaPartido);
  if (Number.isNaN(partido.getTime())) return null;
  const [h, m] = String(horaInicio).split(':').map(Number);
  const [a, me, d] = String(fechaIso).split('-').map(Number);
  if (![h, m, a, me, d].every(Number.isFinite)) return null;
  const elegida = new Date(a, me - 1, d, h, m);
  return elegida.getTime() === partido.getTime();
}
