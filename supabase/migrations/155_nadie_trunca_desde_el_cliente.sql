-- =============================================================
-- 155. NADIE TRUNCA DESDE EL CLIENTE
--
-- QUÉ PASA. `authenticated` tiene el privilegio `TRUNCATE` sobre **58
-- tablas** de `public`, incluidas `profiles`, `matches`, `messages` y
-- `pagos`. No lo pidió ninguna migración: es el reparto por omisión de
-- Supabase (`grant all on all tables in schema public to authenticated`),
-- que `pg_default_acl` vuelve a aplicar a cada tabla nueva.
--
-- POR QUÉ IMPORTA, Y POR QUÉ NO ES UNA ALARMA. **`TRUNCATE` no pasa por
-- RLS.** Todas las demás escrituras de esas tablas están contenidas por
-- políticas; ésta no lo estaría. Pero **hoy no es explotable**: PostgREST
-- no emite `TRUNCATE`, así que desde la app no existe el camino para
-- mandar esa sentencia. Esto es defensa en profundidad, no un agujero
-- abierto — conviene decirlo así para que nadie lea esta migración como
-- una urgencia que no fue.
--
-- Lo que sí es: el día que alguien escriba una función `security invoker`
-- con SQL dinámico, el camino aparece sin que nadie lo note. Un privilegio
-- que ninguna parte del producto usa no tiene por qué estar ahí esperando.
--
-- SÓLO SE QUITA `TRUNCATE`, Y ESO ES TODO. `insert`, `update` y `delete`
-- de `authenticated` se quedan intactos: ésos sí los usa la app y los
-- gobierna la RLS. Una migración que se llevara los cuatro rompería el
-- producto entero.
--
-- `service_role` Y `postgres` LO CONSERVAN. Son los que corren las
-- migraciones y las tareas de administración; quitárselo sería romper el
-- mantenimiento para cerrar una puerta por la que no se entra.
--
-- YA HABÍA MEDIA SOLUCIÓN, Y POR ESO `anon` ESTÁ EN CERO. El disparador de
-- eventos `anon_nace_sin_llaves` quita `insert, update, delete, truncate`
-- a `public` y `anon` en cada tabla nueva. No se toca: su nombre dice lo
-- que hace y `authenticated` NECESITA las tres primeras. Esta migración
-- añade un disparador hermano que se ocupa sólo de `truncate`, para los
-- tres roles. Que se solapen en `anon` es inofensivo: revocar dos veces no
-- hace nada.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/155_nadie_trunca_desde_el_cliente_test.sql
-- =============================================================

-- ── 1. Las 58 que ya están ───────────────────────────────────────
revoke truncate on all tables in schema public from public, anon, authenticated;

-- ── 2. Las que se creen mañana ───────────────────────────────────
-- Sin esto la lista se vuelve a llenar sola: `pg_default_acl` concede
-- `all` a `authenticated` en cada tabla que crea `postgres`, así que la
-- próxima migración que añada una tabla reabriría el hueco. Es la misma
-- lección de la 147 y de `anon_nace_sin_llaves`: los privilegios por
-- defecto no cierran lo futuro; el disparador sí.
--
-- SIN `security definer`, a propósito: corre con el rol que ejecuta el
-- DDL —`postgres` en una migración—, que ya es dueño de lo que acaba de
-- crear. Marcarlo `definer` sería darle un privilegio que no necesita.
create or replace function public.nadie_trunca_desde_el_cliente()
returns event_trigger
language plpgsql
set search_path to ''
as $$
declare
  o record;
begin
  for o in
    -- Sólo tablas: una vista o una secuencia no se truncan.
    select object_identity as nombre
      from pg_catalog.pg_event_trigger_ddl_commands()
     where schema_name = 'public'
       and object_type in ('table', 'foreign table')
       and command_tag in ('CREATE TABLE', 'CREATE TABLE AS',
                           'SELECT INTO', 'CREATE FOREIGN TABLE')
    union all
    -- Y las que llegan dentro de una extensión, igual que hace
    -- `anon_nace_sin_llaves`: entran sin pasar por un `CREATE TABLE`.
    select c.oid::pg_catalog.regclass::text
      from pg_catalog.pg_depend d
      join pg_catalog.pg_extension x on x.oid = d.refobjid
      join pg_catalog.pg_class c on c.oid = d.objid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
       and d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
       and d.deptype = 'e' and n.nspname = 'public'
       and c.relkind in ('r', 'p', 'f')
       and x.extname in (select object_identity
                           from pg_catalog.pg_event_trigger_ddl_commands()
                          where command_tag = 'CREATE EXTENSION')
  loop
    begin
      execute pg_catalog.format(
        'revoke truncate on %s from public, anon, authenticated', o.nombre);
    exception when others then
      -- Un aviso, nunca una excepción: esto corre DENTRO del DDL de otra
      -- migración, y hacerla fallar por no poder cerrar un privilegio
      -- sería peor que el privilegio abierto.
      raise warning 'nadie_trunca_desde_el_cliente no pudo cerrar %: %', o.nombre, sqlerrm;
    end;
  end loop;
end $$;

revoke all on function public.nadie_trunca_desde_el_cliente() from public, anon, authenticated;

comment on function public.nadie_trunca_desde_el_cliente() is
  'Quita TRUNCATE a public, anon y authenticated en cada tabla nueva de public. Existe porque pg_default_acl concede all a authenticated en cada tabla que crea postgres, y TRUNCATE es la unica escritura que NO pasa por RLS (migracion 155).';

drop event trigger if exists nadie_trunca_desde_el_cliente;
create event trigger nadie_trunca_desde_el_cliente
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO',
               'CREATE FOREIGN TABLE', 'CREATE EXTENSION')
  execute function public.nadie_trunca_desde_el_cliente();
