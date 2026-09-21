import { supabase, isSupabaseConfigured } from './supabase';
import { crearRegistroDeColumnas } from '../utils/columnasOpcionales';
import { cargarClubesDePartido } from '../utils/clubesDePartidoQuery.js';
import { aceptaACualquiera, rangoDeFecha } from './matchRules';

/**
 * `tema` → migración 53. Sin ella, pedirla en el `select` explícito de
 * `withClubs()` (abajo) tumba la consulta ENTERA con 42703: no es una
 * columna que falte en un club, es una columna que falta en la tabla, y
 * `.in('id', ids)` no vuelve con nada. Eso dejaría los partidos de clubes
 * sin nombre ni escudo en Inicio y Partidos, no sólo sin color. Mismo
 * mecanismo y mismo registro por proceso que `services/clubs.js`.
 */
const columnasClub = crearRegistroDeColumnas(['tema']);

/**
 * Distancia haversine en km entre dos coords {lat, lng}.
 * Útil para ordenar y filtrar partidos del lado del cliente.
 */
export function haversineKm(a, b) {
  if (!a || !b) return null;
  const R = 6371; // km
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Lista partidos abiertos cerca del usuario, ordenados por hora.
 * Si pasas comuna filtra por comuna.
 */
export async function listOpenMatches({ comuna = null, limit = 50, estados = ['abierto'] } = {}) {
  if (!isSupabaseConfigured) return { data: getDemoMatches(), error: null };

  // Mostramos solo partidos cuya hora oficial todavía NO haya pasado.
  // Una vez que `hora` pasa, el partido desaparece de Buscar y de Inicio.
  // El chat sigue activo para los inscritos (ChatThreadScreen maneja el
  // estado post-partido).
  const ahora = new Date().toISOString();

  // `estados` lo decide quien llama: la portada ofrece un botón de unirse, así
  // que pide solo `abierto`; el buscador pide también `lleno`, porque su filtro
  // «Todos» los promete y es donde se descubre la lista de espera.
  let q = supabase
    .from('matches')
    .select('*')
    .in('estado', estados)
    .gt('hora', ahora)
    .order('hora', { ascending: true })
    .limit(limit);

  if (comuna) q = q.eq('comuna', comuna);
  const { data, error } = await q;
  if (error) {
    console.error('[FutFinder] listOpenMatches error:', error);
    return { data: [], error };
  }
  return { data: await withClubs(await withOrganizers(data)), error: null };
}

/**
 * Los próximos partidos de un club, del más cercano al más lejano.
 *
 * POR QUÉ NO SIRVE `listOpenMatches()` PARA ESTO. Esa consulta trae los N
 * partidos abiertos más próximos de TODA la app y después el cliente busca
 * entre ellos alguno de su club. Con la app llena, cincuenta partidos ajenos
 * empiezan antes que el tuyo y el partido de tu club sale de la ventana: la
 * portada dejaría de mostrarlo sin decir por qué. Acá el filtro por club va
 * en la base, así que el tope se aplica sobre los partidos que importan.
 *
 * ADEMÁS NO FILTRA POR `'abierto'`. Un partido de club que llenó sus cupos
 * pasa a `'lleno'` y seguía siendo el próximo partido: esconderlo justo
 * cuando el club terminó de armarse era el peor momento posible. Se excluyen
 * los cancelados y los finalizados, que sí dejaron de estar por venir.
 *
 * La RLS lo permite: desde la migración 44d un integrante de cualquiera de
 * los dos clubes ve estas filas en cualquier estado.
 */
export async function listPartidosDeClub(clubId, { limit = 10 } = {}) {
  if (!isSupabaseConfigured || !clubId) return { data: [], error: null };

  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .or(`club_local_id.eq.${clubId},club_visitante_id.eq.${clubId}`)
    .not('estado', 'in', '(cancelado,finalizado)')
    .gt('hora', ahora)
    .order('hora', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[FutFinder] listPartidosDeClub:', error);
    return { data: [], error };
  }
  return { data: await withClubs(data || []), error: null };
}

/**
 * Adjunta `organizador: { username, foto_url, trust_score }` a una lista de
 * partidos con una sola consulta. Las tarjetas del listado necesitan mostrar
 * quién organiza, y sin esto haría una consulta por tarjeta.
 */
export async function withOrganizers(matches) {
  const list = matches || [];
  if (!isSupabaseConfigured || list.length === 0) return list;
  const ids = [...new Set(list.map((m) => m.id_organizador).filter(Boolean))];
  if (!ids.length) return list;
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score')
    .in('id', ids);
  const byId = new Map((profs || []).map((p) => [p.id, p]));
  return list.map((m) => ({ ...m, organizador: byId.get(m.id_organizador) || null }));
}

/**
 * Adjunta los dos clubes a los partidos que enfrentan clubes.
 *
 * Una sola consulta para toda la lista, no una por partido. Los partidos
 * normales pasan intactos y sin coste: si en la tanda no hay ninguno de
 * clubes, no se consulta nada.
 *
 * Si el club fue borrado, la fila llega sin él y `clubesDelPartido()` pone un
 * nombre genérico: media tarjeta vacía se ve rota.
 */
export async function withClubs(matches) {
  const list = matches || [];
  if (!isSupabaseConfigured || list.length === 0) return list;

  const ids = [
    ...new Set(list.flatMap((m) => [m.club_local_id, m.club_visitante_id]).filter(Boolean)),
  ];
  if (!ids.length) return list;

  // La consulta vive en `utils/clubesDePartidoQuery.js` con el cliente
  // inyectado, para que su tolerancia a la columna `tema` ausente se pueda
  // probar: acá no, porque este módulo no carga bajo `node --test`.
  const byId = await cargarClubesDePartido(supabase, { registro: columnasClub, ids });
  return list.map((m) =>
    m.club_local_id || m.club_visitante_id
      ? {
          ...m,
          club_local: byId.get(m.club_local_id) || null,
          club_visitante: byId.get(m.club_visitante_id) || null,
        }
      : m
  );
}

/**
 * La ubicación exacta de un partido nacido de un desafío entre clubes.
 *
 * Vive en `club_match_locations` (migración 44b), fuera de `matches`, porque
 * `matches` es de lectura pública y la dirección de estos partidos es de los
 * integrantes de los dos clubes.
 *
 * LO QUE PROTEGE NO ES ESTA FUNCIÓN, ES LA RLS. A quien no le corresponde, la
 * consulta le devuelve cero filas: no hay nada que esconder después. Por eso
 * «no soy del club» y «este partido no tiene ubicación guardada» llegan aquí
 * de la misma forma —`{ data: null }`— y la pantalla no necesita distinguirlos
 * para decidir qué dibujar.
 *
 * Sólo se pregunta por los partidos protegidos: para un partido normal la
 * dirección viene en la propia fila y esta consulta sería un viaje perdido.
 */
export async function getClubMatchLocation(matchId) {
  if (!isSupabaseConfigured || !matchId) return { data: null, error: null };

  const { data, error } = await supabase
    .from('club_match_locations')
    .select('match_id, direccion, latitud, longitud')
    .eq('match_id', matchId)
    .maybeSingle();

  if (error) {
    // Sin la migración 44b la tabla no existe: la pantalla se dibuja igual,
    // sólo que sin dirección exacta. No es motivo para dejarla en blanco.
    if (['42P01', 'PGRST205'].includes(error.code) || /does not exist/i.test(error.message || '')) {
      return { data: null, error: null };
    }
    console.error('[FutFinder] getClubMatchLocation:', error);
    return { data: null, error };
  }
  return { data: data || null, error: null };
}

/**
 * Trae los partidos abiertos cuyas coordenadas están dentro de un cuadrante
 * (bounding box) — usado por el mapa de la pestaña Buscar al moverlo.
 */
export async function listMatchesInBounds({
  minLat,
  maxLat,
  minLng,
  maxLng,
  limit = 100,
  estados = ['abierto'],
} = {}) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  if ([minLat, maxLat, minLng, maxLng].some((v) => v == null)) {
    return { data: [], error: null };
  }

  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .in('estado', estados)
    .gt('hora', ahora)
    .gte('latitud', minLat)
    .lte('latitud', maxLat)
    .gte('longitud', minLng)
    .lte('longitud', maxLng)
    .not('latitud', 'is', null)
    .not('longitud', 'is', null)
    .order('hora', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[FutFinder] listMatchesInBounds:', error);
    return { data: [], error };
  }
  return { data: await withClubs(await withOrganizers(data)), error: null };
}

