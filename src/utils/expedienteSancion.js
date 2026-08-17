/**
 * El expediente de sanciones de un hilo de desafío, y cómo se mantiene al día.
 *
 * QUÉ ES EL EXPEDIENTE. Las tres lecturas que la barra de incomparecencia y
 * revisión necesita para decidir qué botón corresponde: las sanciones de mis
 * clubes, los informes de incomparecencia del encuentro y las revisiones que
 * pidió mi club. Se leen juntas porque se muestran juntas y porque tenerlas
 * desparejas es peor que no tenerlas: una sanción sin su revisión vuelve a
 * ofrecer «Solicitar revisión» sobre algo ya reclamado.
 *
 * POR QUÉ VIVE ACÁ Y NO EN EL SERVICIO. Las consultas son las mismas, pero el
 * cliente se recibe por parámetro. `src/services/clubSanctions.js` las ata al
 * cliente único de Supabase y la pantalla usa ese servicio; la prueba les pasa
 * un cliente con la forma de PostgREST sobre una base en memoria y recorre
 * este mismo código. Es lo que permite reproducir el fallo de dos sesiones sin
 * inventar una copia paralela de los cargadores, que es como se termina
 * probando algo que la aplicación no ejecuta.
 *
 * EL FALLO QUE OBLIGÓ A ESCRIBIRLO. Hasta la 47, una sanción sobre mi club
 * sólo podía nacer de una acción de mi propio club, así que releerla en el
 * sondeo de 15 segundos no valía la consulta y estaba excluida a propósito. La
 * 47c invirtió eso: informar una incomparecencia deja la sanción sobre el club
 * CONTRARIO, y pedir una revisión congela el desafío para los dos. Lo que
 * cambia el expediente de una sesión es, casi siempre, lo que hizo la otra. Sin
 * refresco, la sesión acusada no mostraba «Solicitar revisión» hasta recargar
 * la página — comprobado a mano el 2026-08-17.
 *
 * ES LECTURA Y NADA MÁS. Todo lo que escribe sigue pasando por las RPC de la
 * 47 y la 47c: estas tablas no tienen ninguna política de escritura para
 * `authenticated`.
 */

import {
  COLUMNAS_SANCION,
  esFaltaDeEsquemaSanciones,
  sancionVigente,
} from './cancelacionEncuentro.js';
import { COLUMNAS_INCOMPARECENCIA, COLUMNAS_REVISION } from './revisionSancion.js';

/**
 * El expediente de quien todavía no cargó nada.
 *
 * Congelado y compartido a propósito: es el valor inicial de la pantalla y el
 * `anterior` del primer refresco, y nadie debería mutarlo por accidente.
 */
export const EXPEDIENTE_VACIO = Object.freeze({
  sanciones: [],
  sancion: null,
  informes: [],
  revisiones: [],
});

/**
 * Una lectura del expediente, con las dos traducciones que la pantalla espera.
 *
 * Sin la migración aplicada la tabla no existe, y eso NO es un error de la
 * pantalla: el hilo se dibuja igual, sólo que sin la barra. Cualquier otro
 * fallo sí se devuelve, porque «no se pudo leer» y «no hay nada» son cosas
 * distintas y confundirlas es lo que una vez dibujó una nómina vacía y falsa.
 */
async function leer(consulta, etiqueta) {
  const { data, error } = await consulta;
  if (error) {
    if (esFaltaDeEsquemaSanciones(error)) return { data: [], error: null };
    console.error(`[FutFinder] ${etiqueta}:`, error);
    return {
      data: null,
      error: { message: error.message || 'No se pudo leer el expediente de sanciones.' },
    };
  }
  return { data: data || [], error: null };
}

/** Las sanciones de mis clubes, la más reciente primero. */
export function leerSanciones(cliente, clubIds = []) {
  const ids = (Array.isArray(clubIds) ? clubIds : []).filter(Boolean);
  if (!cliente || ids.length === 0) return Promise.resolve({ data: [], error: null });

  return leer(
    cliente
      .from('club_sanctions')
      .select(COLUMNAS_SANCION)
      .in('club_id', ids)
      .order('created_at', { ascending: false }),
    'leerSanciones'
  );
}

/**
 * Los informes de incomparecencia del encuentro. Pueden ser DOS, uno por club
 * acusado: los dos clubes pueden decir que el otro no llegó.
 */
export function leerIncomparecencias(cliente, challengeId) {
  if (!cliente || !challengeId) return Promise.resolve({ data: [], error: null });

  return leer(
    cliente
      .from('club_match_noshow_reports')
      .select(COLUMNAS_INCOMPARECENCIA)
      .eq('challenge_id', challengeId)
      .order('created_at', { ascending: true }),
    'leerIncomparecencias'
  );
}

