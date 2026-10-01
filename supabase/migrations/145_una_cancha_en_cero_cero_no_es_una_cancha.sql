-- =============================================================
-- 145. UNA CANCHA EN (0, 0) NO ES UNA CANCHA
--
-- `crear_propuesta_oficial` (43c), `aprobar_propuesta` (44) y
-- `cambio_partido_revisa_campos` (46) validan la latitud y la longitud
-- POR RANGO: `< -90 or > 90` y `< -180 or > 180`. El par (0, 0) está
-- dentro del rango, así que pasa.
--
-- En esta app ese par nunca es una cancha. Es la marca de que no se
-- eligió ninguna, porque `Number(null)` es 0 en JavaScript. El cliente ya
-- lo sabe: `construirCampos()` en `src/utils/cambioPartido.js` rechaza
-- exactamente `latitud === 0 && longitud === 0` con «Ubica la cancha en
-- el mapa antes de proponerla», y tiene prueba. O sea que hoy la única
-- vía sería una llamada directa a la RPC — pero esa vía existe.
--
-- LA REGLA ES LA DEL CLIENTE, NO UNA NUEVA. Se rechaza el par exacto
-- (0, 0), no «un punto dentro de Chile». Lo segundo sería una regla más
-- estricta que el cliente NO tiene, y volveríamos a dos reglas distintas
-- según por dónde entre la cancha, que es justo lo que este pendiente
-- pedía evitar. Si algún día se quiere exigir territorio, se cambian los
-- dos lados a la vez.
--
-- POR QUÉ RESTRICCIONES Y NO UNA EDICIÓN EN LAS TRES FUNCIONES
--   El pendiente decía «aplicarlo a las tres funciones». Se hace con
--   `check` sobre las tablas donde aterriza el dato, que cumple el mismo
--   propósito mejor:
--     · Es UNA regla declarativa por tabla, no tres copias de un `if`
--       dentro de tres cuerpos grandes que pueden divergir — y la
--       divergencia es exactamente el problema que estamos cerrando.
--     · Cubre a TODO el que escriba, no sólo a esas tres funciones:
--       `matches` también lo escribe la publicación de un partido
--       normal, que tenía el mismo agujero y nadie lo había mirado.
--     · No hay que reescribir funciones de 12 KB para agregar una línea,
--       que es como se cuelan los errores de transcripción.
--   Lo que se pierde: el rechazo llega como violación de restricción
--   (23514) y no como un `ok:false` con texto en español. Se acepta: a
--   esta ruta sólo se llega llamando la RPC a mano, saltándose la
--   pantalla que ya explica el error bien.
--
-- DÓNDE SE PONE, Y POR QUÉ EN CUATRO TABLAS
--   · `club_challenge_proposals` — corta `crear_propuesta_oficial` en la
--     fuente: una propuesta en (0,0) no llega a existir.
--   · `matches` — corta `aprobar_propuesta`. Comprobado que el cero
--     sobrevive al redondeo: `aproximar_grado(0)` es `0.00`, así que el
--     punto aproximado que se guarda ahí sigue siendo (0,0). De paso
--     cubre la publicación de un partido normal.
--   · `club_match_locations` — la ubicación EXACTA del partido de clubes
--     (44b), que viaja por separado del punto aproximado.
--   · `club_match_changes.campos` — el cambio negociado, donde la cancha
--     va anidada en el jsonb.
--
-- La de jsonb sólo rechaza cuando AMBOS son números y AMBOS son cero.
-- Si no son números, deja pasar: de eso ya se encarga la validación de
-- tipo de `cambio_partido_revisa_campos`, y una restricción que intente
-- castear basura fallaría con un error de casteo en vez de uno legible.
--
-- SE COMPROBÓ ANTES DE APLICAR que no hay ni una fila en (0,0) ni con un
-- solo cero: 27 partidos, 11 propuestas y 3 cambios, todos limpios. Estas
-- restricciones no invalidan nada que ya exista.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/145_una_cancha_en_cero_cero_no_es_una_cancha_test.sql
-- =============================================================

alter table public.club_challenge_proposals
  drop constraint if exists club_challenge_proposals_cancha_no_en_cero;
alter table public.club_challenge_proposals
  add constraint club_challenge_proposals_cancha_no_en_cero
  check (not (latitud = 0 and longitud = 0));

alter table public.matches
  drop constraint if exists matches_cancha_no_en_cero;
alter table public.matches
  add constraint matches_cancha_no_en_cero
  check (not (latitud = 0 and longitud = 0));

alter table public.club_match_locations
  drop constraint if exists club_match_locations_cancha_no_en_cero;
alter table public.club_match_locations
  add constraint club_match_locations_cancha_no_en_cero
  check (not (latitud = 0 and longitud = 0));

alter table public.club_match_changes
  drop constraint if exists club_match_changes_cancha_no_en_cero;
alter table public.club_match_changes
  add constraint club_match_changes_cancha_no_en_cero
  check (
    jsonb_typeof(campos -> 'cancha' -> 'latitud') is distinct from 'number'
    or jsonb_typeof(campos -> 'cancha' -> 'longitud') is distinct from 'number'
    or not (
      (campos -> 'cancha' ->> 'latitud')::numeric = 0
      and (campos -> 'cancha' ->> 'longitud')::numeric = 0
    )
  );