/**
 * Traduce los filtros del buscador a una consulta de Supabase.
 *
 * POR QUÉ EXISTE. El buscador traía los N partidos más próximos y filtraba
 * TODO en el cliente: un partido que calzaba con lo que el usuario pedía, pero
 * que caía fuera de esos N, era invisible sin que nada lo dijera. Acá los
 * criterios que la base sabe resolver van en la consulta, así el tope se
 * aplica sobre los partidos que importan.
 *
 * QUÉ SE QUEDA EN EL CLIENTE, a propósito:
 *   · la distancia, que se calcula con las coordenadas del teléfono y no
 *     viaja al servidor (ver la nota de privacidad de la pantalla);
 *   · el rango de edad, que no es una comparación sino un solapamiento de
 *     rangos —un partido «sin restricción» siempre entra— y se lee mejor en
 *     `filterMatches`, donde está probado.
 */
function consultaDePartidos({ filtros = {}, texto = '', estados = ['abierto', 'lleno'] } = {}) {
  const ahora = new Date().toISOString();
  let q = supabase.from('matches').select('*').in('estado', estados).gt('hora', ahora);

  const ventana = rangoDeFecha(filtros.fecha);
  if (ventana?.desde) q = q.gte('hora', ventana.desde.toISOString());
  if (ventana?.hasta) q = q.lt('hora', ventana.hasta.toISOString());

  if (filtros.region) q = q.eq('region', filtros.region);
  if (filtros.comuna) q = q.eq('comuna', filtros.comuna);
  if (filtros.modalidad) q = q.eq('modalidad', filtros.modalidad);
  if (filtros.nivel) q = q.eq('nivel', filtros.nivel);
  if (filtros.disponibilidad === 'con_cupos') q = q.gt('cupos_disponibles', 0);
  if (filtros.sinMinimoTrust) q = q.eq('min_trust_score', 0);
  if (filtros.cuota) {
    q = q.gte('precio_cuota', filtros.cuota.min).lte('precio_cuota', filtros.cuota.max);
  }

  const t = (texto || '').trim();
  if (t) {
    // `,` y `)` rompen la sintaxis del `or` de PostgREST: se sacan del texto
    // en vez de escapar, que acá no aporta nada al usuario.
    const limpio = t.replace(/[,()]/g, ' ').trim();
    if (limpio) {
      const p = `%${limpio}%`;
      q = q.or(
        `titulo.ilike.${p},cancha_nombre.ilike.${p},comuna.ilike.${p},direccion.ilike.${p}`
      );
    }
  }
  return q;
}

