/**
 * Límites de integrantes y administradores por plan.
 *
 * Viven acá y no en `services/clubs.js` porque los necesita código que se
 * prueba sin red: ese servicio importa `./supabase` sin extensión, que solo
 * resuelve Metro, así que requerirlo bajo `node --test` falla. El servicio los
 * re-exporta para que sus llamadores no cambien.
 *
 * El servidor manda: el trigger `check_user_club_limit` de la migración 11
 * valida lo mismo. Estos números son para AVISAR antes, no para autorizar.
 */
export const CLUB_LIMITS = Object.freeze({
  estandar: Object.freeze({ miembros: 15, admins: 1 }),
  premium: Object.freeze({ miembros: 26, admins: 3 }),
});
