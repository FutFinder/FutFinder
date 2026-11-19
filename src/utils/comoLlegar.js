/**
 * «Cómo llegar»: el enlace que abre el mapa del teléfono con la ruta.
 *
 * En iPhone, Apple Maps (`maps.apple.com`, que iOS abre en la app Mapas);
 * en Android y en la web, Google Maps (`google.com/maps/dir`, que Android
 * abre en la app si está y la web en una pestaña). Los dos son https: no
 * hace falta preguntar `canOpenURL` ni declarar esquemas en `app.config.js`.
 *
 * Con coordenadas válidas se usa el punto exacto, que es lo que lleva a la
 * puerta; sin ellas, la dirección escrita (nombre, dirección y comuna), que
 * el mapa busca. Sin ninguna de las dos devuelve null y el botón no se
 * dibuja: un «Cómo llegar» que no lleva a ninguna parte es peor que nada.
 *
 * Sin React Native a propósito: la plataforma llega por parámetro para
 * poder probarlo con `node --test`.
 */

function coordenadas(lugar) {
  const lat = Number(lugar?.latitud);
  const lng = Number(lugar?.longitud);
  if (lugar?.latitud == null || lugar?.longitud == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // (0, 0) es lo que queda cuando nadie cargó la ubicación: está en el mar.
  if (lat === 0 && lng === 0) return null;
  return `${lat},${lng}`;
}

function direccionEscrita(lugar) {
  const partes = [lugar?.nombre, lugar?.direccion, lugar?.comuna]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  return partes.length ? partes.join(', ') : null;
}

/**
 * @param {{ latitud?, longitud?, nombre?, direccion?, comuna? }} lugar
 * @param {string} plataforma `Platform.OS`: 'ios', 'android' o 'web'.
 * @returns {string|null}
 */
export function enlaceComoLlegar(lugar, plataforma) {
  const punto = coordenadas(lugar);
  const texto = direccionEscrita(lugar);
  if (!punto && !texto) return null;

  if (plataforma === 'ios') {
    const destino = punto || encodeURIComponent(texto);
    const etiqueta = lugar?.nombre ? `&q=${encodeURIComponent(String(lugar.nombre).trim())}` : '';
    return `https://maps.apple.com/?daddr=${destino}${punto ? etiqueta : ''}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${punto || encodeURIComponent(texto)}`;
}