/**
 * Una página de partidos que ya calzan con los filtros, ordenados por hora.
 *
 * Devuelve `{ data, hayMas, error }`. `hayMas` dice si vale la pena pedir la
 * página siguiente: se pide un elemento de más y se descarta.
 *
 * PAGINA POR CURSOR (`despuesDe`), NO POR OFFSET NUMÉRICO. Un `range(desde,
 * desde+limite)` cuenta POSICIONES, y la app publica partidos todo el
 * tiempo: si alguien publica uno con una hora más temprana que la ya
 * mostrada, cada fila de ahí en adelante se corre un lugar.
 *
 * COMPROBADO CONTRA LA BASE REAL (no sólo razonado): con el offset, `desde`
 * se pide como `matches.length` —el tamaño ya DEDUPLICADO en el cliente—,
 * así que una sola publicación intercalada no pierde nada para siempre: el
 * duplicado que aparece se descarta y `desde` se autocorrige solo en la
 * página siguiente. El problema real, medido con una ráfaga de publicaciones
 * mayor a `limite` entre dos páginas, es que cada página siguiente vuelve a
 * traer sobre todo duplicados —2 partidos nuevos de 5 por página en vez de
 * 5 de 5— y `cargarMas()` necesita muchas más vueltas de «Ver más partidos»
 * para llegar a lo mismo que el cursor obtiene sin ningún duplicado. No es
 * «partidos invisibles hasta un refresh»: es paginación que se vuelve lenta
 * y repetitiva justo cuando más gente está publicando a la vez. El cursor
 * evita el problema de raíz, sin duplicados en ningún escenario. Queda una
 * grieta aceptada: más partidos que un tamaño de página con la MISMA `hora`
 * exacta al segundo, un empate que el desempate compuesto resolvería pero
 * que no vale la complejidad frente a lo raro que es.
 */
export async function buscarPartidos({
  filtros = {},
  texto = '',
  limite = 50,
  despuesDe = null,
  estados = ['abierto', 'lleno'],
} = {}) {
  if (!isSupabaseConfigured) return { data: getDemoMatches(), hayMas: false, error: null };

  let q = consultaDePartidos({ filtros, texto, estados }).order('hora', { ascending: true });
  if (despuesDe?.hora) q = q.gt('hora', despuesDe.hora);

  const { data, error } = await q.limit(limite + 1);

  if (error) {
    console.error('[FutFinder] buscarPartidos:', error);
    return { data: [], hayMas: false, error };
  }
  const pagina = (data || []).slice(0, limite);
  return {
    data: await withClubs(await withOrganizers(pagina)),
    hayMas: (data || []).length > limite,
    error: null,
  };
}

/**
 * Cuántos partidos calzarían con estos filtros, sin traerlos.
 *
 * Es lo que sostiene las sugerencias de «qué pasaría si sueltas este filtro»
 * ahora que la lista no tiene todos los partidos en memoria. Una consulta de
 * conteo por sugerencia, y solo cuando la búsqueda quedó vacía.
 */
export async function contarPartidos({ filtros = {}, texto = '', estados = ['abierto', 'lleno'] } = {}) {
  if (!isSupabaseConfigured) return 0;
  const { count, error } = await consultaDePartidos({ filtros, texto, estados }).select('id', {
    count: 'exact',
    head: true,
  });
  if (error) {
    console.warn('[FutFinder] contarPartidos:', error);
    return 0;
  }
  return count || 0;
}

/**
 * Filtra una lista de partidos por criterios del usuario y los enriquece
 * con la distancia calculada desde sus coordenadas (si vienen).
 *
 * filters:
 *   - text: string  → busca en titulo, cancha_nombre, comuna
 *   - region: string → solo partidos de esa región (null = cualquiera)
 *   - comuna: string → solo de esa comuna (null = cualquiera)
 *   - maxKm: number → solo si userCoords está presente
 *   - timeWindow: 'hoy' | 'manana' | 'finde' | 'todos'
 *   - niveles: ['recreativo','intermedio','competitivo'] o []
 *   - precioMin: number, precioMax: number
 * userCoords: { lat, lng } | null
 */
