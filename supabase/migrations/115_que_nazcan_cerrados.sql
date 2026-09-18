-- =============================================================
-- FutFinder migration 115: que nazcan cerrados, los cree quien los cree
-- =============================================================
-- Cierra el agujero que las migraciones 113 y 114 dejaron por escrito y
-- no pudieron tapar: los PRIVILEGIOS POR DEFECTO de `supabase_admin`.
--
-- EL PROBLEMA, MEDIDO
--
-- `public` tiene dos juegos de privilegios por defecto, uno por cada rol
-- que puede crear objetos ahí:
--
--     postgres       → tablas anon=rxtm       (sin escritura)   ✔ 113
--                    → funciones sin anon ni PUBLIC             ✔ 114
--     supabase_admin → tablas anon=arwdDxtm   (escritura completa)
--                    → funciones anon=X       (ejecución)
--
-- El segundo no se puede tocar: `postgres` no es superusuario ni miembro
-- de `supabase_admin`, así que `alter default privileges for role
-- supabase_admin` falla. Las dos migraciones lo dejaron anotado y siguieron.
--
-- Y NO BASTA CON VOLVER A CORRER EL REVOKE. Esa era la salida que 113 y 114
-- proponían («si algún día se crea una tabla desde el panel, hay que volver
-- a correr el revoke»). Se probó, y NO FUNCIONA: `postgres` no puede
-- deshacer un permiso que otorgó `supabase_admin`. Se comprobó sobre
-- `graphql_public`, donde supabase_admin es dueño y anon tiene EXECUTE:
--
--     revoke execute on all functions in schema graphql_public from anon;
--     -- no lanza error, y el ACL queda EXACTAMENTE IGUAL
--
-- Un REVOKE sólo retira lo que concedió quien lo ejecuta. Falla en
-- silencio, sin error y sin efecto, que es la peor forma de fallar: el
-- arnés diría «revocado» y el permiso seguiría ahí.
--
-- LA SALIDA: UN DISPARADOR DE EVENTOS, Y QUE NO SEA `security definer`
--
-- Una función de disparador de eventos normal —SECURITY INVOKER— se
-- ejecuta con los privilegios de QUIEN LANZÓ EL DDL. O sea que si mañana
-- `supabase_admin` crea una tabla en `public`, el disparador corre COMO
-- `supabase_admin`, y ahí el revoke sí retira lo que supabase_admin acaba
-- de conceder.
--
-- Por eso esta función NO lleva `security definer`. En este repositorio
-- todas las demás lo llevan; aquí sería exactamente el error: la volvería
-- a correr como `postgres` y no serviría para nada. El arnés lo comprueba.
--
-- Deja de depender de los privilegios por defecto, que hay que arreglar
-- rol por rol, y pasa a depender del acto de crear, que es uno solo. Cubre
-- a `supabase_admin`, a `postgres`, al panel y a cualquier rol que venga.
-- Es el mismo patrón que usa Supabase para `issue_pg_cron_access`.
--
-- NUNCA BLOQUEA EL DDL. Un disparador de eventos que lanza una excepción
-- aborta el CREATE que lo disparó. Si esto fallara durante una operación
-- interna de la plataforma, rompería la base. Cada revoke va en su propio
-- bloque con `exception when others`: avisa y sigue.
--
-- Y HAY UN SEGUNDO HALLAZGO, MÁS GRAVE, QUE ESTA MIGRACIÓN ARREGLA DE
-- PASO. La 114 creía dejar cubiertas las funciones FUTURAS con
--
--     alter default privileges for role postgres in schema public
--       revoke execute on functions from public, anon;
--
-- ESO NO FUNCIONA, y se midió: hoy, con esa línea ya aplicada, una función
-- nueva creada por `postgres` en `public` nace igual con
--
--     {=X/postgres, postgres=X, authenticated=X, service_role=X}
--          ↑ PUBLIC, o sea que anon la ejecuta
--
-- El privilegio guardado en `pg_default_acl` NO lleva `=X` —el revoke sí
-- quedó anotado— pero al crear el objeto el motor parte del valor por
-- defecto de fábrica, que para las funciones incluye EXECUTE a PUBLIC, y
-- encima le aplica lo guardado. Volver a correr el revoke no cambia nada:
-- se probó dos veces en la misma transacción, con el mismo resultado.
--
-- O sea que de la 114 quedó cerrado lo que YA existía, y no lo que viniera
-- después. La próxima migración que creara una función la habría dejado
-- abierta a anon sin que nadie se enterara. El disparador es hoy lo único
-- que cierra ese caso, también para `postgres`.
--
-- LO QUE NO CUBRE, MEDIDO Y DICHO DE FRENTE: una EXTENSIÓN instalada en
-- `public`. `create extension` no dispara `ddl_command_end` en este motor
-- —se comprobó con un espía— así que sus funciones nacen ejecutables por
-- anon. No es la vía por la que la plataforma crea cosas (`pg_net` y
-- `supabase_vault` viven en `extensions` y en `vault`, no en `public`),
-- pero sí lo sería si alguien corriera `create extension ... with schema
-- public` desde el editor. El arnés lo vigila en C7 y lo fija en L1.
--
-- CERRADO POR LA 116, por otra vía: no hay disparador posible —supautils
-- los aparta a propósito— así que el barrido es periódico y devuelve la
-- extensión a `extensions`, que es donde ya viven las otras cuatro.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La función ────────────────────────────────────────────────
create or replace function public.anon_nace_sin_llaves()
returns event_trigger
language plpgsql
-- A propósito SIN `security definer`: ver arriba. Es el punto entero.
set search_path = ''
as $$
declare
  o record;
