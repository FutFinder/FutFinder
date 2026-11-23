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

/*
 * ── C02: UN MENSAJE QUE LLEGA NO ESTÁ LEÍDO HASTA QUE SE VE ───────────────
 *
 * La suscripción Realtime vive mientras la pantalla está montada, y eso
 * incluye cuando Detalles del chat la tapa, cuando la app está en segundo
 * plano o cuando la persona está leyendo mensajes viejos más arriba. Cada
 * mensaje ajeno llamaba `markThreadAsRead` igual. Ahora el mensaje se recibe
 * y se pinta como siempre, pero el acuse espera a que se cumplan las tres
 * cosas: el hilo enfocado, la app activa y la lista cerca del final. Si no se
 * cumplen, queda pendiente y se manda en cuanto se cumplan.
 */

/** `AppState` dice 'active', 'background', 'inactive' o, al arrancar, 'unknown'. */
export function appEstaActiva(estado) {
  return estado !== 'background' && estado !== 'inactive';
}

/** ¿Lo que acaba de llegar está, de verdad, delante de la persona? */
export function puedeAcusarLectura({ enfocado, appActiva, cercaDelFinal } = {}) {
  return enfocado === true && appActiva === true && cercaDelFinal === true;
}

/**
 * El acuse de lectura de un hilo, con memoria de lo pendiente.
 *
 *   · `llegoAjeno(estado)`  un mensaje de otra persona: se marca ya si está a
 *                           la vista; si no, queda pendiente.
 *   · `revisar(estado)`     volvió el foco, la app o el scroll: si había algo
 *                           pendiente y ahora se ve, se marca una sola vez.
 */
export function crearAcuseDeLectura(marcar) {
  let pendiente = false;
  return {
    llegoAjeno(estado) {
      if (puedeAcusarLectura(estado)) {
        pendiente = false;
        marcar();
      } else {
        pendiente = true;
      }
    },
    revisar(estado) {
      if (pendiente && puedeAcusarLectura(estado)) {
        pendiente = false;
        marcar();
      }
    },
    get pendiente() {
      return pendiente;
    },
  };
}