export function applyFilters(matches, filters, userCoords) {
  const text = (filters.text || '').toLowerCase().trim();
  const region = filters.region || null;
  const comunaF = filters.comuna || null;
  const niveles = filters.niveles || [];
  const timeWindow = filters.timeWindow || 'todos';
  const maxKm = filters.maxKm ?? null;
  const pMin = filters.precioMin ?? 0;
  const pMax = filters.precioMax ?? 999999;
  const durMin = filters.duracionMin ?? null;
  const durMax = filters.duracionMax ?? null;

  // Pre-calculamos distancia para todos
  const enriched = matches.map((m) => {
    const km = userCoords
      ? haversineKm(userCoords, { lat: m.latitud, lng: m.longitud })
      : null;
    return { ...m, _distanciaKm: km };
  });

  // Ventana horaria: la misma que usa la consulta (ver `consultaDePartidos`).
  const now = new Date();
  const ventana = rangoDeFecha(timeWindow, now);

  function inWindow(matchHora) {
    const h = new Date(matchHora);
    if (ventana.desde && h < ventana.desde) return false;
    if (ventana.hasta && h >= ventana.hasta) return false;
    return true;
  }

  return enriched.filter((m) => {
    if (text) {
      const hay =
        (m.titulo || '').toLowerCase().includes(text) ||
        (m.cancha_nombre || '').toLowerCase().includes(text) ||
        (m.comuna || '').toLowerCase().includes(text);
      if (!hay) return false;
    }
    if (region && m.region !== region) return false;
    if (comunaF && m.comuna !== comunaF) return false;
    if (niveles.length > 0 && !niveles.includes(m.nivel)) return false;
    if (m.precio_cuota < pMin || m.precio_cuota > pMax) return false;
    if (durMin !== null || durMax !== null) {
      const d = m.duracion_min ?? null;
      if (d === null) return false; // sin duración cargada → no matchea filtro de duración
      if (durMin !== null && d < durMin) return false;
      if (durMax !== null && d > durMax) return false;
    }
    if (!inWindow(m.hora)) return false;
    if (maxKm !== null && m._distanciaKm !== null && m._distanciaKm > maxKm) return false;
    return true;
  });
}

/**
 * Filtro del listado de Partidos rediseñado.
 *
 * Recibe el objeto de filtros de `FiltersSheet` (`EMPTY_FILTERS`) y devuelve la
 * lista enriquecida con `_distanciaKm`, ya ordenada: por cercanía cuando hay
 * ubicación y por hora cuando no.
 *
 * Reglas de los filtros que dependen de datos opcionales:
 *   · modalidad: los partidos antiguos sin `modalidad` no se descartan cuando
 *     el usuario no filtra por modalidad, pero sí quedan fuera si la filtra.
 *   · rango de edad: un partido «sin restricción» siempre entra, porque acepta
 *     a cualquiera.
 */
export function filterMatches(matches, f = {}, userCoords = null) {
  const text = (f.text || '').toLowerCase().trim();
  const enriched = (matches || []).map((m) => ({
    ...m,
    _distanciaKm: userCoords
      ? haversineKm(userCoords, { lat: Number(m.latitud), lng: Number(m.longitud) })
      : null,
  }));

  const now = new Date();
  const ventana = rangoDeFecha(f.fecha, now);

  const inWindow = (hora) => {
    const h = new Date(hora);
    if (ventana.desde && h < ventana.desde) return false;
    if (ventana.hasta && h >= ventana.hasta) return false;
    return true;
  };

  const edadRange = resolveEdadFilter(f);

  const out = enriched.filter((m) => {
    if (text) {
      const hay =
        (m.titulo || '').toLowerCase().includes(text) ||
        (m.cancha_nombre || '').toLowerCase().includes(text) ||
        (m.comuna || '').toLowerCase().includes(text) ||
        (m.direccion || '').toLowerCase().includes(text);
      if (!hay) return false;
    }
    if (f.region && m.region !== f.region) return false;
    if (f.comuna && m.comuna !== f.comuna) return false;
    if (f.modalidad && m.modalidad !== f.modalidad) return false;
    if (f.nivel && m.nivel !== f.nivel) return false;
    if (f.disponibilidad === 'con_cupos' && (m.cupos_disponibles ?? 0) <= 0) return false;
    // «Ver partidos sin mínimo» llega hasta acá con el filtro puesto, en vez
    // de mandar al buscador general y dejar al jugador con los mismos
    // partidos que acaban de rechazarlo.
    if (f.sinMinimoTrust && !aceptaACualquiera(m)) return false;
    if (f.cuota) {
      const p = Number(m.precio_cuota || 0);
      if (p < f.cuota.min || p > f.cuota.max) return false;
    }
    if (edadRange) {
      const mMin = m.edad_min ?? null;
      const mMax = m.edad_max ?? null;
      // Un partido sin restricción acepta a cualquiera → siempre entra.
      const abierto = mMin == null && mMax == null;
      if (!abierto) {
        const noSolapa =
          (edadRange.max != null && mMin != null && mMin > edadRange.max) ||
          (edadRange.min != null && mMax != null && mMax < edadRange.min);
        if (noSolapa) return false;
      }
    }
    if (!inWindow(m.hora)) return false;
    if (f.maxKm != null && m._distanciaKm != null && m._distanciaKm > f.maxKm) return false;
    return true;
  });

  return out.sort((a, b) => {
    if (userCoords && a._distanciaKm != null && b._distanciaKm != null) {
      return a._distanciaKm - b._distanciaKm;
    }
    return new Date(a.hora) - new Date(b.hora);
  });
}

