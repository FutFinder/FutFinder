/**
 * Kilómetros en español de Chile, para las tarjetas de clubes.
 *
 * Cerca, un decimal con coma («2,4 km»). Desde 100 km el decimal no dice nada
 * y el número largo sin separador se lee mal: va entero y con punto de miles
 * («1.673 km», no «1672,8 km»).
 *
 * Vive aparte de `clubMeta.js` porque ese archivo importa sin extensión y no
 * carga en las pruebas de Node.
 *
 * @returns {string} 'Distancia desconocida' si km es null/undefined.
 */
export function formatDistanciaKm(km) {
  if (km === null || km === undefined || Number.isNaN(Number(km))) {
    return 'Distancia desconocida';
  }
  const n = Number(km);
  // Bajo 100 m no tiene sentido mostrar decimales de km.
  if (n < 0.1) return 'menos de 0,1 km';
  if (n >= 100) {
    const entero = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${entero} km`;
  }
  return `${n.toFixed(1).replace('.', ',')} km`;
}
