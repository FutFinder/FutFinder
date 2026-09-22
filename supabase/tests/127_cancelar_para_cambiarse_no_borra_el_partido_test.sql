-- =============================================================
-- FutFinder — pruebas de la migración 127.
--
--   C1  Cancelar para cambiarse deja el partido en `cancelado`, NO lo borra.
--   C2  Los inscritos conservan su fila: el partido sigue en su historial…
--   C3  …y el aviso que reciben apunta a un partido que todavía existe.
--   C4  El chat del partido sobrevive (lo conservaba la 34 y el `cascade` se
--       lo llevaba).
--   C5  La sanción de 25 se cobra una sola vez.
--   C6  La segunda llamada se rechaza y no vuelve a cobrar.
--   C7  La lista de espera recibe aviso y se cierra.
--   C8  El anfitrión queda inscrito en el partido de destino.
--   C9  Un partido ENTRE CLUBES se rechaza por las dos puertas —`swap_match`
--       y `cancel_match_and_join`— y sigue existiendo con su gente dentro.
--
-- El control negativo de C9 se corrió contra las funciones desplegadas el
-- 2026-09-21 y reprodujo las dos fallas: `swap_match` sacaba al jugador
-- (`ok=true`, su fila borrada) y `cancel_match_and_join` borraba el encuentro
-- entero (`ok=true`, cero filas).
--
-- OJO CON QUIÉN LEE. Las llamadas van como `authenticated`, pero las
-- COMPROBACIONES van después de `reset role`: leyendo como el jugador, la RLS
-- esconde los avisos de otra persona y la nómina de un partido entre clubes de
-- un club al que no pertenece. La primera versión de este arnés falló cuatro
-- casos por eso, y ninguno era un fallo de la migración.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r127 (caso text, ok boolean, detalle text);
grant all on r127 to authenticated;

