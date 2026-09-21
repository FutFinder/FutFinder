/**
 * Paginación del buscador de partidos: el cursor, la mezcla de páginas y el
 * resultado de «Ver más partidos».
 *
 * Vive acá, sin importar nada de Supabase, para poder probarse: `matches.js`
 * arrastra el cliente y con él media aplicación.
 *
 * ── POR QUÉ UN CURSOR COMPUESTO (hora, id) ────────────────────────────────
 *
 * El cursor era sólo `hora`, y la página siguiente pedía `hora > últimaHora`.
 * Dos partidos a EXACTAMENTE la misma hora, uno al final de una página y el
 * otro al principio de la siguiente, y el segundo desaparece: la desigualdad
 * estricta lo excluye por empatar. No hacen falta más empatados que una
 * página, como decía el comentario viejo: bastan DOS si caen justo en el
 * límite. Y a las 20:00 en punto de un sábado eso no es una rareza.
 *
 * El arreglo es ordenar y paginar por el mismo par: `(hora, id)`. El `id` no
 * significa nada para el usuario, pero es único y estable, que es todo lo que
 * un desempate necesita. La condición equivalente a «después de este» pasa a
 * ser `hora > h OR (hora = h AND id > i)`.
 *
 * LOS VALORES VAN ENTRE COMILLAS DOBLES. Dentro de un `or=(...)` de PostgREST
 * la coma y el paréntesis separan términos; un timestamp con zona no los trae,
 * pero comillarlo es lo que hace que eso siga siendo cierto mañana.
 */

/** El punto desde donde seguir, o `null` si no hay desde dónde. */
export function cursorDePartido(match) {
  if (!match?.hora || !match?.id) return null;
  return { hora: match.hora, id: match.id };
}

/** El cursor de una página ya cargada: su último elemento. */
export function cursorDePagina(matches = []) {
  if (!Array.isArray(matches) || matches.length === 0) return null;
  return cursorDePartido(matches[matches.length - 1]);
}

/**
 * Ordena por `(hora, id)` y, si hay cursor, deja fuera lo ya entregado.
 *
 * El orden y el cursor se aplican juntos a propósito: si alguien cambia uno
 * sin el otro, la paginación vuelve a perder filas y nadie se entera.
 */
export function aplicarOrdenYCursor(q, cursor = null) {
  let out = q.order('hora', { ascending: true }).order('id', { ascending: true });
  if (cursor?.hora && cursor?.id) {
    out = out.or(
      `hora.gt."${cursor.hora}",and(hora.eq."${cursor.hora}",id.gt."${cursor.id}")`
    );
  }
  return out;
}

/** Suma la página nueva a la que ya está en pantalla, sin repetir partidos. */
export function mezclarPagina(previos = [], nuevos = []) {
  const vistos = new Set((previos || []).map((m) => m.id));
  return [...(previos || []), ...(nuevos || []).filter((m) => m && !vistos.has(m.id))];
}

/**
 * Qué queda en pantalla después de pedir la página siguiente.
 *
 * ── POR QUÉ ESTO NO ES UN `if` EN LA PANTALLA ─────────────────────────────
 *
 * «Falló la consulta» y «no hay más resultados» terminaban en el mismo estado:
 * `hayMas = false` y el botón desaparecía. El usuario quedaba con 50 partidos
 * de 200 creyendo que eran todos, sin error, sin reintento y sin forma de
 * notar la diferencia. Son dos cosas distintas y acá se separan:
 *
 *   · con error   → la lista no se toca, `hayMas` se conserva y se devuelve el
 *                   error para poder ofrecer «reintentar». El cursor sigue
 *                   siendo el mismo, así que el reintento pide la misma página
 *                   y no recarga toda la búsqueda.
 *   · sin error   → se mezcla la página y manda el `hayMas` del servidor.
 */
export function resultadoDeCargarMas({ previos = [], hayMasPrevio = true, res } = {}) {
  if (!res || res.error) {
    return {
      matches: previos,
      hayMas: hayMasPrevio,
      error: res?.error || { message: 'No pudimos cargar más partidos.' },
    };
  }
  return {
    matches: mezclarPagina(previos, res.data || []),
    hayMas: !!res.hayMas,
    error: null,
  };
}

/**
 * Un turno por búsqueda, para que una respuesta vieja no pise a la nueva.
 *
 * EL FALLO: se buscaba por la comuna A, el usuario cambiaba a B antes de que
 * llegara, y si A llegaba después se quedaba con los partidos de A mientras
 * los filtros decían B. El filtrado local los descartaba todos y la pantalla
 * mostraba «no hay partidos» aunque B tuviera. La caché también se escribía
 * con la respuesta equivocada. Cancelar el temporizador del debounce no
 * alcanza: la solicitud que ya salió no se cancela sola.
 *
 * Cada búsqueda pide su turno antes de salir y sólo escribe si al volver
 * sigue siendo la última.
 *
 * No es sólo del buscador: cualquier pantalla que pueda tener dos cargas en
 * el aire a la vez —«reintentar» sobre una que todavía viene, por ejemplo—
 * necesita lo mismo, y la usa también `RateMatchScreen`.
 */
export function crearSecuencia() {
  let ultimo = 0;
  return {
    /** Abre un turno nuevo; el anterior queda obsoleto. */
    abrir() {
      ultimo += 1;
      return ultimo;
    },
    /** ¿Este turno sigue siendo el vigente? */
    vigente(turno) {
      return turno === ultimo;
    },
  };
}
