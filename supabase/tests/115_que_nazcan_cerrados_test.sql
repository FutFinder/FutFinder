-- =============================================================
-- FutFinder — pruebas de la migración 115.
--
-- La prueba está montada AL REVÉS a propósito. Antes de crear nada, el
-- arnés vuelve a poner los privilegios por defecto de `postgres` en modo
-- permisivo —`grant all on tables to anon`, etc.— para IMITAR a
-- `supabase_admin`, que es el rol que no se puede tocar.
--
-- Así, si el disparador no hiciera nada, cada objeto nuevo nacería con los
-- permisos abiertos y todas las C fallarían. Que pasen significa que fue
-- el disparador el que cerró, y no los privilegios por defecto que la 113
-- y la 114 ya habían arreglado. Sin esta inversión el arnés pasaría igual
-- sin el disparador puesto, y no probaría nada.
--
--   Lo que ya no se puede
--   C1. El disparador existe, está habilitado y NO es `security definer`.
--       Si lo fuera correría como `postgres` y no serviría para lo único
--       que viene a resolver.
--   C2. Una tabla nueva nace sin insert/update/delete/truncate para anon.
--   C3. Una función nueva nace sin execute, ni para anon ni para PUBLIC.
--   C4. Una secuencia nueva nace sin update/usage para anon.
--   C5. Una vista nueva nace sin escritura para anon.
--   C6. `push_tickets_id_seq`, la que ya existía, tampoco le sirve a anon.
--   C8. La propia función del disparador tampoco la ejecuta anon. Nace
--       antes que el disparador, así que nadie la cierra por ella.
--   C7. LA AUDITORÍA: hoy, en TODO el esquema `public`, no queda un solo
--       objeto que anon pueda escribir o ejecutar. Es la red que caza lo
--       que el disparador no vea, venga por donde venga.
--
--   Lo que sigue igual
--   R1. La tabla nueva CONSERVA el select de anon. Cerrar la escritura no
--       es cerrar la lectura pública.
--   R2. `authenticated` conserva todo sobre la tabla nueva.
--   R3. Una concesión EXPLÍCITA posterior sobrevive. El disparador filtra
--       por etiqueta de comando, así que no deshace lo que alguien quiso.
--       Es también la prueba de que no se dispara a sí mismo.
--   R4. Los seis disparadores de eventos de Supabase siguen activos.
--   R5. El DDL de otros esquemas ni se toca ni se rompe.
--
--   La limitación, fijada por escrito
--   L1. `create extension ... with schema public` NO dispara el disparador
--       —el motor no emite `ddl_command_end` para ese comando— y sus
--       funciones nacen ejecutables por anon. L1 NO es una garantía de
--       seguridad: es una limitación medida, clavada acá para que el día
--       que el motor cambie el arnés lo diga en vez de que nos enteremos
--       por casualidad. Si L1 falla, la buena noticia es que el hueco se
--       cerró solo y esta prueba sobra.
--
--       El hueco EN SÍ ya está cerrado por la migración 116, que no usa un
--       disparador —no hay ninguno posible— sino un barrido periódico. L1
--       sigue midiendo lo de siempre: que el disparador no llega ahí.
--
-- Se ejecuta entero dentro de begin/rollback: no deja nada.
-- =============================================================

begin;
create temp table r115 (caso text, ok boolean, detalle text);
grant all on r115 to anon, authenticated;

-- ── El escenario: privilegios por defecto permisivos, como supabase_admin
alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant execute on functions to anon, public;
alter default privileges for role postgres in schema public grant all on sequences to anon;

do $$
declare
  v_n int;
