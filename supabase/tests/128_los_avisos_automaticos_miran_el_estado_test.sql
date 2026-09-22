-- =============================================================
-- FutFinder — pruebas de la migración 128.
--
--   P1  El recordatorio de 1 hora SÍ le llega a un partido lleno (no llegaba).
--   P2  …y no le llega a uno cancelado.
--   P3  …ni a quien sólo tiene una solicitud pendiente.
--   P4  El recordatorio de calificar NO se manda en un partido cancelado…
--   P5  …y sí en uno que se jugó.
--   P6  `reject_join` no borra a un jugador ya aceptado.
--   P7  …y sigue rechazando una solicitud de verdad.
--   P8  `approve_join` no vuelve a aceptar a quien ya está dentro.
--   P9  `leave_club_match` rechaza un encuentro cancelado sin tocar los cupos.
--
-- LOS DOS CRON SE CORREN DE VERDAD, no una copia de su consulta. Para que no
-- arrastren partidos reales que casualmente caigan en la ventana, lo primero
-- que hace el arnés es marcarlos como ya avisados DENTRO de la transacción:
-- así la función sólo ve los partidos de prueba, y el `rollback` devuelve todo.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r128 (caso text, ok boolean, detalle text);
grant all on r128 to authenticated;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_jug uuid := gen_random_uuid();
  v_pide uuid := gen_random_uuid();
  v_lleno uuid; v_cancelado uuid; v_jugado uuid; v_cancelado_jugado uuid;
  v_manual uuid; v_club_m uuid; v_prop uuid; v_club uuid;
  v_res jsonb; v_n int; v_cupos int; v_estado text;
