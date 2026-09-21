-- =============================================================
-- FutFinder — pruebas de la migración 130 (C04, C05 y C06).
--
-- QUÉ PRUEBA ESTE ARCHIVO Y QUÉ NO. Con UNA conexión no se puede montar una
-- carrera: lo que se comprueba acá es el MECANISMO y la no regresión.
--
--   M1  Toda escritura de la nómina toma los DOS bloqueos (club y jugador),
--       que es de lo que dependen los tres casos.
--   M2  El último administrador sigue sin poder salir (la regla de la 111 no
--       se rompió al meterle el bloqueo por delante).
--   M3  El tope de integrantes del plan sigue vigente.
--   M4  El máximo de tres clubes por jugador, también.
--
-- LAS TRES CARRERAS —dos administradores saliendo a la vez, dos invitados
-- aceptando la última plaza, un jugador aceptando dos clubes a la vez— están
-- en supabase/tests/clubes_membresia_concurrente_test.cjs, que necesita dos
-- conexiones reales. Repetir llamadas una después de otra NO las reproduce.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r130 (caso text, ok boolean, detalle text);

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_admin2 uuid := gen_random_uuid();
  v_jug uuid := gen_random_uuid();
  v_club uuid; v_otro uuid;
  v_ok boolean; v_locks int;
  v_users uuid[];
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r130-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_admin, v_admin2, v_jug]) u;

  insert into public.clubs (nombre, slug, created_by, plan)
  values ('r130 club', 'r130-' || substr(v_admin::text,1,8), v_admin, 'premium')
  returning id into v_club;

  insert into public.club_members (club_id, user_id, rol) values (v_club, v_admin, 'admin');

  -- M1. Los bloqueos son de esta transacción y de los dos espacios: el 130 es
  -- el del club y el 131 el del jugador.
  select count(*) into v_locks from pg_locks
   where locktype = 'advisory' and classid in (130, 131) and pid = pg_backend_pid();
  insert into r130 values ('M1 la escritura de la nomina toma los dos bloqueos',
    v_locks = 2, v_locks::text);

  insert into public.club_members (club_id, user_id, rol) values (v_club, v_admin2, 'admin');
  insert into public.club_members (club_id, user_id, rol) values (v_club, v_jug, 'jugador');

  -- M2. Se van los dos administradores, uno después del otro: el segundo no
  -- puede, porque quedaría un jugador sin nadie que administre.
  v_ok := true;
  begin
    delete from public.club_members where club_id = v_club and user_id = v_admin2;
    delete from public.club_members where club_id = v_club and user_id = v_admin;
  exception when others then
    v_ok := false;
    insert into r130 values ('M2 el ultimo administrador no puede salir',
      sqlerrm like '%sin administrador%', sqlerrm);
  end;
  if v_ok then
    insert into r130 values ('M2 el ultimo administrador no puede salir',
      false, 'las dos bajas pasaron');
  end if;

  -- M3. El integrante 16 de un club estándar.
  insert into public.clubs (nombre, slug, created_by)
  values ('r130 estandar', 'r130-e-' || substr(v_admin::text,1,8), v_admin)
  returning id into v_otro;
  select array_agg(gen_random_uuid()) into v_users from generate_series(1,16);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r130b-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(v_users) u;
  insert into public.club_members (club_id, user_id, rol)
  select v_otro, u, 'jugador' from unnest(v_users[1:15]) u;
  v_ok := true;
  begin
    insert into public.club_members (club_id, user_id, rol) values (v_otro, v_users[16], 'jugador');
  exception when others then
    v_ok := false;
    insert into r130 values ('M3 el integrante 16 se rechaza',
      sqlerrm like '%limite%' or sqlerrm like '%límite%', sqlerrm);
  end;
  if v_ok then
    insert into r130 values ('M3 el integrante 16 se rechaza', false, 'entró igual');
  end if;

  -- M4. El cuarto club del mismo jugador.
  v_ok := true;
  begin
    insert into public.clubs (nombre, slug, created_by)
    values ('r130 c2', 'r130-c2-' || substr(v_jug::text,1,8), v_jug);
    insert into public.club_members (club_id, user_id, rol)
    select id, v_jug, 'jugador' from public.clubs where slug = 'r130-c2-' || substr(v_jug::text,1,8);
    insert into public.clubs (nombre, slug, created_by)
    values ('r130 c3', 'r130-c3-' || substr(v_jug::text,1,8), v_jug);
    insert into public.club_members (club_id, user_id, rol)
    select id, v_jug, 'jugador' from public.clubs where slug = 'r130-c3-' || substr(v_jug::text,1,8);
    insert into public.clubs (nombre, slug, created_by)
    values ('r130 c4', 'r130-c4-' || substr(v_jug::text,1,8), v_jug);
    insert into public.club_members (club_id, user_id, rol)
    select id, v_jug, 'jugador' from public.clubs where slug = 'r130-c4-' || substr(v_jug::text,1,8);
  exception when others then
    v_ok := false;
    insert into r130 values ('M4 el cuarto club se rechaza', sqlerrm like '%3 clubes%', sqlerrm);
  end;
  if v_ok then
    insert into r130 values ('M4 el cuarto club se rechaza', false, 'entró igual');
  end if;
end $$;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r130 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r130 where not ok;
    raise exception 'FALLARON % casos de la 130: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r130 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r130;

rollback;
