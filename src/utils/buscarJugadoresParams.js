/**
 * Traducción pura de (texto, filtros, límite) a los parámetros de la RPC
 * `buscar_jugadores` (migración 142). Vive acá, sin importar nada de
 * Supabase, para poder probar contra un cliente falso que lo que viaja
 * al servidor es lo que la pantalla pidió.
 *
 * POR QUÉ UNA RPC Y NO UNA CONSULTA. Hasta la migración 142 esto armaba
 * un `select` sobre `profiles` con `.eq('privacy_visible_in_search',
 * true)`. Ese filtro lo ponía el CLIENTE: `profiles` se lee con
 * `using (true)`, así que cualquiera con la clave publicable armaba la
 * misma consulta sin él y el interruptor «Visible en búsquedas» no
 * servía de nada. Ahora la regla la aplica el servidor, que es donde se
 * puede hacer cumplir, y acá sólo se traducen los filtros.
 *
 * Lo que el servidor decide y este archivo NO puede cambiar: que un
 * perfil oculto no salga nunca, que quien busca no aparezca en sus
 * propios resultados, y que el límite se tope en 50.
 */

/** Filtros de flanco que el servidor reconoce. */
const FLANCOS = ['derecho', 'izquierdo', 'ambos'];

/** Vacío, espacios o nulo viajan como `null`, no como cadena vacía. */
function texto(v) {
  const t = String(v ?? '').trim();
  return t.length > 0 ? t : null;
}

/** Un número inválido viaja como `null`: el servidor ignora el filtro. */
function numero(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildBuscarJugadoresParams(query, filters = {}, limit = 30) {
  const f = filters || {};
  return {
    p_texto: texto(query),
    p_region: texto(f.region),
    p_comuna: texto(f.comuna),
    p_posicion: texto(f.posicion),
    p_flanco: FLANCOS.includes(f.flanco) ? f.flanco : null,
    p_edad_min: numero(f.edadMin),
    p_edad_max: numero(f.edadMax),
    p_limite: numero(limit) ?? 30,
  };
}
