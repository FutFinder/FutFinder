/**
 * Tope de integrantes y administradores de un club. Es el mismo para todos:
 * los clubes no tienen plan desde la migración 152.
 *
 * Vive acá y no en `services/clubs.js` porque lo necesita código que se
 * prueba sin red: ese servicio importa `./supabase` sin extensión, que solo
 * resuelve Metro, así que requerirlo bajo `node --test` falla. El servicio lo
 * re-exporta para que sus llamadores no cambien.
 *
 * El servidor manda: `check_club_limits()`, colgado del trigger
 * `trg_check_club_limits` sobre `club_members`, valida estos mismos números
 * (migración 152) y lanza excepción si se pasan. Estos son para AVISAR antes,
 * no para autorizar.
 *
 * NO CONFUNDIR con `check_user_club_limit()` de la migración 24, que es otra
 * cosa: limita a 3 los clubes a los que puede pertenecer UN JUGADOR. Este
 * archivo no habla de eso.
 */
export const CLUB_LIMITS = Object.freeze({ miembros: 26, admins: 3 });
