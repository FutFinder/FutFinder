/**
 * Descargar un archivo desde la versión web, sin servidor de por medio.
 *
 * POR QUÉ NO EL PORTAPAPELES. «Exportar mis datos» copiaba el JSON con
 * `navigator.clipboard.writeText` DESPUÉS de esperar la respuesta del
 * servidor. Safari sólo deja copiar dentro del mismo toque del usuario, y
 * ningún navegador deja copiar desde una ventana que no está activa: en la
 * prueba del 2026-11-18 respondió «No se pudo copiar». Además, un JSON
 * pegado a mano no es «tus datos en un archivo». Descargar un `.json` con
 * un enlace temporal funciona en todos los navegadores y no necesita ese
 * permiso.
 *
 * `documento` y `urls` llegan por parámetro (por omisión, los del
 * navegador) para poder probarlo con `node --test` sin un DOM.
 */

/** `futfinder-mis-datos-2026-11-19.json`, con la fecha local de hoy. */
export function nombreArchivoExport(fecha = new Date()) {
  const d = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `futfinder-mis-datos-${d.getFullYear()}-${mm}-${dd}.json`;
}

/**
 * Descarga `texto` como un archivo llamado `nombre`.
 * Devuelve true si pudo iniciar la descarga; false si no hay navegador.
 */
export function descargarArchivo(texto, nombre, {
  tipo = 'application/json',
  documento = typeof document !== 'undefined' ? document : null,
  urls = typeof URL !== 'undefined' ? URL : null,
  CrearBlob = typeof Blob !== 'undefined' ? Blob : null,
} = {}) {
  if (!documento || !urls?.createObjectURL || !CrearBlob) return false;
  const url = urls.createObjectURL(new CrearBlob([texto], { type: `${tipo};charset=utf-8` }));
  const enlace = documento.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.rel = 'noopener';
  enlace.style.display = 'none';
  documento.body.appendChild(enlace);
  try {
    enlace.click();
  } finally {
    documento.body.removeChild(enlace);
    // Se libera después: revocarlo en el mismo tick cancela la descarga en
    // algunos navegadores.
    setTimeout(() => urls.revokeObjectURL(url), 1000);
  }
  return true;
}
