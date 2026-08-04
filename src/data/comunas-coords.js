/**
 * Coordenadas centrales (centroide aproximado) de comunas de Chile.
 *
 * Se usan para estimar la distancia entre dos clubes cuando solo se conoce
 * su comuna: los clubes NO guardan lat/lng propias (a diferencia de los
 * partidos, que sí las tienen).
 *
 * IMPORTANTE — reglas de honestidad de datos:
 *  - Son centroides APROXIMADOS de la comuna, no la dirección del club.
 *    Por eso la UI habla de distancia "aproximada".
 *  - Si una comuna no está en este mapa, `getComunaCoords` devuelve null y
 *    la UI muestra "Distancia N.A.". NUNCA se inventa una distancia.
 *
 * Cobertura: las 34 comunas del Gran Santiago (foco de la app) más las
 * capitales regionales y ciudades principales del resto del país.
 * Para ampliar, basta agregar entradas aquí: no hay servicio externo
 * ni clave de API involucrada.
 */

// Claves normalizadas (sin tildes, minúsculas) → { lat, lng }
const COORDS = {
  // ── Región Metropolitana — Gran Santiago ──
  'cerrillos': { lat: -33.4967, lng: -70.7167 },
  'cerro navia': { lat: -33.4225, lng: -70.7333 },
  'conchali': { lat: -33.3833, lng: -70.6750 },
  'el bosque': { lat: -33.5625, lng: -70.6750 },
  'estacion central': { lat: -33.4600, lng: -70.6950 },
  'huechuraba': { lat: -33.3667, lng: -70.6417 },
  'independencia': { lat: -33.4167, lng: -70.6667 },
  'la cisterna': { lat: -33.5333, lng: -70.6625 },
  'la florida': { lat: -33.5333, lng: -70.5833 },
  'la granja': { lat: -33.5417, lng: -70.6250 },
  'la pintana': { lat: -33.5833, lng: -70.6333 },
  'la reina': { lat: -33.4458, lng: -70.5375 },
  'las condes': { lat: -33.4083, lng: -70.5417 },
  'lo barnechea': { lat: -33.3500, lng: -70.5167 },
  'lo espejo': { lat: -33.5250, lng: -70.6875 },
  'lo prado': { lat: -33.4458, lng: -70.7292 },
  'macul': { lat: -33.4833, lng: -70.5958 },
  'maipu': { lat: -33.5167, lng: -70.7667 },
  'nunoa': { lat: -33.4569, lng: -70.5975 },
  'pedro aguirre cerda': { lat: -33.4875, lng: -70.6708 },
  'penalolen': { lat: -33.4833, lng: -70.5417 },
  'providencia': { lat: -33.4314, lng: -70.6094 },
  'pudahuel': { lat: -33.4417, lng: -70.7583 },
  'quilicura': { lat: -33.3667, lng: -70.7292 },
  'quinta normal': { lat: -33.4292, lng: -70.7000 },
  'recoleta': { lat: -33.4083, lng: -70.6417 },
  'renca': { lat: -33.4042, lng: -70.7167 },
  'san joaquin': { lat: -33.4958, lng: -70.6292 },
  'san miguel': { lat: -33.4958, lng: -70.6500 },
  'san ramon': { lat: -33.5375, lng: -70.6458 },
  'santiago': { lat: -33.4372, lng: -70.6506 },
  'vitacura': { lat: -33.3833, lng: -70.5750 },
  'puente alto': { lat: -33.6167, lng: -70.5750 },
  'san bernardo': { lat: -33.5917, lng: -70.7000 },

  // ── Resto de la Región Metropolitana ──
  'buin': { lat: -33.7325, lng: -70.7431 },
  'calera de tango': { lat: -33.6297, lng: -70.7853 },
  'colina': { lat: -33.2019, lng: -70.6742 },
  'curacavi': { lat: -33.4064, lng: -71.1417 },
  'el monte': { lat: -33.6764, lng: -70.9819 },
  'isla de maipo': { lat: -33.7381, lng: -70.8961 },
  'lampa': { lat: -33.2833, lng: -70.8833 },
  'melipilla': { lat: -33.6889, lng: -71.2153 },
  'padre hurtado': { lat: -33.5697, lng: -70.8158 },
  'paine': { lat: -33.8125, lng: -70.7411 },
  'penaflor': { lat: -33.6103, lng: -70.8797 },
  'pirque': { lat: -33.6403, lng: -70.5906 },
  'san jose de maipo': { lat: -33.6403, lng: -70.3536 },
  'talagante': { lat: -33.6647, lng: -70.9281 },
  'tiltil': { lat: -33.0833, lng: -70.9333 },

  // ── Capitales regionales y ciudades principales ──
  'arica': { lat: -18.4783, lng: -70.3126 },
  'iquique': { lat: -20.2141, lng: -70.1524 },
  'alto hospicio': { lat: -20.2708, lng: -70.1006 },
  'antofagasta': { lat: -23.6509, lng: -70.3975 },
  'calama': { lat: -22.4544, lng: -68.9294 },
  'copiapo': { lat: -27.3665, lng: -70.3323 },
  'vallenar': { lat: -28.5708, lng: -70.7581 },
  'la serena': { lat: -29.9027, lng: -71.2519 },
  'coquimbo': { lat: -29.9533, lng: -71.3436 },
  'ovalle': { lat: -30.5983, lng: -71.2003 },
  'valparaiso': { lat: -33.0472, lng: -71.6127 },
  'vina del mar': { lat: -33.0245, lng: -71.5518 },
  'quilpue': { lat: -33.0472, lng: -71.4419 },
  'villa alemana': { lat: -33.0422, lng: -71.3733 },
  'san antonio': { lat: -33.5928, lng: -71.6053 },
  'quillota': { lat: -32.8797, lng: -71.2489 },
  'san felipe': { lat: -32.7500, lng: -70.7250 },
  'los andes': { lat: -32.8336, lng: -70.5983 },
  'rancagua': { lat: -34.1708, lng: -70.7444 },
  'san fernando': { lat: -34.5836, lng: -70.9889 },
  'talca': { lat: -35.4264, lng: -71.6554 },
  'curico': { lat: -34.9828, lng: -71.2394 },
  'linares': { lat: -35.8464, lng: -71.5933 },
  'chillan': { lat: -36.6066, lng: -72.1034 },
  'concepcion': { lat: -36.8270, lng: -73.0503 },
  'talcahuano': { lat: -36.7249, lng: -73.1168 },
  'san pedro de la paz': { lat: -36.8425, lng: -73.1050 },
  'coronel': { lat: -37.0281, lng: -73.1416 },
  'los angeles': { lat: -37.4697, lng: -72.3536 },
  'temuco': { lat: -38.7359, lng: -72.5904 },
  'padre las casas': { lat: -38.7667, lng: -72.6000 },
  'villarrica': { lat: -39.2856, lng: -72.2278 },
  'valdivia': { lat: -39.8142, lng: -73.2459 },
  'osorno': { lat: -40.5739, lng: -73.1336 },
  'puerto montt': { lat: -41.4693, lng: -72.9424 },
  'castro': { lat: -42.4826, lng: -73.7625 },
  'coyhaique': { lat: -45.5752, lng: -72.0662 },
  'punta arenas': { lat: -53.1638, lng: -70.9171 },
};

/** "Ñuñoa" → "nunoa" (para tolerar tildes y mayúsculas del usuario). */
function normalize(nombre) {
  return String(nombre)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coordenadas centrales de una comuna.
 * @returns {{lat:number, lng:number} | null} null si no se conoce la comuna.
 */
export function getComunaCoords(comuna) {
  if (!comuna) return null;
  return COORDS[normalize(comuna)] || null;
}

export default COORDS;
