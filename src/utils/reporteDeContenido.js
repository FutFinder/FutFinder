/**
 * Reportar un club, una foto de club o un partido (migración 186, guía 1.2
 * de Apple). Lo puro vive acá para probarlo en Node; la llamada está en
 * `services/reports.js` (`reportarContenido`).
 */

/** Lo que se puede reportar además de una cuenta: los `p_tipo` de la RPC. */
export const TIPOS_DE_CONTENIDO = ['club', 'foto_club', 'partido'];

const FALLO = 'No pudimos enviar el reporte. Intenta de nuevo.';
export const YA_HAY_UNO = 'Ya reportaste esto y sigue en revisión.';

/**
 * La respuesta de `reportar_contenido` → `{ error }`. Un `ok: false` del
 * servidor (lo propio, lo que ya no existe, el reporte repetido) trae su
 * motivo en español y se muestra tal cual; un error de transporte no se
 * muestra crudo.
 */
export function interpretarReporteDeContenido({ data, error }) {
  if (error) {
    console.error('[FutFinder] reportarContenido:', error.code || '', error.message || error);
    return { error: { message: FALLO } };
  }
  if (data && data.ok === true) return { error: null };
  if (data && data.ok === false) {
    // Desde la 191 hay un reporte pendiente por elemento: el repetido es
    // ESTE mismo club, foto o partido. Antes de la 191 la RPC decía «sobre
    // esta cuenta», que reportando un club no se entiende; las dos frases
    // terminan en «sigue en revisión».
    if (/sigue en revisión/.test(data.reason || '')) {
      return { error: { message: YA_HAY_UNO } };
    }
    return { error: { message: data.reason || FALLO } };
  }
  return { error: { message: FALLO } };
}
