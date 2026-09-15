/**
 * Construcción pura de la consulta de "Usuarios bloqueados".
 *
 * Vive acá, sin importar nada de Supabase, por la misma razón que
 * `nominaQuery.js` y `cambioQuery.js`: así se puede probar contra el esquema
 * versionado que TODAS las columnas que se piden existen de verdad.
 *
 * ESA PRUEBA NO ES DECORATIVA. Esta consulta llegó a pedir `profiles.nombre`,
 * una columna que no existe en ninguna migración —la cuarta vez que el repo
 * tropieza con la misma piedra, después de la nómina, los cambios y el
 * plantel—. PostgREST rechaza la consulta ENTERA con 400 y `42703` —«column
 * profiles_1.nombre does not exist»—, así que no se perdía el nombre de una
 * persona: se perdía la lista completa y la pantalla quedaba vacía. Un embed
 * inventado no degrada, tumba.
 *
 * No se había notado porque la migración 51 nunca estuvo aplicada: la consulta
 * moría antes, con `PGRST205` («no existe la tabla»), que el servicio sí sabía
 * tratar. Al aplicar la 51 el error habría cambiado de forma y la pantalla
 * habría quedado en blanco sin explicación.
 *
 * El nombre que se muestra sale de `username`, que es el único identificador de
 * persona que `profiles` tiene. No hace falta ninguna columna nueva.
 */

/** Columnas de `blocked_users` que la pantalla necesita. */
export const BLOCKED_USERS_COLUMNS = ['id', 'blocked_id', 'created_at'];

/** Columnas de `profiles` que se embeben para pintar cada fila. */
export const BLOCKED_USERS_PROFILE_COLUMNS = ['id', 'username', 'foto_url'];

/**
 * Nombre de la clave foránea por la que se embebe el perfil. PostgREST la
 * exige explícita porque `blocked_users` apunta dos veces a `profiles`
 * (`blocker_id` y `blocked_id`) y sin desambiguar responde 300.
 */
export const BLOCKED_USERS_PROFILE_FK = 'blocked_users_blocked_id_fkey';

/** El `select` completo que se le pasa a PostgREST. */
export function buildBlockedUsersSelect() {
  return (
    `${BLOCKED_USERS_COLUMNS.join(', ')}, ` +
    `profile:profiles!${BLOCKED_USERS_PROFILE_FK}(${BLOCKED_USERS_PROFILE_COLUMNS.join(', ')})`
  );
}