/** Traduce el preset/rango personalizado de edad del filtro a `{min,max}`. */
function resolveEdadFilter(f) {
  if (f.edadPreset === -1) {
    const min = f.edadMin === '' || f.edadMin == null ? null : Number(f.edadMin);
    const max = f.edadMax === '' || f.edadMax == null ? null : Number(f.edadMax);
    if (min == null && max == null) return null;
    return { min, max };
  }
  const presets = [
    null,
    { min: 18, max: 25 },
    { min: 18, max: 35 },
    { min: 25, max: 45 },
    { min: 35, max: 99 },
  ];
  return presets[f.edadPreset ?? 0] || null;
}

/**
 * Crea un nuevo partido.
 * El organizador es el usuario autenticado.
 */
export async function createMatch({
  titulo,
  region,
  comuna,
  cancha_nombre,
  direccion = null,
  latitud,
  longitud,
  hora,
  cupos_totales,
  precio_cuota = 0,
  nivel = 'recreativo',
  descripcion = null,
  duracion_min = 90,
  aprobacion = 'inmediata',
  min_trust_score = 0,
  modalidad = null,
  edad_min = null,
  edad_max = null,
  recordatorio_1h = true,
  pedir_asistencia = true,
  /**
   * Token generado por el cliente antes del primer intento. Hace la
   * publicación idempotente: si el usuario toca dos veces «Publicar» o se
   * reintenta por timeout, el segundo insert choca con el índice único y
   * devolvemos el partido que ya existe en vez de crear un duplicado.
   */
  client_token = null,
  // Partido de clubes (null = partido normal)
  club_local_id = null,
  club_visitante_id = null,
  challenge_id = null,
}) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo mode' } };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: { message: 'No autenticado' } };

  const payload = {
    id_organizador: user.id,
    titulo,
    region,
    comuna,
    cancha_nombre,
    direccion,
    latitud,
    longitud,
    hora,
    cupos_totales,
    cupos_disponibles: cupos_totales,
    precio_cuota,
    nivel,
    descripcion,
    duracion_min,
    aprobacion,
    min_trust_score,
    modalidad,
    edad_min,
    edad_max,
    recordatorio_1h,
    pedir_asistencia,
    club_local_id,
    club_visitante_id,
    challenge_id,
  };
  if (client_token) payload.client_token = client_token;

  const { data, error } = await supabase
    .from('matches')
    .insert(payload)
    .select()
    .single();

  // 23505 = unique_violation → ya se publicó con este token, lo recuperamos.
  if (error && client_token && (error.code === '23505' || /duplicate key/i.test(error.message || ''))) {
    const { data: existing } = await supabase
      .from('matches')
      .select('*')
      .eq('client_token', client_token)
      .maybeSingle();
    if (existing) return { data: existing, error: null, duplicate: true };
  }

  return { data, error };
}

/**
 * Trae un partido por id (para edición o detalle).
 */
export async function getMatchById(matchId) {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .single();
  return { data, error };
}

/**
 * Actualiza un partido existente.
 * RLS solo permite al organizador.
 */
export async function updateMatch(matchId, patch) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const allowed = [
    'titulo', 'region', 'comuna', 'cancha_nombre', 'direccion',
    'latitud', 'longitud', 'hora',
    'cupos_totales', 'cupos_disponibles',
    'precio_cuota', 'nivel', 'descripcion', 'estado', 'foto_url',
    'duracion_min', 'aprobacion', 'min_trust_score',
    'modalidad', 'edad_min', 'edad_max',
    'recordatorio_1h', 'pedir_asistencia', 'motivo_cancelacion',
  ];
  const payload = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) payload[k] = patch[k];
  }
  const { data, error } = await supabase
    .from('matches')
    .update(payload)
    .eq('id', matchId)
    .select()
    .single();
  return { data, error };
}

/**
 * Elimina un partido. RLS solo permite al organizador.
 * El borrado en cascada elimina attendees y messages asociados.
 */
export async function deleteMatch(matchId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase
    .from('matches')
    .delete()
    .eq('id', matchId);
  if (error) console.error('[FutFinder] deleteMatch:', error);
  return { error };
}

/**
 * El usuario actual se inscribe a un partido.
 * Usa la función RPC join_match (atómica, decrementa cupo).
 */
export async function joinMatch(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('join_match', { p_match_id: matchId });
  if (error) return { ok: false, reason: translateJoinError(error.message), error };
  return data; // { ok: true } o { ok: false, reason }
}

/**
 * Traduce los errores de esquema de PostgREST a algo accionable.
 *
 * Si la migración 33 no está aplicada en la base de datos, PostgREST responde
 * «Could not find the 'modalidad' column of 'matches' in the schema cache»,
 * que no le dice nada a nadie. Este helper lo convierte en la instrucción real.
 */
