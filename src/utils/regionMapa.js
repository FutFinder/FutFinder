/**
 * Traducción entre la «región» de react-native-maps y lo que entiende un
 * mapa de Mapbox GL en web.
 *
 * POR QUÉ EXISTE. `PartidosScreen` habla en regiones —el formato de la
 * versión nativa— y no tiene por qué saber que en web hay otro motor. El
 * mapa web traduce en sus bordes y el resto de la app no se entera.
 *
 *   region  { latitude, longitude, latitudeDelta, longitudeDelta }
 *   bounds  [[oeste, sur], [este, norte]]   ← lo que pide Mapbox
 *
 * Los deltas son el ALTO y el ANCHO completos de la ventana, no la mitad:
 * así lo usa `react-native-maps`, y confundirlo deja el mapa al doble o a
 * la mitad del zoom sin que nada falle.
 */

/** Un número utilizable, o null. Nunca lanza. */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * De la región al rectángulo que Mapbox sabe encuadrar.
 *
 * Devuelve `null` si la región no sirve: sin centro o sin tamaño no hay
 * rectángulo, y un `fitBounds` con NaN deja el mapa en blanco sin avisar.
 */
export function boundsDesdeRegion(region) {
  const lat = num(region?.latitude);
  const lng = num(region?.longitude);
  const dLat = Math.abs(num(region?.latitudeDelta) ?? 0);
  const dLng = Math.abs(num(region?.longitudeDelta) ?? 0);
  if (lat === null || lng === null || dLat === 0 || dLng === 0) return null;

  const sur = Math.max(-90, lat - dLat / 2);
  const norte = Math.min(90, lat + dLat / 2);
  const oeste = lng - dLng / 2;
  const este = lng + dLng / 2;
  return [[oeste, sur], [este, norte]];
}

/**
 * Del estado del mapa a la región que espera la pantalla.
 *
 * `centro` es {lng, lat} y `bounds` el rectángulo visible. Se usa el
 * centro REAL del mapa y no el del rectángulo: con el mapa inclinado no
 * coinciden, y «buscar en esta zona» tiene que buscar donde la persona
 * está mirando.
 */
export function regionDesdeMapa({ centro, bounds } = {}) {
  const lat = num(centro?.lat);
  const lng = num(centro?.lng);
  if (lat === null || lng === null) return null;

  const sur = num(bounds?.[0]?.[1]);
  const oeste = num(bounds?.[0]?.[0]);
  const norte = num(bounds?.[1]?.[1]);
  const este = num(bounds?.[1]?.[0]);

  // Sin rectángulo utilizable se devuelve el centro con deltas mínimos en
  // vez de `null`: perder el centro sería peor que perder el zoom.
  const dLat = sur !== null && norte !== null ? Math.abs(norte - sur) : 0;
  const dLng = oeste !== null && este !== null ? Math.abs(este - oeste) : 0;

  return {
    latitude: lat,
    longitude: lng,
    latitudeDelta: dLat || 0.02,
    longitudeDelta: dLng || 0.02,
  };
}

/**
 * El texto de la chapita de un partido en el mapa: cupos ocupados sobre
 * totales y la hora. Es el mismo de la versión nativa, extraído acá para
 * que las dos no se separen.
 */
export function etiquetaDelPartido(m, fmtHora) {
  const total = m?.cupos_totales ?? 0;
  const disponibles = m?.cupos_disponibles ?? 0;
  const ocupados = Math.max(0, total - disponibles);
  return `${ocupados}/${total} · ${fmtHora ? fmtHora(m?.hora) : ''}`.trim();
}

/**
 * La hora del partido en HH:MM, con el reloj del dispositivo.
 *
 * Vive acá y no en cada mapa porque las dos plataformas dibujan la misma
 * chapita: tenerla duplicada era pedir que se separaran.
 *
 * Una fecha ilegible devuelve cadena vacía, no «NaN:NaN».
 */
export function fmtHora(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
