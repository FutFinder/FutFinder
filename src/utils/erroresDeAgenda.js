/**
 * El error que levanta el servidor cuando mover un partido dejaría a un
 * inscrito con dos partidos a la misma hora (migración 123).
 *
 * POR QUÉ SE TRADUCE ACÁ Y NO EN CADA PANTALLA. El mismo `update` sale por dos
 * puertas —la edición de un partido normal y la aceptación de un cambio
 * acordado entre clubes— y las dos tienen que decir lo mismo. El servidor
 * manda una frase en español Y el código con el número de afectados: la frase
 * es para las versiones de la app que no conocen este caso (no hay OTA), y el
 * código es lo que se busca acá para poner un texto que además explique la
 * salida.
 */

const PATRON = /CHOQUE_AGENDA_INSCRITOS:(\d+)/;

/**
 * Devuelve el mensaje para el organizador, o `null` si el error es otro.
 *
 * Acepta tanto el objeto de error de Supabase como el texto pelado.
 */
export function traducirChoqueDeAgenda(error) {
  if (!error) return null;
  const msg = typeof error === 'string' ? error : String(error.message || '');
  const m = msg.match(PATRON);
  if (!m) return null;

  const n = Number(m[1]);
  const quienes =
    n === 1
      ? 'Un jugador inscrito ya tiene otro partido a esa hora'
      : `${n} jugadores inscritos ya tienen otro partido a esa hora`;
  return `${quienes}. Elige otro horario, o sácalo del plantel antes de mover el partido.`;
}
