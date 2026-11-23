-- =============================================================
-- FutFinder — pruebas de la migración 177.
--
-- Cada caso corre COMO `authenticated` (o `anon`) con el `sub` y el `aal`
-- de una persona: como `postgres` todo pasa. Los casos «control» comprueban
-- que lo legítimo SIGUE funcionando, que es la mitad de la prueba.
--
--   A  bloqueo: el bloqueado no se desbloquea; aceptar una pendiente sí.
--   B  alta de partidos: sin reserva ajena, sin estado, sin club ajeno; el
--      alta normal y el partido de un desafío propio, sí.
--   C  desafíos abiertos: la respuesta no cambia de club, la publicación no
--      se reabre; retirar y deshacer, sí.
--   D  invitación: respondida no se vuelve a responder.
--   E  buckets: sin cuenta no se lista; cada uno lista lo suyo.
--   F  dos pasos: con factor y `aal1`, la API y el tiempo real se niegan;
--      con `aal2` o sin factor, no.
--   G  menores: no descubribles; la edad no se cambia.
--   H  calificaciones de recintos: sin cuenta no se leen.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r177 (caso text, ok boolean, detalle text);
grant all on r177 to authenticated, anon;

-- Ejecuta `p_sql` como `p_rol` con `sub` y `aal`. Devuelve 'ok:<1ª columna>'
-- o 'err:<sqlstate> <mensaje>'.
create or replace function pg_temp.como(p_rol text, p_uid uuid, p_aal text, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_uid, 'role', p_rol, 'aal', p_aal))::text, true);
  execute format('set local role %I', p_rol);
  begin
    execute p_sql into v;
    execute 'reset role';
    v := 'ok:' || coalesce(v, '');
  exception when others then
    execute 'reset role';
    v := 'err:' || sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  u4 uuid := gen_random_uuid(); u5 uuid := gen_random_uuid(); u6 uuid := gen_random_uuid();
  u7 uuid := gen_random_uuid(); u8 uuid := gen_random_uuid();
  c_a uuid; c_b uuid; c_c uuid; v_reto uuid; v_pub uuid; v_resp uuid; v_inv uuid; v_reserva uuid;
  r text;
  v_partido text := $p$insert into public.matches (id_organizador, titulo, region, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles, precio_cuota, nivel, aprobacion, min_trust_score %s) values ('%s', 'r177', 'RM', 'Ñuñoa', 'Cancha', -33.45, -70.6, now() + interval '3 days', 10, 10, 0, 'recreativo', 'inmediata', 0 %s) returning id::text$p$;
