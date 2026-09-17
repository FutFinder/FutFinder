-- =============================================================
-- FutFinder migration 114: anon no ejecuta nada, y el cron es del cron
-- =============================================================
-- La compañera de la 113. Aquella cerró las TABLAS; esta cierra las
-- FUNCIONES, que era la mitad que quedaba abierta.
--
-- EL REVOKE QUE TODAS LAS MIGRACIONES ESCRIBEN NO SIRVE. Casi todas las
-- migraciones de este repositorio cierran sus funciones así:
--
--     revoke execute on function public.f(...) from public;
--     grant  execute on function public.f(...) to authenticated;
--
-- Pero Supabase trae un `alter default privileges in schema public grant
-- all on functions to anon, authenticated, service_role`, que concede
-- EXECUTE a `anon` de forma DIRECTA. `revoke ... from public` quita el
-- privilegio del pseudo-rol PUBLIC, no el que tiene anon a su nombre. Así
-- que anon se quedaba con él, migración tras migración.
--
-- Resultado medido el 2026-09-17: de 171 funciones `security definer` en
-- `public`, **56 las podía ejecutar anon**, más 24 `security invoker`.
-- Contando las dos vías —concesión directa y herencia de PUBLIC— eran
-- 146 permisos de EXECUTE repartidos entre anon y PUBLIC.
--
-- QUÉ ERAN ESAS 56
--
--   37 son funciones de TRIGGER. PostgREST no las expone y Postgres se
--      niega a ejecutarlas fuera de un trigger, así que el permiso no
--      servía para nada. Se quitan por higiene.
--
--   19 son RPC de verdad. Casi todas se defienden solas —`if auth.uid()
--      is null then raise`— o filtran por `auth.uid()`, que para anon es
--      nulo y no devuelve nada. Pero eso es la función defendiéndose, no
--      la puerta estando cerrada.
--
-- Y CINCO ERAN TAREAS DEL CRON, que es el hallazgo que justifica el
-- commit. `send_match_reminders` y `send_rating_reminders` corren cada 5
-- minutos y MANDAN PUSH. Cualquiera con la clave anónima —que viaja
-- dentro del bundle de la app— podía invocarlas en bucle.
--
-- CORRECCIÓN, ANOTADA DESPUÉS (ver migración 115)
--
-- La sección 2 de abajo —`alter default privileges ... revoke execute on
-- functions from public, anon`— NO protege a las funciones futuras. Se
-- midió con la línea ya aplicada: una función nueva creada por `postgres`
-- en `public` nace igual con EXECUTE para PUBLIC, porque al crear el objeto
-- el motor parte del valor de fábrica —que incluye a PUBLIC— y encima le
-- aplica lo guardado. Lo que esta migración cerró de verdad fue lo que YA
-- existía. Lo futuro lo cierra el disparador de eventos de la 115.
--
-- ── Sección 2: el cron es del cron ───────────────────────────────
--
-- Por eso esta migración hace algo más que quitarle permisos a anon: a
-- las SIETE funciones que sólo dispara `cron.job` les quita el EXECUTE
-- también a `authenticated`. Ninguna se llama desde la app ni desde una
-- Edge Function (comprobado sobre `src/` y `supabase/functions/`), y
-- dejarlas abiertas significaba que cualquier persona CON cuenta también
-- podía disparar el envío de notificaciones.
--
-- El cron no se ve afectado: `cron.job` las ejecuta como `postgres`.
--
-- LO QUE NO SE TOCA: `authenticated` conserva todo lo demás —la app llama
-- 88 RPC y las necesita— y `service_role` queda intacto.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. anon no ejecuta nada en `public` ──────────────────────────
--
-- HAY QUE REVOCAR DE `public` Y DE `anon`, y eso lo enseñó el dry-run: la
-- primera versión revocaba sólo de `anon` y dejaba **68 funciones**
-- ejecutables igual. El motivo es el espejo exacto del error que este
-- repositorio ya tenía escrito al revés: `postgres` había concedido
-- EXECUTE a `anon` de forma directa en 78 funciones Y al pseudo-rol
-- PUBLIC en otras 68. Quitarle una no quita la otra, y anon hereda de
-- PUBLIC.
--
-- Quitárselo a PUBLIC no le cuesta nada a la app: de las 204 funciones
-- de `public`, 178 tienen `grant execute ... to authenticated` explícito
-- y NINGUNA depende de PUBLIC para que la app la alcance. Comprobado
-- antes de escribir esto, y el arnés lo vuelve a comprobar con la lista
-- entera de RPC que el cliente llama.
--
-- `all routines` y no `all functions`: cubre también los procedimientos.
revoke execute on all routines in schema public from public, anon;

-- ── 2. Las funciones que se creen mañana ─────────────────────────
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

-- `supabase_admin` es del entorno gestionado y `postgres` no es miembro
-- suyo: esta parte no se puede aplicar, igual que en la 113. Se avisa y
-- se sigue. Lo que crean las migraciones de este repositorio corre como
-- `postgres` y sí queda cubierto.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
       || 'revoke execute on functions from public, anon';
exception when others then
  raise notice 'Privilegios por defecto de supabase_admin no tocados (%).', sqlerrm;
end $$;

-- ── 3. El cron es del cron ───────────────────────────────────────
-- Ninguna se llama desde la app. Que sólo las pueda disparar quien las
-- tiene agendadas no es una restricción: es lo que significan.
do $$
declare
  v_f text;
  v_firma text;
begin
  foreach v_f in array array[
    'send_match_reminders', 'send_rating_reminders', 'reactivate_suspended',
    'check_push_receipts', 'procesar_vencimientos_desafios',
    'vencer_reservas_pasadas', 'barrer_lista_de_espera'
  ] loop
    for v_firma in
      select format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_f
    loop
      execute format('revoke execute on function %s from public, anon, authenticated', v_firma);
    end loop;
  end loop;
end $$;
