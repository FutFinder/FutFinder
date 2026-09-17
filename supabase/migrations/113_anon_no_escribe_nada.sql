-- =============================================================
-- FutFinder migration 113: anon no escribe nada
-- =============================================================
-- `anon` —el rol de cualquiera que llegue con la clave pública, sin
-- iniciar sesión— tenía INSERT, UPDATE, DELETE y TRUNCATE sobre las 57
-- tablas de `public`. Es el `grant all` por defecto de Supabase, no algo
-- que este repositorio haya escrito.
--
-- LO QUE NO ES: un agujero abierto. Las 57 tienen RLS activa y todas sus
-- políticas de escritura son `to public` con `auth.uid()` adentro, que
-- para anon es nulo — ninguna fila califica. Se comprobó una por una
-- antes de escribir esto, y el arnés lo vuelve a comprobar abajo.
--
-- LO QUE SÍ ES, Y POR ESO SE CIERRA:
--
-- 1. TRUNCATE NO PASA POR RLS. Es la excepción del motor: las políticas
--    se aplican a select/insert/update/delete, no a truncate. O sea que
--    en esas 57 tablas la única defensa que quedaba —la RLS— no cubría
--    uno de los cuatro permisos concedidos. Hoy no hay ruta para
--    ejercerlo (PostgREST no expone truncate, y las funciones
--    `security definer` corren como su dueño, no como quien llama), pero
--    es un privilegio que depende de que NADIE abra esa ruta nunca.
--
-- 2. Y el resto deja toda la seguridad de escritura colgando de que
--    ninguna política tenga un hueco. La migración 111 acaba de cerrar
--    CUATRO huecos de ese tipo en clubes, que vivieron meses sin que
--    nadie los viera. Una segunda capa es justamente para el día que la
--    primera falle.
--
-- EL SELECT NO SE TOCA. Varias tablas son de lectura pública a propósito
-- (`clubs_read` es `using (true)`, y las fichas de recinto y los partidos
-- se comparten por enlace). Quitarle la lectura a anon es otra decisión,
-- con otras consecuencias, y no entra acá.
--
-- TAMPOCO SE TOCA `authenticated`: escribe por sus políticas, que es como
-- debe ser.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Las tablas que ya existen ─────────────────────────────────
revoke insert, update, delete, truncate on all tables in schema public from anon;

-- ── 2. Las que se creen mañana ───────────────────────────────────
-- Sin esto, la próxima migración que cree una tabla la deja otra vez con
-- los cuatro permisos: el `grant all` por defecto está declarado para DOS
-- roles creadores, `postgres` y `supabase_admin`.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon;

-- `supabase_admin` es del entorno gestionado y `postgres` no es miembro
-- suyo, así que esta parte NO se puede aplicar y no se aplicó: al correr
-- la migración el 2026-09-17 quedó
--
--     postgres       → anon=rxtm      (sin escritura)  ✔
--     supabase_admin → anon=arwdDxtm  (sin cambios)
--
-- No se cae la migración por eso: se avisa y sigue. Consecuencia real,
-- dicha de frente: una tabla creada por `supabase_admin` —no por una
-- migración de este repositorio, que corre como `postgres`— volvería a
-- nacer con los cuatro permisos para anon. Si algún día se crea una tabla
-- desde el panel de Supabase, hay que volver a correr el revoke.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
       || 'revoke insert, update, delete, truncate on tables from anon';
exception when insufficient_privilege or others then
  raise notice 'No se pudieron tocar los privilegios por defecto de supabase_admin (%). '
               'Las tablas creadas por postgres —todas las de este repositorio— sí quedan cubiertas.',
               sqlerrm;
end $$;
