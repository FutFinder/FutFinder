/**
 * La consulta de los dos clubes de un partido, sin depender de Supabase.
 *
 * Vive acá, con el cliente inyectado, para poder probar con uno falso lo que
 * `services/matches.js` no deja probar: ese módulo importa `./supabase` sin
 * extensión y bajo `node --test` ni siquiera carga.
 *
 * LO QUE SE PRUEBA NO ES EL COLOR, ES EL NOMBRE. `tema` requiere la migración
 * 53, que puede no estar aplicada. Con un `select` fijo, Postgres responde
 * 42703 y falla la consulta ENTERA: `club_local` y `club_visitante` quedarían
 * en `null` para TODOS los partidos de clubes, en Inicio y en Partidos, no
 * solo en la sección Clubes. No se verían sin color: se verían sin nombre y
 * sin escudo. Por eso la lectura es tolerante y por eso hay pruebas.
 */

import { leerTolerandoColumnas } from './columnasOpcionales.js';

/** Lo mínimo para pintar un club dentro de una tarjeta de partido. */
export const COLUMNAS_CLUB_DE_PARTIDO = 'id, nombre, foto_url, tema';

/**
 * Los clubes indicados, indexados por id.
 *
 * Devuelve un mapa vacío si la consulta falla por algo que no sea una columna
 * ausente: `clubesDelPartido()` pone entonces un nombre genérico, que es
 * mejor que media tarjeta en blanco.
 *
 * @param client   cliente de Supabase (o uno falso, en pruebas)
 * @param registro registro de columnas opcionales, de `columnasOpcionales.js`
 * @param ids      ids de club a traer
 */
export async function cargarClubesDePartido(client, { registro, ids } = {}) {
  const lista = (ids || []).filter(Boolean);
  if (!client || lista.length === 0) return new Map();

  const { data } = await leerTolerandoColumnas({
    registro,
    columnas: COLUMNAS_CLUB_DE_PARTIDO,
    leer: (columnas) => client.from('clubs').select(columnas).in('id', lista),
  });

  return new Map((data || []).map((c) => [c.id, c]));
}
