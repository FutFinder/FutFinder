-- =============================================================
-- FutFinder — pruebas de la migración 186 (antes numerada 179, que ya era otra).
--
--   A  reportar_contenido: un club, una foto y un partido llegan a la cola
--      con su responsable y su elemento; no se reporta lo propio; un tipo
--      inventado o un id que no existe no rompen; sin cuenta no se puede.
--   B  edad: desde 14 al registrarla; 13 se rechaza; una cuenta que ya tenía
--      12 no se toca.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r179 (caso text, ok boolean, detalle text);
grant all on r179 to authenticated, anon;

create or replace function pg_temp.como(p_rol text, p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_uid, 'role', p_rol, 'aal', 'aal1'))::text, true);
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
  u_admin uuid := gen_random_uuid(); u_sube uuid := gen_random_uuid();
  u_rep uuid := gen_random_uuid(); u_nuevo uuid := gen_random_uuid(); u_viejo uuid := gen_random_uuid();
  v_club uuid; v_foto uuid; v_partido uuid; r text;
begin
  update public.feature_flags set activo = false where nombre = 'telefono_obligatorio';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r179-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u_admin, u_sube, u_rep, u_nuevo, u_viejo]) u;
  insert into public.profiles (id, username) select u, 'r179' || substr(replace(u::text, '-', ''), 1, 10)
    from unnest(array[u_admin, u_sube, u_rep, u_nuevo, u_viejo]) u on conflict (id) do nothing;

  insert into public.clubs (nombre, slug, created_by) values ('Club r179', 'r179-' || substr(u_admin::text, 1, 8), u_admin) returning id into v_club;
  insert into public.club_members (club_id, user_id, rol) values (v_club, u_admin, 'admin'), (v_club, u_sube, 'jugador');
  insert into public.club_photos (club_id, photo_url, uploaded_by) values (v_club, 'https://x/r179.jpg', u_sube) returning id into v_foto;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (u_sube, 'Partido r179', 'Ñuñoa', 'Cancha', -33.45, -70.6, now() + interval '3 days', 10, 9) returning id into v_partido;

  -- ── A ──
  r := pg_temp.como('authenticated', u_rep, format($q$select public.reportar_contenido('club', %L, 'contenido_ofensivo', 'nombre ofensivo')::text$q$, v_club));
  insert into r179 select 'A1 reportar un club lo pone en la cola, contra su admin',
    r like '%"ok" : true%' and exists (select 1 from public.user_reports where reporter_id = u_rep and reported_id = u_admin and elemento = 'club:' || v_club), r;

  r := pg_temp.como('authenticated', u_rep, format($q$select public.reportar_contenido('foto_club', %L, 'foto_inapropiada')::text$q$, v_foto));
  insert into r179 select 'A2 reportar una foto va contra quien la subió',
    r like '%"ok" : true%' and exists (select 1 from public.user_reports where reported_id = u_sube and elemento = 'foto_club:' || v_foto), r;

  delete from public.user_reports where reporter_id = u_rep and reported_id = u_sube;
  r := pg_temp.como('authenticated', u_rep, format($q$select public.reportar_contenido('partido', %L, 'informacion_falsa')::text$q$, v_partido));
  insert into r179 select 'A3 reportar un partido va contra su organizador',
    r like '%"ok" : true%' and exists (select 1 from public.user_reports where reported_id = u_sube and elemento = 'partido:' || v_partido), r;

  r := pg_temp.como('authenticated', u_admin, format($q$select public.reportar_contenido('club', %L, 'spam')::text$q$, v_club));
  insert into r179 values ('A4 no se reporta lo propio', r like '%propio%', r);

  r := pg_temp.como('authenticated', u_rep, format($q$select public.reportar_contenido('perfil', %L, 'spam')::text$q$, v_club));
  insert into r179 values ('A5 un tipo inventado no rompe', r like '%"ok" : false%', r);
  r := pg_temp.como('authenticated', u_rep, format($q$select public.reportar_contenido('club', %L, 'spam')::text$q$, gen_random_uuid()));
  insert into r179 values ('A6 un id que no existe no rompe', r like '%No encontramos%', r);
  r := pg_temp.como('authenticated', u_rep, format($q$select public.reportar_contenido('partido', %L, 'otro')::text$q$, v_partido));
  insert into r179 values ('A7 el reporte repetido se dice', r like '%sigue en revisión%', r);
  r := pg_temp.como('anon', null, format($q$select public.reportar_contenido('club', %L, 'spam')::text$q$, v_club));
  insert into r179 values ('A8 sin cuenta no se puede', r like 'err:42501%', r);

  -- ── B ──
  r := pg_temp.como('authenticated', u_nuevo, format($q$with x as (update public.profiles set edad = 13 where id = %L returning 1) select count(*)::text from x$q$, u_nuevo));
  insert into r179 values ('B1 con 13 años no se registra la edad', r like 'err:23514%desde los 14%', r);
  r := pg_temp.como('authenticated', u_nuevo, format($q$with x as (update public.profiles set edad = 14 where id = %L returning privacy_visible_in_search) select bool_and(not privacy_visible_in_search)::text from x$q$, u_nuevo));
  insert into r179 values ('B2 con 14 sí, y queda fuera de las búsquedas', r = 'ok:true', r);
  update public.profiles set edad = 12 where id = u_viejo;   -- como quedó antes de la 186
  r := pg_temp.como('authenticated', u_viejo, format($q$with x as (update public.profiles set bio = 'r179' where id = %L returning 1) select count(*)::text from x$q$, u_viejo));
  insert into r179 values ('B3 una cuenta que ya tenía 12 sigue funcionando', r = 'ok:1', r);
end $$;

select caso, ok, detalle from r179 order by caso;

rollback;