begin
  for o in
    -- Dos orígenes, una sola lista de (tipo, nombre) que cerrar.
    --
    -- El primero son los objetos que el DDL nombra directamente.
    select case
             when object_type in ('table','view','materialized view','foreign table') then 'tabla'
             when object_type = 'sequence' then 'secuencia'
             else 'rutina'
           end as tipo,
           object_identity as nombre
      from pg_catalog.pg_event_trigger_ddl_commands()
     where schema_name = 'public'
       and object_type in ('table','view','materialized view','foreign table',
                           'sequence','function','procedure','aggregate')
       -- Sólo creaciones. Filtrar por etiqueta deja fuera GRANT y REVOKE,
       -- y eso resuelve dos cosas de una: que una concesión explícita a
       -- anon no se deshaga sola, y que el propio revoke de aquí abajo no
       -- se dispare a sí mismo.
       and command_tag in (
         'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO',
         'CREATE FOREIGN TABLE', 'CREATE VIEW', 'CREATE MATERIALIZED VIEW',
         'CREATE SEQUENCE', 'CREATE FUNCTION', 'CREATE PROCEDURE',
         'CREATE AGGREGATE')

    union all

    -- El segundo son los objetos QUE TRAE UNA EXTENSIÓN. HOY ESTA PARTE NO
    -- SE EJECUTA NUNCA, y queda escrita a propósito. Lo midió el ensayo:
    -- en este Postgres (17.6, Supabase) `create extension` NO dispara
    -- `ddl_command_end`. Se comprobó con un espía que anotaba cada disparo:
    --
    --     create extension unaccent with schema public;  → ni un disparo
    --     create index ... ;                             → disparo, 1 fila
    --
    -- Y la extensión quedó instalada en `public` con sus cuatro funciones
    -- ejecutables por anon. O sea: una extensión instalada en `public` es
    -- un hueco que este disparador NO tapa, y conviene decirlo aquí y no
    -- en un commit. El arnés lo fija en L1 para que avise si cambia.
    --
    -- Se deja escrito porque el día que el motor sí dispare —o que alguien
    -- llegue por otra vía— la rama ya está y es correcta; y porque el hueco
    -- se documenta mejor donde vive. Hoy la subconsulta no devuelve filas.
    select case when c.relkind = 'S' then 'secuencia' else 'tabla' end,
           c.oid::pg_catalog.regclass::text
      from pg_catalog.pg_depend d
      join pg_catalog.pg_extension x on x.oid = d.refobjid
      join pg_catalog.pg_class c on c.oid = d.objid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
       and d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
       and d.deptype = 'e' and n.nspname = 'public'
       and c.relkind in ('r','p','v','m','f','S')
       and x.extname in (select object_identity
                           from pg_catalog.pg_event_trigger_ddl_commands()
                          where command_tag = 'CREATE EXTENSION')

    union all

    select 'rutina', p.oid::pg_catalog.regprocedure::text
      from pg_catalog.pg_depend d
      join pg_catalog.pg_extension x on x.oid = d.refobjid
      join pg_catalog.pg_proc p on p.oid = d.objid
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
       and d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
       and d.deptype = 'e' and n.nspname = 'public'
       and x.extname in (select object_identity
                           from pg_catalog.pg_event_trigger_ddl_commands()
                          where command_tag = 'CREATE EXTENSION')
  loop
    begin
      if o.tipo = 'tabla' then
        -- El SELECT no se toca: varias tablas son de lectura pública a
        -- propósito, igual que en la 113.
        execute pg_catalog.format(
          'revoke insert, update, delete, truncate on %s from public, anon', o.nombre);

      elsif o.tipo = 'secuencia' then
        execute pg_catalog.format(
          'revoke update, usage on sequence %s from public, anon', o.nombre);

      else
        -- `routine` y no `function`: REVOKE no acepta `on aggregate`.
        -- Y `from public, anon`, que es la lección de la 114: quitarle el
        -- permiso a uno no se lo quita al otro.
        execute pg_catalog.format(
          'revoke execute on routine %s from public, anon', o.nombre);
      end if;

    exception when others then
      -- Avisa, pero jamás aborta el CREATE que lo disparó.
      raise warning 'anon_nace_sin_llaves no pudo cerrar % %: %', o.tipo, o.nombre, sqlerrm;
    end;
  end loop;
end $$;

comment on function public.anon_nace_sin_llaves() is
  'Cierra a anon y a PUBLIC toda tabla, vista, secuencia o rutina nueva de '
  'public. Sin security definer a propósito: corre como quien crea, que es la '
  'única forma de retirar lo que concedieron los privilegios por defecto de '
  'supabase_admin. No alcanza a create extension: el motor no dispara ahí.';

-- El huevo y la gallina: esta función se crea cuando el disparador todavía
-- no existe, así que nace abierta a PUBLIC como cualquier otra. Se cierra a
-- mano. Es la demostración más corta del hallazgo de arriba.
revoke execute on function public.anon_nace_sin_llaves() from public, anon;

-- ── 2. El disparador ─────────────────────────────────────────────
drop event trigger if exists anon_nace_sin_llaves;
create event trigger anon_nace_sin_llaves
  on ddl_command_end
  execute function public.anon_nace_sin_llaves();

-- ── 3. La secuencia que la 113 no alcanzó ────────────────────────
-- La 113 revocó sobre tablas y no sobre secuencias, así que
-- `push_tickets_id_seq` quedó con `anon=rwU`: anon podía gastarle
-- identificadores. Es la única del esquema. Se cierra acá para que lo que
-- ya existe coincida con lo que el disparador exige a lo que nazca.
revoke update, usage on all sequences in schema public from public, anon;
alter default privileges for role postgres in schema public
  revoke update, usage on sequences from public, anon;