export function translateSchemaError(error) {
  if (!error) return null;
  const msg = String(error.message || '');
  const m = msg.match(/Could not find the '([^']+)' column of '([^']+)'/i);
  if (!m) return null;
  const columnasNuevas = [
    'modalidad', 'edad_min', 'edad_max', 'recordatorio_1h',
    'pedir_asistencia', 'motivo_cancelacion', 'client_token',
  ];
  if (columnasNuevas.includes(m[1])) {
    return `Falta aplicar la migración «33_partidos_flujo_completo.sql» en Supabase: la tabla ${m[2]} todavía no tiene la columna ${m[1]}.`;
  }
  return `La base de datos no tiene la columna ${m[1]} en ${m[2]}. Revisa las migraciones pendientes.`;
}

/**
 * Igual que `translateSchemaError`, pero para las RPC que puede que no existan
 * todavía (lista de espera, asistencia).
 */
export function translateMissingRpcError(error) {
  if (!error) return null;
  const msg = String(error.message || '');
  if (/Could not find the function|does not exist/i.test(msg)) {
    return 'Esta acción necesita la migración «33_partidos_flujo_completo.sql» aplicada en Supabase.';
  }
  return null;
}

// Traduce las excepciones del trigger tg_enforce_join_rules a mensajes legibles.
function translateJoinError(msg = '') {
  if (msg.includes('SUSPENDIDO')) {
    return 'Tu cuenta está suspendida temporalmente y no puede unirse a partidos.';
  }
  if (msg.includes('CHOQUE_HORARIO')) {
    return 'Ya tienes un partido a esta hora.';
  }
  if (msg.includes('EDAD_FUERA_DE_RANGO')) {
    return 'Tu edad está fuera del rango que pide este partido.';
  }
  const m = msg.match(/TRUST_BAJO:(\d+):(\d+)/);
  if (m) {
    return `Trust Score insuficiente: este partido pide ${m[2]} y tú tienes ${m[1]}.`;
  }
  return null;
}

/**
 * Devuelve si el partido choca con otro en el que el usuario ya está inscrito.
 *   { conflict: false } | { conflict: true, matchId, titulo, hora, canSwap }
 */
export async function getScheduleConflict(matchId) {
  if (!isSupabaseConfigured) return { conflict: false };
  const { data, error } = await supabase.rpc('get_schedule_conflict', {
    p_match_id: matchId,
  });
  if (error) {
    console.warn('[FutFinder] getScheduleConflict:', error);
    return { conflict: false };
  }
  return data || { conflict: false };
}

/**
 * Sale del partido viejo e inscribe en el nuevo en un solo flujo.
 * Devuelve { ok, pending?, reason? }.
 */
export async function swapMatch(oldMatchId, newMatchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('swap_match', {
    p_old: oldMatchId,
    p_new: newMatchId,
  });
  if (error) return { ok: false, reason: translateJoinError(error.message), error };
  return data;
}

/**
 * Salir de un partido con penalización por tiempo (jugador).
 * Devuelve { ok, penalty, freed, reason? }.
 */
export async function leaveMatchPenalized(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true, penalty: 0 };
  const { data, error } = await supabase.rpc('leave_match_penalized', {
    p_match_id: matchId,
  });
  if (error) return { ok: false, error };
  return data;
}

/**
 * Cancelar un partido con penalización por tiempo (anfitrión).
 * Devuelve { ok, penalty, reason? }.
 */
export async function cancelMatch(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true, penalty: 0 };
  const { data, error } = await supabase.rpc('cancel_match', {
    p_match_id: matchId,
  });
  if (error) return { ok: false, error };
  return data;
}

/**
 * El anfitrión cancela su partido original (penalización -25) y se une al nuevo.
 * Devuelve { ok, pending?, reason? }.
 */
export async function cancelMatchAndJoin(oldMatchId, newMatchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('cancel_match_and_join', {
    p_old: oldMatchId,
    p_new: newMatchId,
  });
  if (error) return { ok: false, reason: translateJoinError(error.message), error };
  return data;
}

/**
 * Solicita unirse a un partido con aprobación MANUAL.
 * Crea un attendee en estado 'pendiente' (sin descontar cupo) y
 * notifica al anfitrión. Usa la RPC request_join.
 */
export async function requestJoinMatch(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('request_join', { p_match_id: matchId });
  if (error) return { ok: false, reason: translateJoinError(error.message), error };
  return data; // { ok, reason? }
}

/**
 * El anfitrión aprueba una solicitud pendiente.
 * Pasa al jugador a 'inscrito', descuenta cupo y le notifica.
 */
export async function approveJoinRequest(matchId, playerId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('approve_join', {
    p_match_id: matchId,
    p_player_id: playerId,
  });
  if (error) return { ok: false, error };
  return data;
}

/**
 * El anfitrión rechaza una solicitud pendiente (la borra) y notifica al jugador.
 */
export async function rejectJoinRequest(matchId, playerId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('reject_join', {
    p_match_id: matchId,
    p_player_id: playerId,
  });
  if (error) return { ok: false, error };
  return data;
}

/**
 * El usuario actual se sale del partido (libera cupo).
 * RLS: el organizador NO puede usar esto, debe eliminar el partido.
 */
export async function leaveMatch(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('leave_match', { p_match_id: matchId });
  if (error) return { ok: false, error };
  return data;
}

