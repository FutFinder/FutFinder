/**
 * Quién puede aceptar o rechazar un desafío recibido.
 *
 * UNA SOLA REGLA PARA LAS DOS PANTALLAS. «Avisos» y «Desafíos» decidían lo
 * mismo por caminos distintos y las dos fallaban con una cuenta que
 * administra varios clubes:
 *
 *   · Avisos comparaba `getMyClub()` —el PRIMER club por `joined_at`—
 *     contra `clubRetadoId`. Con tres clubes administrados, sólo el más
 *     antiguo mostraba botones.
 *   · Desafíos deducía el rol de `listMembers(clubId)` y no distinguía «no
 *     soy admin» de «no pude averiguarlo»: el `error` del servicio se
 *     descartaba y un usuario nulo daba exactamente el mismo resultado.
 *
 * Acá vive la regla, sin React ni Supabase, y las dos pantallas preguntan lo
 * mismo. Es un ESPEJO, no la autoridad: quien decide de verdad es
 * `aceptar_desafio()`, que vuelve a comprobar la membresía administrativa
 * del club retado y el estado del desafío con los datos del servidor.
 *
 * `null` NO ES `[]`. Una lista vacía significa «este usuario no administra
 * ningún club»; `null` significa «no se pudo averiguar». Los dos esconden
 * los botones, pero sólo el segundo tiene que explicarse en pantalla: un
 * fallo silencioso disfrazado de falta de permisos es lo que dejó una
 * comprobación manual entera sin saber qué estaba pasando.
 */

/** Lo único que hace falta traer de `club_members` para decidir. */
export const COLUMNAS_MEMBRESIA_ADMIN = 'club_id';

/** El único estado en el que un desafío admite aceptar o rechazar. */
export const ESTADO_RESPONDIBLE = 'pendiente';

/**
 * Consulta de las membresías ADMINISTRATIVAS del usuario, en una sola ida.
 *
 * El rol se filtra dentro de la consulta y no después en JavaScript: traer
 * todas las membresías para descartarlas acá es lo que hacía cara la
 * comprobación, y lo caro es lo que empujó a la pantalla a preguntar por un
 * club a la vez —que es justamente de donde salió el fallo—.
 */
export function buildMisClubesAdminQuery(client, userId) {
  return client
    .from('club_members')
    .select(COLUMNAS_MEMBRESIA_ADMIN)
    .eq('user_id', userId)
    .eq('rol', 'admin');
}

/**
 * Ids de los clubes que administro, desde la forma de `getMyClubs()`
 * (`{ club, miRol, totalMiembros }`).
 *
 * Existe para las pantallas que ya cargaron esa lista por otros motivos y no
 * necesitan una consulta más.
 */
export function clubesAdminDeMisClubes(misClubes) {
  if (!Array.isArray(misClubes)) return [];
  return misClubes
    .filter((m) => m && m.miRol === 'admin' && m.club && m.club.id)
    .map((m) => m.club.id);
}

/**
 * ¿Puedo aceptar o rechazar este desafío?
 *
 * `clubesAdmin` son TODOS los clubes que administro, no el primero.
 *
 * `estado` es opcional a propósito: el payload del aviso `club_challenge` no
 * lo trae, y esconder el botón por no saberlo sería adivinar. Sin estado se
 * ofrece igual y contesta el servidor —«Este desafío ya no está
 * pendiente»—, que es lo que hacía el aviso viejo y funcionaba bien.
 */
export function puedeResponderDesafio({ clubesAdmin, clubRetadoId, estado } = {}) {
  if (!Array.isArray(clubesAdmin)) return false; // null/undefined = no se pudo averiguar
  if (!clubRetadoId) return false;
  if (!clubesAdmin.includes(clubRetadoId)) return false;
  if (estado === undefined || estado === null) return true; // el aviso no lo trae
  return estado === ESTADO_RESPONDIBLE;
}

/**
 * ¿Puedo cancelar este desafío que YO envié?
 *
 * La otra mitad de la bandeja, y NO se decide igual: en «Recibidos» mando si
 * administro el club retado; en «Enviados», el retador. Preguntar lo mismo en
 * las dos secciones hace desaparecer «Cancelar», porque en un desafío enviado
 * el club retado es el del rival.
 *
 * Acá el estado no es opcional: la bandeja siempre lo tiene, y cancelar algo
 * que ya se aceptó es otra operación distinta.
 */
export function puedeCancelarDesafio({ clubesAdmin, clubRetadorId, estado } = {}) {
  if (!Array.isArray(clubesAdmin)) return false;
  if (!clubRetadorId) return false;
  if (!clubesAdmin.includes(clubRetadorId)) return false;
  return estado === ESTADO_RESPONDIBLE;
}
