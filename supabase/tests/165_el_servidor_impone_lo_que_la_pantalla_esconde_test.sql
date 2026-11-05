-- =============================================================
-- FutFinder — pruebas de la migración 165.
--
-- Cada caso intenta, COMO `authenticated` y por la API de tablas (lo que
-- puede hacer cualquiera con la clave pública), algo que la pantalla no
-- ofrece pero que la base dejaba pasar:
--
--   A1  Un admin del club A no puede meter fotos en la galería del club B…
--   A2  …ni borrar las de B…
--   A3  …y en su propio club sigue pudiendo las dos cosas.
--   B1  Quien calificó no puede cambiar a quién ni con cuánto…
--   B2  …pero sí su comentario.
--   C1  Una solicitud de amistad no nace «aceptada»…
--   C2  …el destinatario no puede cambiar quién la mandó…
--   C3  …y sigue pudiendo aceptarla.
--   D1  El organizador no puede traspasarle el partido a otra persona…
--   D2  …ni apuntarlo a la reserva de otra…
--   D3  …y sigue pudiendo editar el título.
--   E1  El club retador no puede darse a sí mismo la aceptación…
--   E2  …ni cambiar quién es el rival…
--   E3  …pero sí cancelar lo que mandó…
--   E4  …y el club retado sí puede rechazar.
--   E5  Quien no es del club retado no rechaza en su nombre…
--   E6  …y el partido se vincula una sola vez.
--   F1  Una notificación propia no se reescribe…
--   F2  …pero se marca como leída.
--   G1  El conteo de reportes de alguien lo ve esa persona y quien modera,
--       no el resto…
--   G2  …y a un moderador no se le esconde.
--   H1  Las tres funciones que sólo usan otras funciones no se ejecutan
--       desde el cliente.
--
-- Cada caso exige el CÓDIGO de error esperado (42501), no «algo falló»: un
-- fallo de otro tipo no prueba nada.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r165 (caso text, ok boolean, detalle text);
grant all on r165 to authenticated;

