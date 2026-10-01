/**
 * Qué columnas de `profiles` puede pedir el cliente, y cuáles no.
 *
 * POR QUÉ EXISTE ESTA LISTA. Hasta la migración 148, todo el mundo pedía
 * `select('*')` y la base lo permitía. Esa migración le quita a `anon` y
 * a `authenticated` el `select` de TABLA y les concede sólo las columnas
 * públicas, así que un `*` pasa a fallar con `permission denied` — para
 * el perfil propio también, porque los privilegios por columna no son por
 * fila. Nueve columnas quedan fuera: las dos de privacidad, las cuatro de
 * avisos y las tres de preferencia de búsqueda.
 *
 * LO PROPIO NO SE PIERDE: viaja por la RPC `mis_ajustes()`, que devuelve
 * esas nueve y sólo las de quien llama. `getMyProfile()` las vuelve a
 * pegar al objeto, así que las pantallas no notan el cambio.
 *
 * SI SE AGREGA UNA COLUMNA A `profiles`, hay que agregarla acá Y
 * concederla en una migración. Si falta una de las dos cosas, la columna
 * simplemente no llega — y es un defecto que se nota enseguida, no en
 * silencio.
 */

/** Las nueve que la 148 deja fuera del alcance del cliente. */
export const AJUSTES_PRIVADOS = [
  'privacy_friend_requests',
  'privacy_visible_in_search',
  'notif_matches',
  'notif_clubs',
  'notif_chat',
  'notif_friends',
  'pref_region',
  'pref_comuna',
  'search_radius_km',
];

/** Todo lo demás, que es lo que el cliente puede pedir de cualquier perfil. */
export const COLUMNAS_PUBLICAS = [
  'id',
  'username',
  'foto_url',
  'banner_url',
  'posicion_preferida',
  'flanco',
  'edad',
  'bio',
  'region',
  'comuna',
  'modalidad',
  'nivel',
  'trust_score',
  'partidos_jugados',
  'asistencias_confirmadas',
  'mvps',
  'rating_puntualidad_avg',
  'rating_fairplay_avg',
  'rating_nivel_avg',
  'rating_count',
  'estado',
  'suspended_until',
  'onboarding_completed',
  'latitud',
  'longitud',
  'location_updated_at',
  'truescore_racha',
  'fairplay_score',
  'fairplay_revision',
  'created_at',
  'updated_at',
].join(', ');
