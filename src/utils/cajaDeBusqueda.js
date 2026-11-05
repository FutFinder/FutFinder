/**
 * Una caja de latitud/longitud alrededor del jugador, para filtrar partidos
 * cercanos EN LA CONSULTA, antes del límite (I01 de los pendientes de
 * calidad del 2026-09-23).
 *
 * Inicio pedía los 20 partidos abiertos más próximos de toda la app y
 * después aplicaba el radio en el teléfono: veinte partidos lejanos más
 * tempranos tapaban al primero cercano. La caja es un filtro grueso que
 * PostgREST puede hacer con `gte`/`lte`; el radio exacto (haversine) lo
 * sigue aplicando `applyFilters` después, así que la caja sólo necesita
 * contener el círculo entero, no calzar con él.
 *
 * Sin dependencias, para poder probarse con `node --test`.
 */

const KM_POR_GRADO_LAT = 111.32;

/** `{ latMin, latMax, lngMin, lngMax }`, o `null` si falta el centro o el radio. */
export function cajaDeBusqueda(centro, km) {
  const lat = Number(centro?.lat);
  const lng = Number(centro?.lng);
  const r = Number(km);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(r) || r <= 0 || km === null) {
    return null;
  }
  // Un pequeño margen para que el borde del círculo no quede fuera por
  // redondeo; lo que sobre lo descarta el radio exacto.
  const margen = 1.02;
  const dLat = (r / KM_POR_GRADO_LAT) * margen;
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const dLng = (r / (KM_POR_GRADO_LAT * cos)) * margen;
  return { latMin: lat - dLat, latMax: lat + dLat, lngMin: lng - dLng, lngMax: lng + dLng };
}

/** El mismo criterio que la consulta, para comprobarlo en memoria. */
export function dentroDeLaCaja(match, caja) {
  if (!caja) return true;
  const lat = Number(match?.latitud);
  const lng = Number(match?.longitud);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || match?.latitud === null || match?.longitud === null) {
    return false;
  }
  return lat >= caja.latMin && lat <= caja.latMax && lng >= caja.lngMin && lng <= caja.lngMax;
}
