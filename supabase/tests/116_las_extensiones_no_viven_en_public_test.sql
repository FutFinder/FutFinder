-- =============================================================
-- FutFinder — pruebas de la migración 116.
--
-- La prueba central es C3 y hace el daño de verdad antes de arreglarlo:
-- instala `unaccent` en `public`, comprueba que anon puede ejecutar sus
-- funciones —o sea que el agujero es real y no teórico— y sólo entonces
-- corre el barrido y verifica que se cerró. Sin el paso del medio, C3
-- pasaría igual con un barrido que no hiciera nada.
--
--   Lo que ya no se puede
--   C1. El trabajo del cron existe, activo, cada 5 minutos, como postgres.
--   C2. La función del barrido no la ejecuta anon, ni PUBLIC, ni
--       `authenticated`: sólo la dispara el cron.
--   C3. Una extensión instalada en `public` acaba en `extensions`, y no
--       queda ni una de sus funciones en `public`.
--   C4. Tras el barrido, la auditoría del esquema vuelve a cero: a anon no
--       le queda nada que escribir ni ejecutar en `public`.
--
--   Lo que sigue igual
--   R1. Las cuatro extensiones que ya viven en `extensions` no se mueven
--       ni se rompen.
--   R2. El barrido con nada que barrer no falla ni inventa trabajo. Es el
--       estado de todos los días.
--   R3. Los ocho trabajos del cron quedan activos.
--
--   La limitación, fijada por escrito
--   L1. Hay extensiones NO REUBICABLES —22 de 78, entre ellas `postgis`—
--       que `alter extension ... set schema` rechaza con 0A000. El barrido
--       las avisa y las deja: sacarlas exige `drop extension`, que arrastra
--       en cascada. L1 no es una garantía: es el tamaño exacto de lo que
--       esta migración NO cubre, clavado para que se vea.
--
-- Se ejecuta entero dentro de begin/rollback: no deja nada.
-- =============================================================

begin;
create temp table r116 (caso text, ok boolean, detalle text);

do $$
declare
  v_n int;
  v_esquema text;
  v_antes boolean;
  v_resultado text;
begin
  -- ── C1 ───────────────────────────────────────────────────────
  select count(*) into v_n from cron.job
   where jobname = 'futfinder-extensiones-fuera-de-public'
     and active and schedule = '*/5 * * * *' and username = 'postgres';
  insert into r116 values ('C1 el trabajo del cron esta puesto y activo', v_n = 1, v_n || ' trabajo(s)');

  -- ── C2 ───────────────────────────────────────────────────────
  insert into r116 values ('C2 el barrido solo lo dispara el cron',
    not has_function_privilege('anon','public.barrer_extensiones_de_public()','EXECUTE')
      and not has_function_privilege('authenticated','public.barrer_extensiones_de_public()','EXECUTE')
      and (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='barrer_extensiones_de_public'
              and (p.proacl::text like '{=X%' or p.proacl::text like '%,=X%')),
    'anon=' || has_function_privilege('anon','public.barrer_extensiones_de_public()','EXECUTE')::text ||
    ' authenticated=' || has_function_privilege('authenticated','public.barrer_extensiones_de_public()','EXECUTE')::text);

  -- ── C3: el agujero real, y su cierre ─────────────────────────
  create extension unaccent with schema public;

  -- Primero: que el agujero exista de verdad. Si esto sale falso, la
  -- prueba no vale nada porque no habría nada que cerrar.
  select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) into v_antes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    join pg_extension e on e.oid = d.refobjid and e.extname = 'unaccent'
   where n.nspname = 'public';
  insert into r116 values ('C3a el agujero es real: recien instalada, anon la ejecuta',
    coalesce(v_antes, false), 'anon ejecutaba sus funciones en public');

  select public.barrer_extensiones_de_public() into v_resultado;

  select n.nspname into v_esquema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'unaccent';
  insert into r116 values ('C3b tras el barrido la extension vive en extensions',
    v_esquema = 'extensions', 'esta en ' || coalesce(v_esquema, '(no existe)'));

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    join pg_extension e on e.oid = d.refobjid and e.extname = 'unaccent'
   where n.nspname = 'public';
  insert into r116 values ('C3c no queda ni una de sus funciones en public',
    v_n = 0, v_n || ' funcion(es) en public');

  -- ── C4: la auditoría del esquema completo ────────────────────
  declare
    v_t int; v_f int; v_s int;
  begin
    select count(*) into v_t from information_schema.role_table_grants
     where grantee='anon' and table_schema='public'
       and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
    select count(*) into v_f
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and has_function_privilege('anon', p.oid, 'EXECUTE');
    -- `materialized` a propósito: sin eso el planificador evalúa
    -- `has_sequence_privilege` antes del filtro y revienta con el primer índice.
    with s as materialized (
      select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='S')
    select count(*) into v_s from s where has_sequence_privilege('anon', s.oid, 'USAGE');
    insert into r116 values ('C4 auditoria: a anon no le queda nada abierto en public',
      v_t = 0 and v_f = 0 and v_s = 0,
      v_t || ' escritura(s), ' || v_f || ' funcion(es), ' || v_s || ' secuencia(s)');
  end;

  -- ── R1: las que ya estaban bien, intactas ────────────────────
  select count(*) into v_n
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where n.nspname = 'extensions'
     and e.extname in ('pgcrypto','uuid-ossp','pg_stat_statements','pg_net');
  insert into r116 values ('R1 las cuatro extensiones de siempre siguen en extensions',
    v_n = 4, v_n || ' de 4');

  -- ── R2: barrer sin nada que barrer ───────────────────────────
  begin
    select public.barrer_extensiones_de_public() into v_resultado;
    select count(*) into v_n from pg_extension e join pg_namespace n on n.oid=e.extnamespace
     where n.nspname = 'public';
    insert into r116 values ('R2 barrer sin nada que barrer no falla ni inventa trabajo',
      v_n = 0, 'quedan ' || v_n || ' extension(es) en public');
  exception when others then
    insert into r116 values ('R2 barrer sin nada que barrer no falla ni inventa trabajo',
      false, sqlerrm);
  end;

  -- ── R3 ───────────────────────────────────────────────────────
  select count(*) into v_n from cron.job where active;
  insert into r116 values ('R3 los ocho trabajos del cron siguen activos', v_n = 8, v_n || ' de 8');
end $$;

-- ── L1: el tamaño de lo que no se cubre ────────────────────────
do $$
declare v_no_reubicables int; v_postgis boolean; v_mensaje text;
begin
  with v as (
    select av.name, av.relocatable
      from pg_available_extension_versions av
      join pg_available_extensions ae on ae.name = av.name and ae.default_version = av.version)
  select count(*) filter (where not relocatable),
         bool_or(name = 'postgis' and not relocatable)
    into v_no_reubicables, v_postgis
    from v;

  -- Y que el rechazo es el que decimos: se prueba contra `pg_net`, que ya
  -- vive en `extensions`, pidiendo lo contrario de lo que el barrido haría.
  begin
    execute 'alter extension pg_net set schema public';
    v_mensaje := 'la movio, o sea que ya es reubicable';
  exception when others then
    v_mensaje := sqlstate || ': ' || sqlerrm;
  end;

  insert into r116 values ('L1 limitacion: hay extensiones que no se pueden mover',
    v_no_reubicables = 22 and v_postgis and v_mensaje like '0A000%',
    v_no_reubicables || ' no reubicables, postgis entre ellas; ' || v_mensaje);
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r116 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r116;

rollback;