begin
  -- Los partidos reales que estén en cualquiera de las dos ventanas quedan
  -- marcados como ya avisados: el cron no los tocará. Se deshace en el rollback.
  update public.matches set reminder_sent_at = now()
   where reminder_sent_at is null
     and hora between now() + interval '55 minutes' and now() + interval '65 minutes';
  update public.matches set rating_reminder_sent_at = now()
   where rating_reminder_sent_at is null
     and hora between now() - interval '105 minutes' and now() - interval '90 minutes';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r128-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_jug, v_pide]) u;

  -- ── Recordatorio de 1 hora: un partido LLENO y uno CANCELADO ──
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r128 lleno', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '60 minutes', 1, 1, 'abierto', 90, 'inmediata') returning id into v_lleno;
  insert into public.attendees (id_partido, id_jugador, estado) values (v_lleno, v_jug, 'inscrito');
  -- Se llena por la nómina: la guarda de la 105 pone `lleno` sola.
  update public.matches set cupos_disponibles = 0 where id = v_lleno;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r128 cancelado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '60 minutes', 5, 5, 'abierto', 90, 'inmediata') returning id into v_cancelado;
  insert into public.attendees (id_partido, id_jugador, estado) values (v_cancelado, v_pide, 'inscrito');
  update public.matches set estado = 'cancelado' where id = v_cancelado;

  -- Una solicitud pendiente en el partido lleno: no tiene cupo, no es «su» partido.
  insert into public.attendees (id_partido, id_jugador, estado) values (v_lleno, v_pide, 'pendiente');

  perform public.send_match_reminders();

  select count(*) into v_n from public.notifications
   where user_id = v_jug and type = 'match_reminder' and (data->>'matchId') = v_lleno::text;
  insert into r128 values ('P1 el recordatorio de 1 h llega a un partido LLENO', v_n = 1, v_n::text);

  select count(*) into v_n from public.notifications
   where type = 'match_reminder' and (data->>'matchId') = v_cancelado::text;
  insert into r128 values ('P2 y no llega a uno cancelado', v_n = 0, v_n::text);

  select count(*) into v_n from public.notifications
   where user_id = v_pide and type = 'match_reminder' and (data->>'matchId') = v_lleno::text;
  insert into r128 values ('P3 ni a quien sólo tiene solicitud pendiente', v_n = 0, v_n::text);

  -- ── Recordatorio de calificar ─────────────────────────────────
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r128 jugado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '5 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_jugado;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r128 cancelado jugado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '6 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_cancelado_jugado;
  insert into public.attendees (id_partido, id_jugador, estado) values (v_jugado, v_jug, 'confirmado_gps');
  insert into public.attendees (id_partido, id_jugador, estado) values (v_cancelado_jugado, v_pide, 'confirmado_gps');
  -- La hora se mueve al pasado después de crear (`trg_match_future_only`).
  update public.matches set hora = now() - interval '95 minutes' where id = v_jugado;
  update public.matches set hora = now() - interval '95 minutes' where id = v_cancelado_jugado;
  update public.matches set estado = 'cancelado' where id = v_cancelado_jugado;

  perform public.send_rating_reminders();

  select count(*) into v_n from public.notifications
   where type = 'match_rate' and (data->>'matchId') = v_cancelado_jugado::text;
  insert into r128 values ('P4 el aviso de calificar NO se manda en un cancelado', v_n = 0, v_n::text);

  select count(*) into v_n from public.notifications
   where user_id = v_jug and type = 'match_rate' and (data->>'matchId') = v_jugado::text;
  insert into r128 values ('P5 y sí en uno que se jugó', v_n = 1, v_n::text);

  -- ── reject_join y approve_join ────────────────────────────────
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r128 manual', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '8 days', 5, 5, 'abierto', 90, 'manual') returning id into v_manual;
  -- Un jugador YA ACEPTADO y otro con la solicitud en pie.
  insert into public.attendees (id_partido, id_jugador, estado) values (v_manual, v_jug, 'inscrito');
  insert into public.attendees (id_partido, id_jugador, estado) values (v_manual, v_pide, 'pendiente');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_org, 'role', 'authenticated')::text, true);

  v_res := public.reject_join(v_manual, v_jug);
  insert into r128 values ('P6 rechazar no bota a un jugador ya aceptado',
    (v_res->>'ok') = 'false', v_res::text);

  v_res := public.approve_join(v_manual, v_jug);
  insert into r128 values ('P8 aprobar a quien ya esta dentro no hace nada',
    (v_res->>'ok') = 'false', v_res::text);

  v_res := public.reject_join(v_manual, v_pide);
  insert into r128 values ('P7 y una solicitud de verdad si se rechaza',
    (v_res->>'ok') = 'true', v_res::text);

  reset role;

  select count(*) into v_n from public.attendees
   where id_partido = v_manual and id_jugador = v_jug and estado = 'inscrito';
  insert into r128 values ('P6 el jugador aceptado sigue en el plantel', v_n = 1, v_n::text);
  select count(*) into v_n from public.attendees where id_partido = v_manual and id_jugador = v_pide;
  insert into r128 values ('P7 y la solicitud rechazada ya no está', v_n = 0, v_n::text);

  -- ── leave_club_match sobre un encuentro cancelado ─────────────
  select p.id into v_prop from public.club_challenge_proposals p
   where not exists (select 1 from public.matches m where m.challenge_proposal_id = p.id) limit 1;
  select id into v_club from public.clubs order by created_at limit 1;

  if v_prop is null then
    insert into r128 values ('P9 no hay propuesta libre para el partido de clubes',
      false, 'el caso no se pudo montar');
  else
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
        hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion, challenge_proposal_id)
    values (v_org, 'r128 entre clubes', 'Santiago', 'Cancha', -33.45, -70.66,
        now() + interval '9 days', 14, 10, 'abierto', 60, 'inmediata', v_prop) returning id into v_club_m;
    insert into public.attendees (id_partido, id_jugador, estado, club_id)
    values (v_club_m, v_jug, 'inscrito', v_club);
    update public.matches set estado = 'cancelado' where id = v_club_m;
    select cupos_disponibles into v_cupos from public.matches where id = v_club_m;

    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_jug, 'role', 'authenticated')::text, true);
    v_res := public.leave_club_match(v_club_m)::jsonb;
    reset role;

    insert into r128 values ('P9 salirse de un encuentro cancelado se rechaza',
      (v_res->>'ok') = 'false', v_res::text);
    select cupos_disponibles, estado into v_n, v_estado from public.matches where id = v_club_m;
    insert into r128 values ('P9 y no le suma un cupo al partido cancelado',
      v_n = v_cupos and v_estado = 'cancelado', v_n || ' / ' || v_estado);
  end if;
end $$;

reset role;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r128 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r128 where not ok;
    raise exception 'FALLARON % casos de la 128: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r128 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r128;

rollback;
