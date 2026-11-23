-- =============================================================
-- FutFinder — pruebas de la migración 181 (qué versión de los términos
-- aceptó cada persona, y cuándo).
--
--   A  Aceptar guarda versión y hora del servidor; repetir no pisa la fecha.
--   B  Versiones mal formadas, futuras o imposibles se rechazan.
--   C  Cada uno lee las suyas; nadie escribe a mano (42501); anon no entra.
--   D  Se borra con el perfil.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK. Si un caso
-- falla, el arnés falla.
-- =============================================================

begin;

create temp table r181 (caso text, ok boolean, detalle text);
grant all on r181 to authenticated, anon;

create or replace function pg_temp.como(p_uid uuid, p_sql text, p_rol text default 'authenticated')
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_rol, 'aal', 'aal1')::text, true);
  execute format('set local role %I', p_rol);
  begin
    execute p_sql into v; execute 'reset role'; v := 'ok:' || coalesce(v, '');
  exception when others then execute 'reset role'; v := 'err:' || sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  r text; v_n int; v_at timestamptz; mala text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r181-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}'
    from unnest(array[u1, u2]) u;
  insert into public.profiles (id, username) select u, 'r181' || substr(replace(u::text, '-', ''), 1, 10) from unnest(array[u1, u2]) u on conflict (id) do nothing;

  -- ── A ──
  r := pg_temp.como(u1, $q$select public.aceptar_terminos('2026-11-14')::text$q$);
  select count(*), min(aceptado_at) into v_n, v_at from public.aceptaciones_legales where user_id = u1 and version = '2026-11-14';
  insert into r181 values ('A1 aceptar guarda la versión con la hora del servidor',
    r like 'ok:%"ok" : true%' and v_n = 1 and v_at = now(), r || ' n=' || v_n);
  update public.aceptaciones_legales set aceptado_at = now() - interval '3 days' where user_id = u1;
  r := pg_temp.como(u1, $q$select public.aceptar_terminos('2026-11-14')::text$q$);
  select count(*), min(aceptado_at) into v_n, v_at from public.aceptaciones_legales where user_id = u1;
  insert into r181 values ('A2 repetir no duplica ni pisa la primera fecha',
    r like 'ok:%"ok" : true%' and v_n = 1 and v_at = now() - interval '3 days', r || ' n=' || v_n);
  -- Fechas fijas y pasadas: el arnés no depende del día en que corra.
  r := pg_temp.como(u1, $q$select public.aceptar_terminos('2026-06-01')::text$q$);
  select count(*) into v_n from public.aceptaciones_legales where user_id = u1;
  insert into r181 values ('A3 una versión nueva es otra fila', r like 'ok:%"ok" : true%' and v_n = 2, r || ' n=' || v_n);

  -- ── B ──
  foreach mala in array array['', 'v1', '2026-13-40', '2025-12-31', '2999-01-01', '2026-11-14; drop table x', '14-11-2026'] loop
    r := pg_temp.como(u2, format($q$select public.aceptar_terminos(%L)::text$q$, mala));
    insert into r181 values ('B1 versión rechazada: «' || mala || '»', r like 'ok:%"ok" : false%', r);
  end loop;
  r := pg_temp.como(u2, $q$select public.aceptar_terminos(null)::text$q$);
  insert into r181 values ('B2 versión nula rechazada', r like 'ok:%"ok" : false%', r);
  select count(*) into v_n from public.aceptaciones_legales where user_id = u2;
  insert into r181 values ('B3 y nada de eso dejó filas', v_n = 0, 'n=' || v_n);

  -- ── C ──
  r := pg_temp.como(u1, $q$select string_agg(version, ',' order by version) from public.aceptaciones_legales$q$);
  insert into r181 values ('C1 cada uno lee las suyas', r = 'ok:2026-06-01,2026-11-14', r);
  r := pg_temp.como(u2, $q$select count(*)::text from public.aceptaciones_legales$q$);
  insert into r181 values ('C2 y no las de otro', r = 'ok:0', r);
  r := pg_temp.como(u2, format($q$insert into public.aceptaciones_legales (user_id, version) values (%L, '2026-11-14') returning 'creada'$q$, u2));
  insert into r181 values ('C3 nadie inserta a mano (42501)', r like 'err:42501%', r);
  r := pg_temp.como(u1, $q$update public.aceptaciones_legales set aceptado_at = now() - interval '5 years' returning 'cambiada'$q$);
  insert into r181 values ('C4 ni cambia su fecha (42501)', r like 'err:42501%', r);
  r := pg_temp.como(u1, $q$delete from public.aceptaciones_legales returning 'borrada'$q$);
  insert into r181 values ('C5 ni las borra (42501)', r like 'err:42501%', r);
  r := pg_temp.como(null, $q$select public.aceptar_terminos('2026-11-14')::text$q$, 'anon');
  insert into r181 values ('C6 anon no ejecuta aceptar_terminos (42501)', r like 'err:42501%', r);
  r := pg_temp.como(null, $q$select count(*)::text from public.aceptaciones_legales$q$, 'anon');
  insert into r181 values ('C7 anon no lee la tabla (42501)', r like 'err:42501%', r);

  -- ── D ──
  delete from auth.users where id = u1;
  delete from public.profiles where id = u1;
  select count(*) into v_n from public.aceptaciones_legales where user_id = u1;
  insert into r181 values ('D1 se borra con el perfil', v_n = 0, 'n=' || v_n);
end $$;

select caso, ok, detalle from r181 order by caso;

do $$
declare v text;
begin
  select string_agg(caso || ' → ' || detalle, E'\n') into v from r181 where ok is not true;
  if v is not null then raise exception E'181: casos fallidos:\n%', v; end if;
end $$;

rollback;