begin
  -- ── C1 ───────────────────────────────────────────────────────
  select count(*) into v_n
    from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid
   where e.evtname = 'anon_nace_sin_llaves' and e.evtenabled <> 'D'
     and e.evtevent = 'ddl_command_end' and p.prosecdef = false;
  insert into r115 values ('C1 el disparador existe, activo y SIN security definer',
    v_n = 1, v_n || ' coincidencia(s)');

  -- ── C2, R1, R2: una tabla nueva ──────────────────────────────
  create table public.p115_tabla (id int primary key, texto text);
  select count(*) into v_n from information_schema.role_table_grants
   where grantee='anon' and table_schema='public' and table_name='p115_tabla'
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  insert into r115 values ('C2 tabla nueva: anon sin escritura', v_n = 0, v_n || ' permiso(s)');

  insert into r115 values ('R1 tabla nueva: anon conserva el SELECT',
    has_table_privilege('anon','public.p115_tabla','SELECT'), 'lectura publica intacta');

  select count(*) into v_n from information_schema.role_table_grants
   where grantee='authenticated' and table_schema='public' and table_name='p115_tabla'
     and privilege_type in ('INSERT','UPDATE','DELETE','SELECT');
  insert into r115 values ('R2 tabla nueva: authenticated conserva lo suyo', v_n = 4, v_n || ' de 4');

  -- ── C3: una función nueva ────────────────────────────────────
  execute 'create function public.p115_fn(n int) returns int language sql immutable as $f$ select n $f$';
  insert into r115 values ('C3 funcion nueva: ni anon ni PUBLIC la ejecutan',
    not has_function_privilege('anon','public.p115_fn(int)','EXECUTE')
      and (select count(*) = 0 from pg_proc p join pg_namespace s on s.oid=p.pronamespace
            where s.nspname='public' and p.proname='p115_fn' and p.proacl::text like '{=X%'),
    'anon=' || has_function_privilege('anon','public.p115_fn(int)','EXECUTE')::text);

  -- ── C4: una secuencia nueva ──────────────────────────────────
  create sequence public.p115_seq;
  insert into r115 values ('C4 secuencia nueva: anon no la avanza',
    not has_sequence_privilege('anon','public.p115_seq','UPDATE')
      and not has_sequence_privilege('anon','public.p115_seq','USAGE'),
    'update=' || has_sequence_privilege('anon','public.p115_seq','UPDATE')::text);

  -- ── C5: una vista nueva ──────────────────────────────────────
  create view public.p115_vista as select id from public.p115_tabla;
  select count(*) into v_n from information_schema.role_table_grants
   where grantee='anon' and table_schema='public' and table_name='p115_vista'
     and privilege_type in ('INSERT','UPDATE','DELETE');
  insert into r115 values ('C5 vista nueva: anon sin escritura', v_n = 0, v_n || ' permiso(s)');

  -- ── C6: la secuencia que ya existía ──────────────────────────
  insert into r115 values ('C6 push_tickets_id_seq: anon ya no le gasta identificadores',
    not has_sequence_privilege('anon','public.push_tickets_id_seq','UPDATE'),
    'usage=' || has_sequence_privilege('anon','public.push_tickets_id_seq','USAGE')::text);

  -- ── R3: la concesión explícita gana ──────────────────────────
  -- Y de paso: si el disparador reaccionara a GRANT, esto se desharía solo
  -- y además se llamaría a sí mismo.
  grant insert on public.p115_tabla to anon;
  insert into r115 values ('R3 una concesion explicita posterior sobrevive',
    has_table_privilege('anon','public.p115_tabla','INSERT'),
    'la intencion explicita manda, y no hay recursion');
  revoke insert on public.p115_tabla from anon;

  -- ── R5: otros esquemas ni se tocan ni se rompen ──────────────
  begin
    create schema p115_otro;
    create table p115_otro.t (id int);
    insert into r115 values ('R5 el DDL de otros esquemas no se toca ni falla', true, 'sin error');
  exception when others then
    insert into r115 values ('R5 el DDL de otros esquemas no se toca ni falla', false, sqlerrm);
  end;

  -- ── R4 ───────────────────────────────────────────────────────
  select count(*) into v_n from pg_event_trigger
   where evtname in ('issue_graphql_placeholder','issue_pg_cron_access',
     'issue_pg_graphql_access','issue_pg_net_access','pgrst_ddl_watch','pgrst_drop_watch')
     and evtenabled <> 'D';
  insert into r115 values ('R4 los seis disparadores de Supabase siguen activos', v_n = 6, v_n || ' de 6');
end $$;

-- ── C7: la auditoría de todo el esquema ────────────────────────
-- No mira quién creó qué ni por qué vía llegó. Mira el resultado.
do $$
declare v_t int; v_f int; v_s int;
begin
  select count(*) into v_t from information_schema.role_table_grants
   where grantee='anon' and table_schema='public'
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');

  select count(*) into v_f
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and has_function_privilege('anon', p.oid, 'EXECUTE');

  -- `materialized` a propósito: sin eso el planificador evalúa
  -- `has_sequence_privilege` antes del filtro por relkind y revienta al
  -- toparse con el primer índice.
  with s as materialized (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='S')
  select count(*) into v_s from s where has_sequence_privilege('anon', s.oid, 'USAGE');

  insert into r115 values ('C8 la propia funcion del disparador: anon no la ejecuta',
    not has_function_privilege('anon','public.anon_nace_sin_llaves()','EXECUTE'), 'el huevo y la gallina');

  insert into r115 values ('C7 auditoria: a anon no le queda nada abierto en public',
    v_t = 0 and v_f = 0 and v_s = 0,
    v_t || ' escritura(s), ' || v_f || ' funcion(es), ' || v_s || ' secuencia(s)');
end $$;

-- ── L1: la limitación, fijada ──────────────────────────────────
do $$
declare v_abiertas int; v_total int;
begin
  create extension unaccent with schema public;
  select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')), count(*)
    into v_abiertas, v_total
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    join pg_extension e on e.oid = d.refobjid and e.extname = 'unaccent'
   where n.nspname = 'public';
  insert into r115 values (
    'L1 limitacion: una extension en public NO la cubre el disparador',
    v_total > 0 and v_abiertas = v_total,
    v_abiertas || ' de ' || v_total || ' abiertas — si esto falla, el motor cambio y L1 sobra');
exception when others then
  insert into r115 values (
    'L1 limitacion: una extension en public NO la cubre el disparador',
    false, 'no se pudo medir: ' || sqlerrm);
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r115 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r115;

rollback;
