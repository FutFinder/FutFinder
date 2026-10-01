-- =============================================================
-- 147. UNA FUNCIÓN DE TRIGGER NO ES UN ENDPOINT
--
-- De las 53 funciones de trigger de `public`, `authenticated` podía
-- ejecutar 42. `anon` y `public` ya ejecutaban 0 desde la migración 114.
-- Lo que quedaba era el rol con sesión.
--
-- NO ES UN AGUJERO, Y CONVIENE DECIRLO PRIMERO: llamar a una función de
-- trigger directamente falla con `0A000 — trigger functions can only be
-- called as triggers`. Hoy no se les puede sacar nada. Es superficie
-- expuesta en PostgREST, no una puerta. Se cierra porque una superficie
-- que no hace falta es una superficie que no se audita.
--
-- POR QUÉ LA LISTA NO SE CIERRA SOLA, que es la parte que importa.
-- `pg_default_acl` tiene, para el rol `postgres` y tipo función en
-- `public`:
--
--     {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
-- O sea que TODA función creada por `postgres` —y todas las migraciones
-- corren como `postgres`— nace con un `execute` EXPLÍCITO para
-- `authenticated`. No es el `grant` implícito a `PUBLIC` que cerró la
-- 114: es una concesión propia, y por eso revocarle a `public` no la
-- toca. Las funciones de trigger recientes que sí están cerradas
-- —`tg_truescore_*`, `tg_waitlist_no_expulsados`— lo están porque su
-- migración lo revocó a mano, una por una.
--
-- Cambiar ese `alter default privileges` NO es la salida: se lo llevaría
-- también a las 162 RPC que el cliente sí necesita ejecutar. Por eso va
-- un disparador de eventos acotado a las funciones de TRIGGER, que no
-- necesitan `execute` para nadie, nunca.
--
-- EL DISPARADOR ES NUEVO Y NO TOCA EL DE LA 115. `anon_nace_sin_llaves`
-- cierra `public` y `anon` sobre toda rutina nueva; si se le agregara
-- `authenticated` rompería cada RPC nueva del cliente. Éste mira sólo el
-- tipo de retorno `trigger`, así que no puede alcanzar a una RPC ni por
-- error. Los dos componen: el de la 115 para todo, éste para los
-- disparadores.
--
-- SE COMPROBÓ ANTES DE REVOCAR que ninguna de las 42 la llama el cliente:
-- se cruzaron sus nombres contra los 111 `.rpc(` distintos de `src/` y de
-- las Edge Functions. Cero coincidencias.
--
-- LA TRAMPA, Y POR QUÉ EL ARNÉS DISPARA TRIGGERS DE VERDAD: revocar el
-- `EXECUTE` no desactiva un trigger —PostgreSQL comprueba ese privilegio
-- al CREAR el trigger, no en cada disparo—, pero si alguna vez dejara de
-- aplicarse una regla el fallo sería SILENCIOSO: ninguna pantalla se
-- rompe, sólo se pierde la validación. Comprobar los privilegios no
-- alcanza; hay que ver disparar. El arnés dispara cuatro.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/147_una_funcion_de_trigger_no_es_un_endpoint_test.sql
-- =============================================================

-- ── 1. Las que ya existen ────────────────────────────────────────
do $$
declare
  f record;
  v_n int := 0;
begin
  for f in
    select p.oid::regprocedure::text as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
    v_n := v_n + 1;
  end loop;
  raise notice 'Cerradas % funciones de trigger', v_n;
end $$;

-- ── 2. Las que se creen mañana ───────────────────────────────────
create or replace function public.los_triggers_nacen_sin_endpoint()
returns event_trigger
language plpgsql
set search_path to ''
as $$
declare
  o record;
begin
  for o in
    select p.oid::pg_catalog.regprocedure::text as firma
      from pg_catalog.pg_event_trigger_ddl_commands() ev
      join pg_catalog.pg_proc p on p.oid = ev.objid
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where ev.command_tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
       and n.nspname = 'public'
       and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
  loop
    begin
      execute pg_catalog.format(
        'revoke execute on function %s from public, anon, authenticated', o.firma);
    exception when others then
      raise warning 'los_triggers_nacen_sin_endpoint no pudo cerrar %: %', o.firma, sqlerrm;
    end;
  end loop;
end $$;

revoke all on function public.los_triggers_nacen_sin_endpoint() from public, anon, authenticated;

comment on function public.los_triggers_nacen_sin_endpoint() is
  'Quita el execute de public, anon y authenticated a toda funcion de trigger nueva de public. Existe porque pg_default_acl concede execute a authenticated en cada funcion que crea postgres, y una funcion de trigger no necesita ese privilegio para nadie (migracion 147).';

drop event trigger if exists los_triggers_nacen_sin_endpoint;
create event trigger los_triggers_nacen_sin_endpoint
  on ddl_command_end
  when tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
  execute function public.los_triggers_nacen_sin_endpoint();