/** Las revisiones que pidió mi club. La RLS no muestra las del rival. */
export function leerRevisiones(cliente, challengeId) {
  if (!cliente || !challengeId) return Promise.resolve({ data: [], error: null });

  return leer(
    cliente
      .from('club_sanction_reviews')
      .select(COLUMNAS_REVISION)
      .eq('challenge_id', challengeId)
      .order('created_at', { ascending: false }),
    'leerRevisiones'
  );
}

/**
 * Las tres lecturas a la vez.
 *
 * En paralelo y con el error POR REBANADA: que no se puedan leer las
 * revisiones no tiene por qué tirar abajo la sanción, que es la que bloquea.
 * Cada rebanada que falla vuelve como `null` y quien fusiona conserva la que
 * ya tenía.
 */
export async function leerExpediente(cliente, { challengeId = null, clubIds = [] } = {}) {
  const [sanciones, informes, revisiones] = await Promise.all([
    leerSanciones(cliente, clubIds),
    leerIncomparecencias(cliente, challengeId),
    leerRevisiones(cliente, challengeId),
  ]);

  return {
    sanciones: sanciones.data,
    informes: informes.data,
    revisiones: revisiones.data,
    error: sanciones.error || informes.error || revisiones.error || null,
  };
}

/**
 * Firma de una rebanada, para saber si de verdad cambió.
 *
 * `JSON.stringify` entero y no una lista de `id`: lo que mueve la barra son
 * los ESTADOS —`provisional` a `retirada`, `pendiente` a `resuelta`— y esos
 * llegan sobre filas que ya estaban. Una firma por identificador no vería la
 * resolución de una revisión, que es justo el último paso de la 5.2.
 */
function firma(filas) {
  return JSON.stringify(filas ?? null);
}

/**
 * El expediente nuevo a partir del anterior, y si hay algo que repintar.
 *
 * DOS GARANTÍAS:
 *
 *   · Una rebanada que no se pudo leer conserva la que ya estaba. Vaciarla
 *     apagaría el botón en cada corte de red, y el remedio del refresco sería
 *     peor que la enfermedad.
 *   · Sin novedades devuelve EL MISMO objeto. El sondeo corre cada quince
 *     segundos en todas las sesiones abiertas: reemplazar los tres arreglos en
 *     cada vuelta recalcularía la barra y sus botones sin que haya pasado nada.
 */
export function fusionarExpediente(anterior = EXPEDIENTE_VACIO, nuevo = {}, ahora = new Date()) {
  const base = anterior || EXPEDIENTE_VACIO;

  const sanciones = nuevo.sanciones ?? base.sanciones;
  const informes = nuevo.informes ?? base.informes;
  const revisiones = nuevo.revisiones ?? base.revisiones;

  const cambio =
    firma(sanciones) !== firma(base.sanciones)
    || firma(informes) !== firma(base.informes)
    || firma(revisiones) !== firma(base.revisiones);

  if (!cambio) return { expediente: base, cambio: false };

  return {
    // `sancion` es la que hoy bloquea al club, que es lo que lee la cabecera
    // del hilo; `sanciones` es la lista entera, que es lo que necesita la
    // revisión para encontrar la de ESTE encuentro aunque ya no bloquee.
    expediente: { sanciones, sancion: sancionVigente(sanciones, ahora), informes, revisiones },
    cambio: true,
  };
}

/**
 * Un paso de refresco completo: leer y fusionar.
 *
 * Es lo que corre el sondeo del hilo y también lo que corre después de una
 * acción propia, por el mismo camino a propósito: dos rutas distintas para el
 * mismo dato terminan discrepando el día que sólo se arregla una.
 *
 * Devuelve `{ expediente, cambio, error }`. Quien lo llama decide qué hacer
 * con el error: en una acción propia se muestra, y en un tick de fondo se
 * calla y se espera al siguiente, porque un corte de red no puede dejar un
 * aviso permanente en la barra.
 */
export async function refrescarExpediente(
  cliente,
  { challengeId = null, clubIds = [], anterior = EXPEDIENTE_VACIO, ahora = new Date() } = {}
) {
  const ids = (Array.isArray(clubIds) ? clubIds : []).filter(Boolean);

  // Sin club administrado no hay expediente que mirar: quien sólo lee el hilo
  // no tiene sanciones ni revisiones propias, y consultarlas cada quince
  // segundos sería pagar por nada.
  if (!cliente || !challengeId || ids.length === 0) {
    const { cambio } = fusionarExpediente(anterior, EXPEDIENTE_VACIO, ahora);
    return { expediente: EXPEDIENTE_VACIO, cambio, error: null };
  }

  const { sanciones, informes, revisiones, error } = await leerExpediente(cliente, {
    challengeId,
    clubIds: ids,
  });
  const { expediente, cambio } = fusionarExpediente(
    anterior,
    { sanciones, informes, revisiones },
    ahora
  );
  return { expediente, cambio, error };
}
