-- =============================================================
-- FutFinder — pruebas de la migración 204 (responder un desafío abierto
-- avisa).
--
--   B1. Responder avisa al administrador del club que publicó.
--   B2. A nadie del club que respondió ni a quien no puede elegir respuesta.
--   B3. El aviso trae el club, la publicación y la respuesta.
--   B4. Retirar no avisa; volver a responder (misma fila) avisa otra vez.
--   B5. Si administras los dos clubes, el aviso te llega igual.
--
-- Corre como `authenticated` y con los mismos insert/update de la app
-- (`respondToOpenChallenge`, `withdrawResponse`). Sin la 204 falla en B1.
-- Termina en ROLLBACK.
-- =============================================================

begin;

create temp table r204 (caso text, ok boolean, detalle text);
grant all on r204 to authenticated;

do $$
declare
  v_jefe uuid := gen_random_uuid();    -- admin del club que publica
  v_jugador uuid := gen_random_uuid(); -- integrante sin permiso de elegir
  v_rival uuid := gen_random_uuid();   -- admin del club que responde
  v_publica uuid; v_responde uuid; v_open uuid; v_resp uuid; v_open2 uuid; v_resp2 uuid; v_suyo uuid;
  mk text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  n int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r204-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_jefe, v_jugador, v_rival]) u;

  insert into public.clubs (nombre, slug, created_by)
  values ('Publica 204 ' || mk, 'publica-204-' || mk, v_jefe) returning id into v_publica;
  insert into public.clubs (nombre, slug, created_by)
  values ('Responde 204 ' || mk, 'responde-204-' || mk, v_rival) returning id into v_responde;
  insert into public.club_members (club_id, user_id, rol) values (v_publica, v_jefe, 'admin')
  on conflict (club_id, user_id) do update set rol = 'admin';
  insert into public.club_members (club_id, user_id, rol) values (v_publica, v_jugador, 'jugador')
  on conflict (club_id, user_id) do update set rol = 'jugador';
  insert into public.club_members (club_id, user_id, rol) values (v_responde, v_rival, 'admin')
  on conflict (club_id, user_id) do update set rol = 'admin';

  -- El club publica, como `publishOpenChallenge`.
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jefe, 'role', 'authenticated')::text);
  insert into public.club_open_challenges (club_id, creado_por, modalidad, fecha_propuesta)
  values (v_publica, v_jefe, 'futbol7', now() + interval '5 days') returning id into v_open;

  -- El rival responde, como `respondToOpenChallenge`.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_rival, 'role', 'authenticated')::text);
  insert into public.club_open_challenge_responses (open_challenge_id, club_id, creado_por, mensaje)
  values (v_open, v_responde, v_rival, 'Vamos') returning id into v_resp;
  reset role;

  insert into r204 values ('B1 avisa al admin que publicó',
    (select count(*) from public.notifications where user_id = v_jefe and type = 'club_open_challenge_response') = 1,
    (select string_agg(title, ' | ') from public.notifications where user_id = v_jefe));

  insert into r204 values ('B2 ni al que respondió ni a quien no puede elegir',
    not exists (select 1 from public.notifications where user_id in (v_rival, v_jugador) and type = 'club_open_challenge_response')
    and public.tiene_permiso_de_club(v_publica, v_jugador, 'answerChallenge') = false,
    'jugador puede elegir: ' || public.tiene_permiso_de_club(v_publica, v_jugador, 'answerChallenge')::text);

  insert into r204 values ('B3 el aviso nombra club, publicación y respuesta',
    exists (select 1 from public.notifications where user_id = v_jefe and type = 'club_open_challenge_response'
      and data->>'clubId' = v_publica::text and data->>'openChallengeId' = v_open::text
      and data->>'responseId' = v_resp::text and data->>'clubRespondedorId' = v_responde::text
      and title like '%Responde 204%quiere jugar tu desafío' and body like '%Publica 204%'),
    (select data::text || ' · ' || body from public.notifications where user_id = v_jefe and type = 'club_open_challenge_response' limit 1));

  -- Retira y vuelve a responder, como `withdrawResponse` y el reintento.
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_rival, 'role', 'authenticated')::text);
  update public.club_open_challenge_responses set estado = 'retirada' where id = v_resp and estado = 'pendiente';
  reset role;
  select count(*) into n from public.notifications where user_id = v_jefe and type = 'club_open_challenge_response';
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_rival, 'role', 'authenticated')::text);
  update public.club_open_challenge_responses set estado = 'pendiente' where id = v_resp and estado = 'retirada';
  reset role;
  insert into r204 values ('B4 retirar no avisa, volver a responder sí',
    n = 1 and (select count(*) from public.notifications where user_id = v_jefe and type = 'club_open_challenge_response') = 2,
    'tras retirar: ' || n || ' · tras volver: ' || (select count(*) from public.notifications where user_id = v_jefe and type = 'club_open_challenge_response'));

  -- Lo de Vicente: el admin de los dos clubes publica con uno y responde con el otro.
  insert into public.club_members (club_id, user_id, rol) values (v_responde, v_jefe, 'admin')
  on conflict (club_id, user_id) do update set rol = 'admin';
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jefe, 'role', 'authenticated')::text);
  insert into public.club_open_challenges (club_id, creado_por, modalidad, fecha_propuesta)
  values (v_publica, v_jefe, 'futbol7', now() + interval '6 days') returning id into v_open2;
  insert into public.club_open_challenge_responses (open_challenge_id, club_id, creado_por)
  values (v_open2, v_responde, v_jefe) returning id into v_resp2;
  reset role;
  insert into r204 values ('B5 si administras los dos, te llega igual',
    exists (select 1 from public.notifications where user_id = v_jefe and type = 'club_open_challenge_response'
      and data->>'responseId' = v_resp2::text),
    null);
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, left(detalle, 200) as detalle from r204 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r204;

rollback;