begin
  update public.feature_flags set activo = false where nombre = 'telefono_obligatorio';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r177-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u2, u3, u4, u5, u6, u7, u8]) u;
  insert into public.profiles (id, username)
  select u, 'r177' || substr(replace(u::text, '-', ''), 1, 10) from unnest(array[u1, u2, u3, u4, u5, u6, u7, u8]) u
  on conflict (id) do nothing;

  -- ── A. Bloqueo ────────────────────────────────────────────────
  insert into public.friendships (requester_id, addressee_id, status) values (u1, u2, 'accepted');
  r := pg_temp.como('authenticated', u1, 'aal1', format('select public.bloquear_usuario(%L)::text', u2));
  insert into r177 values ('A0 u1 bloquea a u2', r like 'ok:%', r);
  r := pg_temp.como('authenticated', u2, 'aal1', format(
    $q$with x as (update public.friendships set status = 'accepted' where requester_id = %L and addressee_id = %L returning 1) select count(*)::text from x$q$, u1, u2));
  insert into r177 values ('A1 el bloqueado no se desbloquea', r like 'err:42501%', r);
  r := pg_temp.como('authenticated', u2, 'aal1', format(
    $q$insert into public.messages (sender_id, receiver_id, content) values (%L, %L, 'hola') returning 1$q$, u2, u1));
  insert into r177 values ('A2 el bloqueado no escribe por DM', r like 'err:42501%', r);
  insert into public.friendships (requester_id, addressee_id, status) values (u3, u2, 'pending');
  r := pg_temp.como('authenticated', u2, 'aal1', format(
    $q$with x as (update public.friendships set status = 'accepted', responded_at = now() where requester_id = %L and addressee_id = %L returning 1) select count(*)::text from x$q$, u3, u2));
  insert into r177 values ('A3 control: aceptar una solicitud pendiente sigue funcionando', r = 'ok:1', r);

  -- ── B. Alta de partidos ───────────────────────────────────────
  select id into v_reserva from public.reservas limit 1;
  r := pg_temp.como('authenticated', u1, 'aal1', format(v_partido, ', reserva_id', u1, format(', %L', v_reserva)));
  insert into r177 values ('B1 no se crea un partido con reserva ajena', r like 'err:42501%', r);
  r := pg_temp.como('authenticated', u1, 'aal1', format(v_partido, ', estado', u1, ', ''finalizado'''));
  insert into r177 values ('B2 no se crea un partido ya finalizado', r like 'err:42501%', r);
  r := pg_temp.como('authenticated', u1, 'aal1', format(v_partido, ', club_local_id, club_visitante_id, challenge_id', u1, ', null, null, null'));
  insert into r177 values ('B3 control: el alta normal (con los campos de club en nulo) funciona', r like 'ok:%', r);

  insert into public.clubs (nombre, slug, created_by) values ('Club A r177', 'a-r177-' || substr(u1::text, 1, 8), u1) returning id into c_a;
  insert into public.clubs (nombre, slug, created_by) values ('Club B r177', 'b-r177-' || substr(u2::text, 1, 8), u2) returning id into c_b;
  insert into public.clubs (nombre, slug, created_by) values ('Club C r177', 'c-r177-' || substr(u3::text, 1, 8), u3) returning id into c_c;
  insert into public.club_members (club_id, user_id, rol) values (c_a, u1, 'admin'), (c_b, u2, 'admin'), (c_c, u3, 'admin');
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (c_a, c_b, u1, 'aceptado') returning id into v_reto;

  r := pg_temp.como('authenticated', u3, 'aal1', format(v_partido, ', club_local_id, club_visitante_id, challenge_id', u3, format(', %L, %L, %L', c_a, c_b, v_reto)));
  insert into r177 values ('B4 un tercero no publica el partido del desafío de otros', r like 'err:42501%', r);
  r := pg_temp.como('authenticated', u1, 'aal1', format(v_partido, ', club_local_id, club_visitante_id, challenge_id', u1, format(', %L, %L, %L', c_c, c_b, v_reto)));
  insert into r177 values ('B5 no se mete a un club ajeno en el partido', r like 'err:42501%', r);
  r := pg_temp.como('authenticated', u1, 'aal1', format(v_partido, ', club_local_id, club_visitante_id, challenge_id', u1, format(', %L, %L, %L', c_a, c_b, v_reto)));
  insert into r177 values ('B6 control: el admin publica el partido de su desafío', r like 'ok:%', r);

  -- ── C. Desafíos abiertos ──────────────────────────────────────
  r := pg_temp.como('authenticated', u1, 'aal1', format(
    $q$insert into public.club_open_challenges (club_id, creado_por, modalidad, fecha_propuesta, mensaje) values (%L, %L, 'futbol7', now() + interval '5 days', 'r177') returning id::text$q$, c_a, u1));
  insert into r177 values ('C0 control: publicar un desafío abierto', r like 'ok:%', r);
  v_pub := nullif(substr(r, 4), '')::uuid;
  r := pg_temp.como('authenticated', u2, 'aal1', format(
    $q$insert into public.club_open_challenge_responses (open_challenge_id, club_id, creado_por, mensaje) values (%L, %L, %L, 'va') returning id::text$q$, v_pub, c_b, u2));
  insert into r177 values ('C1 control: responder con el propio club', r like 'ok:%', r);
  v_resp := nullif(substr(r, 4), '')::uuid;
  r := pg_temp.como('authenticated', u2, 'aal1', format(
    $q$with x as (update public.club_open_challenge_responses set club_id = %L where id = %L returning 1) select count(*)::text from x$q$, c_c, v_resp));
  insert into r177 values ('C2 la respuesta no cambia de club', r like 'err:42501%', r);
  r := pg_temp.como('authenticated', u2, 'aal1', format(
    $q$with x as (update public.club_open_challenge_responses set estado = 'retirada' where id = %L returning 1) select count(*)::text from x$q$, v_resp));
  insert into r177 values ('C3 control: retirar la respuesta', r = 'ok:1', r);
  r := pg_temp.como('authenticated', u2, 'aal1', format(
    $q$with x as (update public.club_open_challenge_responses set estado = 'pendiente' where id = %L returning 1) select count(*)::text from x$q$, v_resp));
  insert into r177 values ('C3b control: deshacer el retiro con la publicación abierta', r = 'ok:1', r);
  r := pg_temp.como('authenticated', u2, 'aal1', format(
    $q$with x as (update public.club_open_challenge_responses set estado = 'retirada' where id = %L returning 1) select count(*)::text from x$q$, v_resp));
  r := pg_temp.como('authenticated', u1, 'aal1', format(
    $q$with x as (update public.club_open_challenges set estado = 'cancelado' where id = %L returning 1) select count(*)::text from x$q$, v_pub));
  insert into r177 values ('C4 control: retirar la publicación', r = 'ok:1', r);
  r := pg_temp.como('authenticated', u1, 'aal1', format(
    $q$with x as (update public.club_open_challenges set estado = 'abierto' where id = %L returning 1) select count(*)::text from x$q$, v_pub));
  insert into r177 values ('C5 una publicación retirada no se reabre', r like 'err:42501%', r);
  r := pg_temp.como('authenticated', u2, 'aal1', format(
    $q$with x as (update public.club_open_challenge_responses set estado = 'pendiente' where id = %L returning 1) select count(*)::text from x$q$, v_resp));
  insert into r177 values ('C6 no se reactiva una respuesta de una publicación cerrada', r like 'err:42501%', r);

  -- ── D. Invitación ─────────────────────────────────────────────
  insert into public.club_join_requests (club_id, user_id, tipo, status) values (c_a, u4, 'invitacion', 'pending') returning id into v_inv;
  r := pg_temp.como('authenticated', u4, 'aal1', format(
    $q$with x as (update public.club_join_requests set status = 'approved', responded_at = now() where id = %L returning 1) select count(*)::text from x$q$, v_inv));
  insert into r177 values ('D1 control: aceptar la invitación', r = 'ok:1' and exists (select 1 from public.club_members where club_id = c_a and user_id = u4), r);
  delete from public.club_members where club_id = c_a and user_id = u4;   -- lo expulsan
  r := pg_temp.como('authenticated', u4, 'aal1', format(
    $q$with x as (update public.club_join_requests set status = 'pending' where id = %L returning 1) select count(*)::text from x$q$, v_inv));
  insert into r177 values ('D2 el expulsado no reabre su invitación', r like 'err:42501%', r);

  -- ── E. Buckets ────────────────────────────────────────────────
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('avatars', u1::text || '/r177.jpg', u1, u1::text);
  r := pg_temp.como('anon', null, null, $q$select count(*)::text from storage.objects where bucket_id in ('avatars','profile-gallery','club-logos','club-gallery','complejo-fotos','match-covers')$q$);
  insert into r177 values ('E1 sin cuenta no se lista ningún bucket público', r = 'ok:0', r);
  r := pg_temp.como('authenticated', u2, 'aal1', format($q$select count(*)::text from storage.objects where bucket_id = 'avatars' and name like %L$q$, u1::text || '/%'));
  insert into r177 values ('E2 otra cuenta no lista la carpeta ajena', r = 'ok:0', r);
  r := pg_temp.como('authenticated', u1, 'aal1', format($q$select count(*)::text from storage.objects where bucket_id = 'avatars' and name like %L$q$, u1::text || '/%'));
  insert into r177 values ('E3 control: cada uno lista lo suyo (remove y upsert lo necesitan)', r = 'ok:1', r);

  -- ── F. Dos pasos ──────────────────────────────────────────────
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), u5, 'r177', 'totp', 'verified', now(), now());
  insert into public.notifications (user_id, type, title, body) values (u5, 'friend_request', 'r177', 'r177');
  r := pg_temp.como('authenticated', u5, 'aal1', 'select public.exigir_mfa_por_peticion()::text');
  insert into r177 values ('F1 con factor y aal1, la API se niega', r like 'err:42501%', r);
  r := pg_temp.como('authenticated', u5, 'aal1', format('select count(*)::text from public.notifications where user_id = %L', u5));
  insert into r177 values ('F2 con factor y aal1, el tiempo real no entrega avisos', r = 'ok:0', r);
  r := pg_temp.como('authenticated', u5, 'aal2', format('select count(*)::text from public.notifications where user_id = %L', u5));
  insert into r177 values ('F3 control: con aal2 sí', r = 'ok:1' and pg_temp.como('authenticated', u5, 'aal2', 'select public.exigir_mfa_por_peticion()::text') like 'ok:%', r);
  r := pg_temp.como('authenticated', u6, 'aal1', 'select public.exigir_mfa_por_peticion()::text');
  insert into r177 values ('F4 control: sin factor, aal1 basta (todas las cuentas de hoy)', r like 'ok:%', r);
  r := pg_temp.como('anon', null, null, 'select public.exigir_mfa_por_peticion()::text');
  insert into r177 values ('F5 control: sin cuenta no se exige nada', r like 'ok:%', r);
  insert into r177 select 'F6 PostgREST la corre antes de cada petición',
    exists (select 1 from pg_db_role_setting s join pg_roles ro on ro.oid = s.setrole
             where ro.rolname = 'authenticator'
               and array_to_string(s.setconfig, ',') like '%pgrst.db_pre_request=public.exigir_mfa_por_peticion%'), '';

  -- ── G. Menores y edad ─────────────────────────────────────────
  r := pg_temp.como('authenticated', u7, 'aal1', format(
    $q$with x as (update public.profiles set edad = 15 where id = %L returning privacy_visible_in_search) select bool_and(not privacy_visible_in_search)::text from x$q$, u7));
  insert into r177 values ('G1 un menor queda fuera de las búsquedas al poner su edad', r = 'ok:true', r);
  r := pg_temp.como('authenticated', u7, 'aal1', format(
    $q$with x as (update public.profiles set privacy_visible_in_search = true where id = %L returning 1) select count(*)::text from x$q$, u7));
  insert into r177 values ('G2 un menor no se hace descubrible', r like 'err:42501%', r);
  r := pg_temp.como('authenticated', u7, 'aal1', format(
    $q$with x as (update public.profiles set edad = 30 where id = %L returning 1) select count(*)::text from x$q$, u7));
  insert into r177 values ('G3 la edad registrada no se cambia', r like 'err:42501%', r);
  r := pg_temp.como('authenticated', u8, 'aal1', format(
    $q$with x as (update public.profiles set edad = 25, bio = 'r177' where id = %L returning privacy_visible_in_search) select bool_and(privacy_visible_in_search)::text from x$q$, u8));
  insert into r177 values ('G4 control: un adulto sigue descubrible', r = 'ok:true', r);
  r := pg_temp.como('authenticated', u8, 'aal1', format(
    $q$with x as (update public.profiles set edad = 25, bio = 'otra' where id = %L returning 1) select count(*)::text from x$q$, u8));
  insert into r177 values ('G5 control: guardar el perfil con la misma edad funciona', r = 'ok:1', r);
  insert into r177 select 'G6 no queda ningún menor descubrible',
    not exists (select 1 from public.profiles where edad < 18 and privacy_visible_in_search), '';

  -- ── H. Calificaciones de recintos ─────────────────────────────
  r := pg_temp.como('anon', null, null, 'select count(*)::text from public.complejo_calificaciones');
  insert into r177 values ('H1 sin cuenta no se leen las calificaciones de recintos', r = 'ok:0' or r like 'err:42501%', r);
end $$;

select caso, ok, detalle from r177 order by caso;

rollback;