do $$
declare
  v_anfitrion uuid := gen_random_uuid();
  v_inscrito uuid := gen_random_uuid();
  v_encola uuid := gen_random_uuid();
  v_otro uuid := gen_random_uuid();   -- organiza los destinos
  v_mio uuid; v_destino uuid; v_destino2 uuid;
  v_club_m uuid; v_prop uuid; v_club uuid;
  v_res0 jsonb; v_res6 jsonb; v_res9a jsonb; v_res9b jsonb;
  v_t int; v_estado text; v_n int;
  v_base timestamptz := date_trunc('hour', now()) + interval '3 days';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r127-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_anfitrion, v_inscrito, v_encola, v_otro]) u;
  update public.profiles set trust_score = 80 where id = v_anfitrion;

  -- El partido del anfitrión, con un inscrito, alguien en la cola y un mensaje.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_anfitrion, 'r127 el mio', 'Santiago', 'Cancha', -33.45, -70.66,
      v_base, 5, 5, 'abierto', 90, 'inmediata') returning id into v_mio;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_otro, 'r127 destino', 'Santiago', 'Cancha', -33.45, -70.66,
      v_base + interval '2 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_destino;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_otro, 'r127 destino 2', 'Santiago', 'Cancha', -33.45, -70.66,
      v_base + interval '4 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_destino2;

  insert into public.attendees (id_partido, id_jugador, estado) values (v_mio, v_inscrito, 'inscrito');
  insert into public.match_waitlist (id_partido, id_jugador) values (v_mio, v_encola);
  insert into public.messages (sender_id, match_id, content)
  values (v_anfitrion, v_mio, 'Nos vemos el sábado');

  -- El partido entre clubes de C9, sobre una propuesta real que todavía no
  -- tenga partido (el índice único parcial de la 44 no deja dos).
  select p.id into v_prop from public.club_challenge_proposals p
   where not exists (select 1 from public.matches m where m.challenge_proposal_id = p.id)
   limit 1;
  select id into v_club from public.clubs order by created_at limit 1;
  if v_prop is not null then
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
        hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion, challenge_proposal_id)
    values (v_anfitrion, 'r127 entre clubes', 'Santiago', 'Cancha', -33.45, -70.66,
        v_base + interval '6 days', 14, 14, 'abierto', 60, 'inmediata', v_prop) returning id into v_club_m;
    -- `club_id` es la marca de que la inscripción vino por la RPC del club:
    -- sin ella, el trigger de la 44d no deja escribirla a mano.
    insert into public.attendees (id_partido, id_jugador, estado, club_id)
    values (v_club_m, v_inscrito, 'inscrito', v_club);
  end if;

  -- ── Las acciones, como las hace la app ────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_anfitrion, 'role', 'authenticated')::text, true);
  v_res0 := public.cancel_match_and_join(v_mio, v_destino);
  v_res6 := public.cancel_match_and_join(v_mio, v_destino2);

  if v_club_m is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_inscrito, 'role', 'authenticated')::text, true);
    v_res9a := public.swap_match(v_club_m, v_destino2);

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_anfitrion, 'role', 'authenticated')::text, true);
    v_res9b := public.cancel_match_and_join(v_club_m, v_destino2);
  end if;

  -- ── Las comprobaciones, sin RLS encima ────────────────────────
  reset role;

  insert into r127 values ('C0 el cambio del anfitrion funciona',
    (v_res0->>'ok') = 'true', v_res0::text);

  select count(*) into v_n from public.matches where id = v_mio;
  insert into r127 values ('C1 el partido NO se borra', v_n = 1, v_n::text);
  select estado into v_estado from public.matches where id = v_mio;
  insert into r127 values ('C1 queda cancelado', v_estado = 'cancelado', coalesce(v_estado, 'no existe'));

  select count(*) into v_n from public.attendees where id_partido = v_mio and id_jugador = v_inscrito;
  insert into r127 values ('C2 el inscrito conserva su fila (historial)', v_n = 1, v_n::text);

  select count(*) into v_n from public.notifications
   where user_id = v_inscrito and type = 'match_cancelled'
     and (data->>'matchId') = v_mio::text
     and exists (select 1 from public.matches m where m.id = v_mio);
  insert into r127 values ('C3 el aviso apunta a un partido que existe', v_n = 1, v_n::text);

  select count(*) into v_n from public.messages where match_id = v_mio;
  insert into r127 values ('C4 el chat sobrevive', v_n = 1, v_n::text);

  select trust_score into v_t from public.profiles where id = v_anfitrion;
  insert into r127 values ('C5 cobra los 25 una vez (80 a 55)', v_t = 55, v_t::text);

  insert into r127 values ('C6 la segunda llamada se rechaza', (v_res6->>'ok') = 'false', v_res6::text);
  insert into r127 values ('C6 y no vuelve a cobrar', v_t = 55, v_t::text);

  select count(*) into v_n from public.match_waitlist where id_partido = v_mio;
  insert into r127 values ('C7 la lista de espera se cierra', v_n = 0, v_n::text);
  select count(*) into v_n from public.notifications
   where user_id = v_encola and type = 'match_cancelled' and (data->>'matchId') = v_mio::text;
  insert into r127 values ('C7 y a la cola se le avisa', v_n = 1, v_n::text);

  select count(*) into v_n from public.attendees where id_partido = v_destino and id_jugador = v_anfitrion;
  insert into r127 values ('C8 el anfitrion queda en el destino', v_n = 1, v_n::text);

  if v_club_m is null then
    insert into r127 values ('C9 no hay propuesta libre para armar el partido de clubes',
      false, 'el caso no se pudo montar: revisar antes de dar por buena la guarda');
  else
    insert into r127 values ('C9 swap_match rechaza el partido entre clubes',
      (v_res9a->>'ok') = 'false' and (v_res9a->>'reason') like '%entre clubes%', v_res9a::text);
    select count(*) into v_n from public.attendees where id_partido = v_club_m and id_jugador = v_inscrito;
    insert into r127 values ('C9 y el jugador sigue en su nomina', v_n = 1, v_n::text);

    insert into r127 values ('C9 cancel_match_and_join rechaza el partido entre clubes',
      (v_res9b->>'ok') = 'false' and (v_res9b->>'reason') like '%hilo del desafío%', v_res9b::text);
    select count(*) into v_n from public.matches where id = v_club_m and estado = 'abierto';
    insert into r127 values ('C9 y el encuentro sigue existiendo, sin cancelar', v_n = 1, v_n::text);
  end if;
end $$;

reset role;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r127 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r127 where not ok;
    raise exception 'FALLARON % casos de la 127: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r127 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r127;

rollback;