-- Intenta una sentencia COMO ese usuario y devuelve 'ok:<filas>' o
-- 'err:<sqlstate>'. El rol se repone siempre.
create or replace function pg_temp.intenta(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v_n int;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    execute 'reset role';
    return 'ok:' || v_n;
  exception when others then
    execute 'reset role';
    return 'err:' || sqlstate;
  end;
end $$;

do $$
declare
  u1 uuid := gen_random_uuid();   -- admin del club A, organizador, quien califica
  u2 uuid := gen_random_uuid();   -- admin del club B, destinatario de la amistad
  u3 uuid := gen_random_uuid();   -- jugador cualquiera
  u4 uuid := gen_random_uuid();   -- a quien reportan
  u5 uuid := gen_random_uuid();   -- modera
  v_a uuid; v_b uuid; v_c uuid;
  v_foto_b uuid; v_match uuid; v_rating uuid; v_notif uuid;
  v_ch1 uuid; v_ch2 uuid; v_ch3 uuid;
  r text; v_n int; v_txt text; v_uid uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r165-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u2, u3, u4, u5]) u;

  insert into public.clubs (nombre, slug, created_by) values ('r165 A', 'r165-a-' || substr(u1::text,1,8), u1) returning id into v_a;
  insert into public.clubs (nombre, slug, created_by) values ('r165 B', 'r165-b-' || substr(u2::text,1,8), u2) returning id into v_b;
  insert into public.clubs (nombre, slug, created_by) values ('r165 C', 'r165-c-' || substr(u3::text,1,8), u3) returning id into v_c;
  insert into public.club_members (club_id, user_id, rol) values (v_a, u1, 'admin'), (v_b, u2, 'admin'), (v_c, u3, 'admin');

  -- ── A. Galería de fotos de club ───────────────────────────────
  insert into public.club_photos (club_id, photo_url, uploaded_by) values (v_b, 'https://x/b.png', u2) returning id into v_foto_b;

  r := pg_temp.intenta(u1, format(
    $q$insert into public.club_photos (club_id, photo_url, uploaded_by) values (%L, 'https://x/intruso.png', %L)$q$, v_b, u1));
  insert into r165 values ('A1 un admin ajeno no mete fotos en otra galeria', r = 'err:42501', r);

  r := pg_temp.intenta(u1, format($q$delete from public.club_photos where id = %L$q$, v_foto_b));
  select count(*) into v_n from public.club_photos where id = v_foto_b;
  insert into r165 values ('A2 ni borra las de otro club', r = 'ok:0' and v_n = 1, r || ' sigue=' || v_n);

  r := pg_temp.intenta(u1, format(
    $q$insert into public.club_photos (club_id, photo_url, uploaded_by) values (%L, 'https://x/mia.png', %L)$q$, v_a, u1));
  insert into r165 values ('A3 en su propio club si puede subir', r = 'ok:1', r);
  r := pg_temp.intenta(u1, format($q$delete from public.club_photos where club_id = %L$q$, v_a));
  insert into r165 values ('A3 y borrar', r = 'ok:1', r);

  -- ── B. Calificaciones ─────────────────────────────────────────
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (u1, 'r165 partido', 'Ñuñoa', 'Cancha 1', -33.45, -70.6, now() + interval '2 days', 10, 10)
  returning id into v_match;
  insert into public.ratings (match_id, rater_id, rated_id, puntualidad, fairplay, nivel)
  values (v_match, u1, u3, 4, 4, 4) returning id into v_rating;

  r := pg_temp.intenta(u1, format($q$update public.ratings set rated_id = %L where id = %L$q$, u4, v_rating));
  insert into r165 values ('B1 no cambia a quien califica', r = 'err:42501', r);
  r := pg_temp.intenta(u1, format($q$update public.ratings set puntualidad = 1, fairplay = 1 where id = %L$q$, v_rating));
  insert into r165 values ('B1 ni el puntaje', r = 'err:42501', r);
  r := pg_temp.intenta(u1, format($q$update public.ratings set comentario = 'buen compañero' where id = %L$q$, v_rating));
  insert into r165 values ('B2 pero si el comentario', r = 'ok:1', r);

  -- ── C. Amistades ──────────────────────────────────────────────
  r := pg_temp.intenta(u1, format(
    $q$insert into public.friendships (requester_id, addressee_id, status) values (%L, %L, 'accepted')$q$, u1, u2));
  select count(*) into v_n from public.friendships where requester_id = u1;
  insert into r165 values ('C1 una solicitud no nace aceptada', r = 'err:42501' and v_n = 0, r || ' filas=' || v_n);

  r := pg_temp.intenta(u1, format(
    $q$insert into public.friendships (requester_id, addressee_id, status) values (%L, %L, 'pending')$q$, u1, u2));
  insert into r165 values ('C1 pero si nace pendiente (lo que manda la app)', r = 'ok:1', r);

  r := pg_temp.intenta(u2, format($q$update public.friendships set requester_id = %L where addressee_id = %L$q$, u3, u2));
  insert into r165 values ('C2 el destinatario no cambia quien la mando', r = 'err:42501', r);
  r := pg_temp.intenta(u2, format(
    $q$update public.friendships set status = 'accepted', responded_at = now() where addressee_id = %L and status = 'pending'$q$, u2));
  insert into r165 values ('C3 y si puede aceptarla', r = 'ok:1', r);

  -- ── D. Partidos ───────────────────────────────────────────────
  r := pg_temp.intenta(u1, format($q$update public.matches set id_organizador = %L where id = %L$q$, u3, v_match));
  insert into r165 values ('D1 el organizador no traspasa el partido por la API', r = 'err:42501', r);
  -- La reserva de otra persona no se puede enganchar a un partido propio:
  -- no se prueba con un id inventado (daria 23503, la llave foranea) sino
  -- preguntando por el privilegio, que es lo que de verdad se cerro.
  insert into r165 values ('D2 ni lo apunta a una reserva, ni a un club, ni a un desafio',
    not has_column_privilege('authenticated', 'public.matches', 'reserva_id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.matches', 'club_local_id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.matches', 'challenge_id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.matches', 'id_organizador', 'UPDATE'), '');
  r := pg_temp.intenta(u1, format($q$update public.matches set titulo = 'r165 editado' where id = %L$q$, v_match));
  insert into r165 values ('D3 pero si edita el titulo', r = 'ok:1', r);

  -- ── E. Desafíos entre clubes ──────────────────────────────────
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por) values (v_a, v_b, u1) returning id into v_ch1;

  r := pg_temp.intenta(u1, format($q$update public.club_challenges set estado = 'aceptado' where id = %L$q$, v_ch1));
  select estado into v_txt from public.club_challenges where id = v_ch1;
  insert into r165 values ('E1 el retador no se da la aceptacion', r = 'err:42501' and v_txt = 'pendiente', r || ' estado=' || v_txt);
  r := pg_temp.intenta(u1, format($q$update public.club_challenges set club_retado_id = %L where id = %L$q$, v_c, v_ch1));
  insert into r165 values ('E2 ni cambia quien es el rival', r = 'err:42501', r);

  -- E5: alguien que no es del club retado intenta rechazar
  r := pg_temp.intenta(u1, format(
    $q$update public.club_challenges set estado = 'rechazado', responded_at = now(), respondido_por = %L where id = %L$q$, u1, v_ch1));
  select estado into v_txt from public.club_challenges where id = v_ch1;
  insert into r165 values ('E5 quien no es del club retado no rechaza', r = 'err:42501' and v_txt = 'pendiente', r || ' estado=' || v_txt);

  r := pg_temp.intenta(u2, format(
    $q$update public.club_challenges set estado = 'rechazado', responded_at = now(), respondido_por = %L where id = %L and estado = 'pendiente'$q$, u2, v_ch1));
  select estado into v_txt from public.club_challenges where id = v_ch1;
  insert into r165 values ('E4 el club retado si rechaza', r = 'ok:1' and v_txt = 'rechazado', r || ' estado=' || v_txt);

  -- Un segundo desafío (el par A-B ya no tiene uno activo) para cancelar.
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por) values (v_a, v_b, u1) returning id into v_ch2;
  r := pg_temp.intenta(u1, format(
    $q$update public.club_challenges set estado = 'cancelado', responded_at = now() where id = %L and estado = 'pendiente'$q$, v_ch2));
  select estado into v_txt from public.club_challenges where id = v_ch2;
  insert into r165 values ('E3 el retador si cancela lo que mando', r = 'ok:1' and v_txt = 'cancelado', r || ' estado=' || v_txt);

  -- E6: el partido se vincula una sola vez.
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por) values (v_a, v_b, u1) returning id into v_ch3;
  r := pg_temp.intenta(u1, format($q$update public.club_challenges set match_id = %L where id = %L$q$, v_match, v_ch3));
  insert into r165 values ('E6 vincular el partido la primera vez', r = 'ok:1', r);
  r := pg_temp.intenta(u1, format($q$update public.club_challenges set match_id = null where id = %L$q$, v_ch3));
  insert into r165 values ('E6 y no se desvincula ni se cambia', r = 'err:42501', r);

  -- ── F. Notificaciones ─────────────────────────────────────────
  insert into public.notifications (user_id, type, title, body) values (u1, 'friend_request', 'original', 'x') returning id into v_notif;
  r := pg_temp.intenta(u1, format($q$update public.notifications set title = 'reescrita' where id = %L$q$, v_notif));
  insert into r165 values ('F1 una notificacion propia no se reescribe', r = 'err:42501', r);
  r := pg_temp.intenta(u1, format($q$update public.notifications set read = true where id = %L$q$, v_notif));
  insert into r165 values ('F2 pero se marca como leida', r = 'ok:1', r);

  -- ── G. Conteo de reportes ─────────────────────────────────────
  insert into public.user_reports (reporter_id, reported_id, motivo) values (u2, u4, 'spam'), (u3, u4, 'spam');
  insert into public.moderadores (user_id) values (u5);

  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := public.count_reports_against(u4);
  reset role;
  insert into r165 values ('G1 un tercero no ve cuantos reportes tiene otro', v_n = 0, 'vio=' || v_n);

  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := public.count_reports_against(u4);
  reset role;
  insert into r165 values ('G1 la propia persona si', v_n = 2, 'vio=' || v_n);

  perform set_config('request.jwt.claims', json_build_object('sub', u5, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := public.count_reports_against(u4);
  reset role;
  insert into r165 values ('G2 quien modera tambien', v_n = 2, 'vio=' || v_n);

  -- ── H. Funciones que no son endpoints ─────────────────────────
  insert into r165 values ('H1 _sembrar_permisos_actuales no se ejecuta desde el cliente',
    not has_function_privilege('authenticated', 'public._sembrar_permisos_actuales(uuid)', 'EXECUTE'), '');
  insert into r165 values ('H1 recalc_user_ratings tampoco',
    not has_function_privilege('authenticated', 'public.recalc_user_ratings(uuid)', 'EXECUTE'), '');
  insert into r165 values ('H1 cuota_de_reserva tampoco',
    not has_function_privilege('authenticated', 'public.cuota_de_reserva(uuid, uuid)', 'EXECUTE'), '');
end $$;

select caso, ok, detalle from r165 order by caso;
do $$
declare v_mal int;
begin
  select count(*) into v_mal from r165 where not ok;
  if v_mal > 0 then
    raise exception '% caso(s) de la 165 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