/**
 * Lista los jugadores inscritos en un partido con info de perfil.
 * Devuelve [{id, username, foto_url, trust_score, comuna, posicion_preferida, is_organizer, estado, inscrito_at}]
 */
export async function getMatchAttendees(matchId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  try {
    // 1) Trae attendees
    const { data: atts, error: aErr } = await supabase
      .from('attendees')
      .select('id, id_jugador, estado, inscrito_at, confirmado_at')
      .eq('id_partido', matchId)
      .order('inscrito_at', { ascending: true });
    if (aErr) {
      console.error('[FutFinder] getMatchAttendees:', aErr);
      return { data: [], error: aErr };
    }

    // 2) Trae datos del match (para saber quién es organizador).
    //    Va con `*` a propósito: el detalle, la gestión y la edición necesitan
    //    todas las columnas (modalidad, rango de edad, coordenadas, duración,
    //    aprobación, recordatorios, motivo de cancelación…). Con una lista fija
    //    la pantalla caía en valores por defecto y mostraba datos que no eran
    //    los del partido.
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    // Los dos clubes, si el partido enfrenta clubes: el detalle los necesita
    // para el encabezado con escudos y nombres.
    const [conClubes] = await withClubs(match ? [match] : []);
    const matchConClubes = conClubes || match;

    const playerIds = (atts || []).map((a) => a.id_jugador);
    if (playerIds.length === 0) {
      return { data: [], match: matchConClubes, error: null };
    }

    // 3) Trae perfiles en una sola query
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, username, foto_url, trust_score, comuna, posicion_preferida')
      .in('id', playerIds);
    const byId = new Map((profs || []).map((p) => [p.id, p]));

    const list = (atts || []).map((a) => {
      const p = byId.get(a.id_jugador) || {};
      return {
        attendee_id: a.id,
        user_id: a.id_jugador,
        username: p.username || 'jugador',
        foto_url: p.foto_url || null,
        trust_score: p.trust_score ?? 100,
        comuna: p.comuna,
        posicion_preferida: p.posicion_preferida,
        is_organizer: a.id_jugador === match?.id_organizador,
        estado: a.estado,
        inscrito_at: a.inscrito_at,
        confirmado_at: a.confirmado_at,
      };
    });

    return { data: list, match: matchConClubes, error: null };
  } catch (e) {
    console.error('[FutFinder] getMatchAttendees exception:', e);
    return { data: [], error: e };
  }
}

/**
 * Cancela el partido y deja el motivo visible para los jugadores.
 *
 * NO borra el registro: `cancel_match` cambia `estado` a 'cancelado' para que
 * el partido siga en el historial y el chat quede en solo lectura.
 */
export async function cancelMatchWithReason(matchId, motivo = null) {
  // El motivo se escribe ANTES de cancelar. La RPC `cancel_match` que está
  // corriendo en la base es una versión anterior a este repo (la migración 33
  // no la sobrescribe a propósito) y no sabemos con certeza si cambia el
  // `estado` o borra la fila. Escribiendo primero, el motivo queda guardado en
  // el caso en que el registro sobreviva, y no se pierde nada si no.
  if (motivo && isSupabaseConfigured) {
    await supabase
      .from('matches')
      .update({ motivo_cancelacion: motivo })
      .eq('id', matchId);
  }

  const res = await cancelMatch(matchId);
  if (!res?.ok) return res;

  // ¿Quedó como 'cancelado' en el historial, o desapareció?
  let survived = true;
  if (isSupabaseConfigured) {
    const { data } = await supabase
      .from('matches')
      .select('id, estado')
      .eq('id', matchId)
      .maybeSingle();
    survived = !!data;
  }
  return { ...res, survived };
}

/**
 * Retira mi propia solicitud pendiente.
 *
 * ANTES ERA UN `delete` DIRECTO sobre `attendees`, y era el único sitio del
 * cliente que escribía en esa tabla sin pasar por una RPC. Eso obligaba a
 * mantener abiertas las políticas `attendees_*_self`, que dejaban a cualquier
 * `authenticated` inscribirse por PostgREST saltándose `join_match` y sus
 * comprobaciones de cupo. La migración 44e cierra esas políticas y trae
 * `cancel_join_request()` justamente para sustituir esta llamada: sin el
 * cambio, retirar una solicitud dejaría de funcionar.
 *
 * Volver a pulsar no es un error: la RPC devuelve `sinSolicitud: true` y no
 * toca cupos, porque una solicitud pendiente nunca reservó ninguno.
 */
export async function cancelMyJoinRequest(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  if (!matchId) return { ok: false, reason: 'Falta el partido' };

  const { data, error } = await supabase.rpc('cancel_join_request', { p_match_id: matchId });
  if (error) {
    console.error('[FutFinder] cancelMyJoinRequest:', error);
    return { ok: false, error };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.ok === false) return { ok: false, reason: row.reason };
  return { ok: true, sinSolicitud: !!row?.sinSolicitud };
}

/**
 * Solicitudes pendientes de un partido, con la info que el organizador
 * necesita para decidir: posición, Trust Score e historial disponible.
 */
