-- =============================================================
-- FutFinder migration 116: las extensiones no viven en `public`
-- =============================================================
-- Cierra la limitación que la 115 dejó anotada en su L1: una extensión
-- instalada en `public` nace con sus funciones ejecutables por anon, y el
-- disparador de eventos de la 115 no se enteraba.
--
-- POR QUÉ NO SE ENTERABA, y esto ya no es una suposición: **supautils se
-- salta los disparadores de eventos a propósito**. Es una extensión de la
-- propia plataforma, cargada en `session_preload_libraries` para todas las
-- sesiones, y tiene una opción que lo dice con nombre y apellido:
--
--     supautils.log_skipped_evtrigs — «Log skipped event triggers»
--
-- Medido con un espía sobre LOS DOS eventos, en una transacción:
--
--     create extension unaccent with schema public;  → ni un disparo
--     create table public.testigo (id int);          → start y end
--
-- Ni `ddl_command_start` ni `ddl_command_end`. O sea que no existe ninguna
-- vía de disparador para rechazar ni para corregir el `create extension`:
-- no es que se nos escape, es que la plataforma lo aparta.
--
-- Y HAY UN SEGUNDO MOTIVO POR EL QUE NO SE PODÍA ARREGLAR REVOCANDO.
-- supautils instala las extensiones de su lista —78 hoy, entre ellas todas
-- las que alguien querría— COMO `supabase_admin`, aunque el `create
-- extension` lo lance `postgres`. Medido: tras instalar `unaccent` como
-- postgres, sus funciones quedan
--
--     {=X/supabase_admin, ..., anon=X/supabase_admin, ...}
--          ↑ el otorgante es supabase_admin, no postgres
--
-- y por lo tanto `postgres` NO puede revocarlas: el revoke corre sin error
-- y sin efecto, como ya enseñó la 115. Comprobado también aquí.
--
-- LA PALANCA QUE SÍ FUNCIONA: MOVERLA DE ESQUEMA
--
-- `alter extension ... set schema extensions` SÍ funciona como `postgres`,
-- porque supautils también intercepta ese comando y lo ejecuta como
-- superusuario. Comprobado moviendo `unaccent` de `public` a `extensions`
-- en una transacción revertida.
--
-- Y mover no es un apaño: es DEVOLVER LA EXTENSIÓN A DONDE YA VIVEN LAS
-- OTRAS. Las cuatro que este proyecto tiene instaladas —`pgcrypto`,
-- `uuid-ossp`, `pg_stat_statements`, `pg_net`— están en `extensions`, no en
-- `public`. El `search_path` de `postgres` es `"$user", public, extensions`,
-- así que las referencias sin cualificar siguen resolviendo. Lo que se
-- mueve queda exactamente donde lo que ya funciona.
--
-- Fuera de `public`, PostgREST no las expone: la clave anónima ya no llega
-- a ellas por `/rest/v1/rpc/...`, que era el camino que importaba.
--
-- LO QUE ESTO NO ARREGLA, DICHO CON NÚMEROS: de las 78 extensiones
-- disponibles, **56 son reubicables y 22 no**. Entre las 22 está `postgis`,
-- que es justo la que alguien instalaría en una app con canchas y mapas, y
-- también `http`, `pg_net`, `pg_cron` y `pgsodium`. A ésas
-- `alter extension ... set schema` les responde
--
--     0A000: extension "pg_net" does not support SET SCHEMA
--
-- y no hay forma automática de sacarlas: la única salida sería
-- `drop extension` y volver a crearla en `extensions`, que puede arrastrar
-- en cascada columnas e índices que dependan de ella. Eso NO se automatiza.
-- El barrido las deja donde están y AVISA; cerrarlas es una decisión con
-- consecuencias y la toma una persona. La forma correcta de no llegar ahí
-- es instalar siempre con `with schema extensions`.
--
-- Idempotente: seguro de re-ejecutar. Si no hay nada en `public` —que es el
-- estado de hoy— no hace nada.
-- =============================================================

-- ── 1. El barrido ────────────────────────────────────────────────
create or replace function public.barrer_extensiones_de_public()
returns text
language plpgsql
set search_path = ''
as $$
declare
  e record;
  v_movidas text[] := '{}';
  v_atascadas text[] := '{}';
begin
  for e in
    select x.extname, x.extrelocatable
      from pg_catalog.pg_extension x
      join pg_catalog.pg_namespace n on n.oid = x.extnamespace
     where n.nspname = 'public'
     order by x.extname
  loop
    -- Las 22 que no se pueden mover: se avisa y se dejan. Ver el
    -- encabezado — sacarlas exige `drop extension`, y eso arrastra.
    if not e.extrelocatable then
      v_atascadas := v_atascadas || (e.extname || ' (no es reubicable)');
      continue;
    end if;

    begin
      execute pg_catalog.format('alter extension %I set schema extensions', e.extname);
      v_movidas := v_movidas || e.extname;
    exception when others then
      v_atascadas := v_atascadas || (e.extname || ' (' || sqlerrm || ')');
    end;
  end loop;

  -- Los avisos van al registro de Postgres, no a una excepción. Si esta
  -- función fallara, `pg_cron` revertiría la transacción entera y CON ELLA
  -- las mudanzas que sí salieron bien: una extensión atascada dejaría
  -- atascadas también a las movibles, para siempre. Quien vigila el
  -- resultado es el arnés, que audita el esquema completo.
  if array_length(v_atascadas, 1) > 0 then
    raise warning 'Extensiones en `public` que NO se pudieron mover: %. Sus funciones las ejecuta anon por REST. Hay que decidir a mano.',
      array_to_string(v_atascadas, ', ');
  end if;
  if array_length(v_movidas, 1) > 0 then
    raise warning 'Extensiones movidas de `public` a `extensions`: %.',
      array_to_string(v_movidas, ', ');
  end if;

  return 'movidas: ' || coalesce(array_to_string(v_movidas, ', '), '') ||
         ' | atascadas: ' || coalesce(array_to_string(v_atascadas, ', '), '');
end $$;

comment on function public.barrer_extensiones_de_public() is
  'Devuelve a `extensions` cualquier extensión que aparezca en `public`, que '
  'es donde nacen ejecutables por anon. Sólo la dispara cron.job. Las 22 '
  'extensiones no reubicables (postgis, http, pg_net…) no se pueden mover: '
  'las avisa y las deja.';

-- Sólo la dispara el cron, que corre como `postgres`. Mismo criterio que la
-- 114 con las otras siete: ni anon ni `authenticated` la necesitan.
revoke execute on function public.barrer_extensiones_de_public()
  from public, anon, authenticated;

-- ── 2. El trabajo del cron ───────────────────────────────────────
-- No hay disparador posible, así que la vigilancia es periódica. Cinco
-- minutos es la misma cadencia que el resto de los trabajos del proyecto.
select cron.unschedule('futfinder-extensiones-fuera-de-public')
 where exists (select 1 from cron.job where jobname = 'futfinder-extensiones-fuera-de-public');

select cron.schedule('futfinder-extensiones-fuera-de-public', '*/5 * * * *',
                     'select public.barrer_extensiones_de_public();');

-- ── 3. Y por si ya hubiera algo hoy ──────────────────────────────
select public.barrer_extensiones_de_public();
