-- =============================================================
-- FutFinder — pruebas de la migración 184.
--
-- La 166 le puso a `buscar_jugadores` un contador que escribe, pero la
-- función siguió declarada `stable`. PostgREST corre las `stable` en una
-- transacción de sólo lectura, así que por la API cada búsqueda daba 405.
-- Por SQL directo funcionaba: por eso este arnés mira también la
-- VOLATILIDAD, que es lo que PostgREST usa para elegir la transacción.
--
--   A1  `buscar_jugadores` es `volatile` (PostgREST la corre en una
--       transacción que puede escribir).
--   A2  Ninguna función que llame a `_exigir_limite` es `stable` ni
--       `immutable` (la regla general, para la próxima).
--   A3  En una transacción de sólo lectura —lo que PostgREST hace con una
--       `stable`— la búsqueda revienta con 25006. Es la prueba de que la
--       volatilidad no es un detalle: con `stable` esto le pasa a cada uno.
--   B1  Con sesión, buscar por nombre de usuario encuentra un perfil
--       visible…
--   B2  …no encuentra uno oculto en búsquedas…
--   B3  …ni a quien busca…
--   B4  …y la búsqueda sigue contando en `rate_limit_hits` (el límite de la
--       166 no se perdió).
--   C1  Sin cuenta (`anon`) no se ejecuta: 42501.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r184 (caso text, ok boolean, detalle text);
grant all on r184 to authenticated, anon;

-- Corre una consulta que devuelve UN entero como ese rol. Devuelve el
-- número, o -1 con el sqlstate en `err` si revienta. El rol se repone.
create or replace function pg_temp.cuenta_como(p_rol text, p_uid uuid, p_sql text, out n int, out err text)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null
         then json_build_object('role', p_rol)::text
         else json_build_object('sub', p_uid, 'role', p_rol)::text end, true);
  execute format('set local role %I', p_rol);
  begin
    execute p_sql into n;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    n := -1; err := sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  u1 uuid := gen_random_uuid();   -- quien busca
  u2 uuid := gen_random_uuid();   -- visible en búsquedas
  u3 uuid := gen_random_uuid();   -- oculto en búsquedas
  v_tag text := 'r184x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_vol "char";
  v_mal text;
  v_hits_antes int; v_hits_despues int;
  r record;
begin
  -- ── A. La volatilidad ─────────────────────────────────────────
  select p.provolatile into v_vol
    from pg_proc p
   where p.oid = 'public.buscar_jugadores(text,text,text,text,text,integer,integer,integer)'::regprocedure;
  insert into r184 values ('A1 buscar_jugadores es volatile', v_vol = 'v', 'provolatile=' || v_vol::text);

  select string_agg(p.oid::regprocedure::text || '=' || p.provolatile::text, ', ')
    into v_mal
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname <> '_exigir_limite'
     and p.prosrc ilike '%_exigir_limite%'
     and p.provolatile <> 'v';
  insert into r184 values ('A2 ninguna funcion con _exigir_limite es stable', v_mal is null,
                           coalesce(v_mal, 'ninguna'));

  -- ── Siembra ───────────────────────────────────────────────────
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r184-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u2, u3]) u;

  update public.profiles set username = v_tag || 'yo',      privacy_visible_in_search = true  where id = u1;
  update public.profiles set username = v_tag || 'visible', privacy_visible_in_search = true  where id = u2;
  update public.profiles set username = v_tag || 'oculto',  privacy_visible_in_search = false where id = u3;

  -- ── B. Con sesión ─────────────────────────────────────────────
  select coalesce(sum(n), 0) into v_hits_antes from public.rate_limit_hits where clave = u1::text and cubo = 'buscar_jugadores';

  select * into r from pg_temp.cuenta_como('authenticated', u1, format(
    $q$select count(*)::int from public.buscar_jugadores(%L, null, null, null, null, null, null, 50) b
        where b.username = %L$q$, v_tag, v_tag || 'visible'));
  insert into r184 values ('B1 encuentra al visible', r.n = 1, 'n=' || r.n || ' err=' || coalesce(r.err, '-'));

  select * into r from pg_temp.cuenta_como('authenticated', u1, format(
    $q$select count(*)::int from public.buscar_jugadores(%L, null, null, null, null, null, null, 50) b
        where b.username = %L$q$, v_tag, v_tag || 'oculto'));
  insert into r184 values ('B2 no encuentra al oculto', r.n = 0, 'n=' || r.n || ' err=' || coalesce(r.err, '-'));

  select * into r from pg_temp.cuenta_como('authenticated', u1, format(
    $q$select count(*)::int from public.buscar_jugadores(%L, null, null, null, null, null, null, 50) b
        where b.username = %L$q$, v_tag, v_tag || 'yo'));
  insert into r184 values ('B3 no se encuentra a si mismo', r.n = 0, 'n=' || r.n || ' err=' || coalesce(r.err, '-'));

  select coalesce(sum(n), 0) into v_hits_despues from public.rate_limit_hits where clave = u1::text and cubo = 'buscar_jugadores';
  insert into r184 values ('B4 la busqueda sigue contando para el limite',
                           v_hits_despues > v_hits_antes,
                           'conteo antes=' || v_hits_antes || ' despues=' || v_hits_despues);

  -- ── C. Sin cuenta ─────────────────────────────────────────────
  select * into r from pg_temp.cuenta_como('anon', null,
    $q$select count(*)::int from public.buscar_jugadores('a', null, null, null, null, null, null, 5)$q$);
  insert into r184 values ('C1 anon no ejecuta', r.err = '42501', 'n=' || r.n || ' err=' || coalesce(r.err, '-'));

  -- ── A3. Lo que hace PostgREST con una `stable` ───────────────
  -- Al final, porque deja la transacción en sólo lectura hasta el rollback
  -- del bloque interno.
  begin
    perform set_config('transaction_read_only', 'on', true);
    select * into r from pg_temp.cuenta_como('authenticated', u1, format(
      $q$select count(*)::int from public.buscar_jugadores(%L, null, null, null, null, null, null, 50)$q$, v_tag));
    -- Se sale revirtiendo el bloque, que devuelve la transacción a
    -- escritura; el sqlstate viaja en el mensaje.
    raise exception using errcode = 'P0001', message = coalesce(r.err, 'sin error');
  exception when sqlstate 'P0001' then
    insert into r184 values ('A3 en solo lectura la busqueda revienta con 25006',
                             sqlerrm = '25006', 'sqlstate=' || sqlerrm);
  end;
end $$;

select caso, ok, detalle from r184 order by caso;
do $$
declare v_mal int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_mal, v_total from r184;
  if v_total < 8 then
    raise exception 'el arnes de la 184 no llego al final: % casos de 8', v_total;
  end if;
  if v_mal > 0 then
    raise exception '% caso(s) de la 184 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