export async function getMatchRequests(matchId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data: atts, error } = await supabase
    .from('attendees')
    .select('id, id_jugador, inscrito_at')
    .eq('id_partido', matchId)
    .eq('estado', 'pendiente')
    .order('inscrito_at', { ascending: true });
  if (error) return { data: [], error };
  const ids = (atts || []).map((a) => a.id_jugador);
  if (!ids.length) return { data: [], error: null };

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score, edad, comuna, posicion_preferida, partidos_jugados, asistencias_confirmadas')
    .in('id', ids);
  const byId = new Map((profs || []).map((p) => [p.id, p]));

  return {
    data: (atts || []).map((a) => {
      const p = byId.get(a.id_jugador) || {};
      return {
        attendee_id: a.id,
        user_id: a.id_jugador,
        username: p.username || 'jugador',
        foto_url: p.foto_url || null,
        trust_score: p.trust_score ?? null,
        edad: p.edad ?? null,
        comuna: p.comuna || null,
        posicion_preferida: p.posicion_preferida || null,
        partidos_jugados: p.partidos_jugados ?? 0,
        asistencias_confirmadas: p.asistencias_confirmadas ?? 0,
        solicitado_at: a.inscrito_at,
      };
    }),
    error: null,
  };
}

// ------------------------------------------------------ lista de espera

/** Cola de espera del partido, en orden de llegada. */
export async function getWaitlist(matchId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data, error } = await supabase
    .from('match_waitlist')
    .select('id, id_jugador, created_at, avisado_at, confirmar_antes_de')
    .eq('id_partido', matchId)
    .order('created_at', { ascending: true });
  if (error) return { data: [], error };
  const ids = (data || []).map((w) => w.id_jugador);
  if (!ids.length) return { data: [], error: null };
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score')
    .in('id', ids);
  const byId = new Map((profs || []).map((p) => [p.id, p]));
  return {
    data: (data || []).map((w, i) => {
      const p = byId.get(w.id_jugador) || {};
      return {
        id: w.id,
        user_id: w.id_jugador,
        posicion: i + 1,
        username: p.username || 'jugador',
        foto_url: p.foto_url || null,
        trust_score: p.trust_score ?? null,
        avisado_at: w.avisado_at,
        confirmar_antes_de: w.confirmar_antes_de,
      };
    }),
    error: null,
  };
}

/** Entra a la lista de espera. Devuelve `{ ok, posicion }`. */
export async function joinWaitlist(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true, posicion: 1 };
  const { data, error } = await supabase.rpc('join_waitlist', { p_match_id: matchId });
  if (error) {
    return {
      ok: false,
      reason: translateMissingRpcError(error) || translateJoinError(error.message),
      error,
    };
  }
  return data;
}

/** Sale de la lista de espera. No afecta el Trust Score. */
export async function leaveWaitlist(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('leave_waitlist', { p_match_id: matchId });
  if (error) return { ok: false, reason: translateMissingRpcError(error), error };
  return data;
}

// ---------------------------------------------------------- asistencia

/**
 * El organizador guarda la asistencia del partido.
 * `marks` = { [userId]: 'presente' | 'ausente' }.
 *
 * La RPC valida que quien llama sea el organizador, que el partido haya
 * terminado y aplica el efecto en el Trust Score de cada jugador.
 */
export async function saveMatchAttendance(matchId, marks) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('save_match_attendance', {
    p_match_id: matchId,
    p_marks: marks,
  });
  if (error) return { ok: false, reason: translateMissingRpcError(error), error };
  return data;
}

/**
 * Cuántos partidos abiertos cerca no exigen Trust Score mínimo.
 * Sirve para la alternativa honesta de la pantalla de bloqueo.
 */
export async function countMatchesWithoutMinTrust({ region = null } = {}) {
  if (!isSupabaseConfigured) return 0;
  let q = supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'abierto')
    .gt('hora', new Date().toISOString())
    .gt('cupos_disponibles', 0)
    .or('min_trust_score.is.null,min_trust_score.eq.0');
  if (region) q = q.eq('region', region);
  const { count } = await q;
  return count || 0;
}

// ----- Datos de demo (cuando Supabase no está configurado todavía) -----
function getDemoMatches() {
  const now = Date.now();
  return [
    {
      id: 'demo-1',
      titulo: 'Partido en Estadio Nacional',
      comuna: 'Ñuñoa',
      cancha_nombre: 'Complejo Ñuñoa · Cancha 3',
      latitud: -33.4569,
      longitud: -70.6107,
      hora: new Date(now + 5 * 3600 * 1000).toISOString(),
      cupos_disponibles: 2,
      cupos_totales: 10,
      precio_cuota: 3500,
      nivel: 'intermedio',
      organizador: { username: 'demo_user', trust_score: 92 },
    },
    {
      id: 'demo-2',
      titulo: 'Pichanga Las Condes',
      comuna: 'Las Condes',
      cancha_nombre: 'Club Manquehue · Cancha A',
      latitud: -33.4172,
      longitud: -70.5631,
      hora: new Date(now + 28 * 3600 * 1000).toISOString(),
      cupos_disponibles: 6,
      cupos_totales: 12,
      precio_cuota: 4200,
      nivel: 'recreativo',
      organizador: { username: 'demo_user', trust_score: 88 },
    },
  ];
}
