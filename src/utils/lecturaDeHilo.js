/**
 * Cuándo un hilo de chat se puede dar por leído.
 *
 * Vive acá, sin Supabase ni React, para poder probarse: la pantalla del hilo
 * (`ChatThreadScreen`) arrastra media aplicación.
 *
 * ── C01: NO SE MARCA LEÍDO LO QUE NO SE PUDO DESCARGAR ────────────────────
 *
 * La carga inicial llamaba `markThreadAsRead` aunque la consulta de mensajes
 * hubiera fallado y la pantalla mostrara «No pudimos cargar los mensajes». El
 * servidor avanzaba `last_read_at` (y en un DM también `read_at`): se perdía
 * la señal de pendientes y el remitente veía «leído» un mensaje que el
 * receptor nunca tuvo en pantalla. Sólo una carga que llegó entera cuenta.
 */

/** ¿La carga inicial del hilo autoriza a marcarlo leído? */
export function cargaPermiteMarcarLeido(page) {
  if (!page || page.error) return false;
  return Array.isArray(page.data);
}
