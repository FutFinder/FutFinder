-- =============================================================
-- FutFinder — pruebas de la migración 175 (el chat llega por Broadcast).
--
-- El corazón es la EQUIVALENCIA: para cada mensaje sembrado se compara a
-- quién le mandó el disparador un Broadcast (`realtime.messages`, topic
-- `chat:<id>`) contra quién puede LEERLO por la RLS de `messages`, con la
-- sesión de cada una de las ocho personas. Tienen que ser el mismo conjunto:
-- uno más es una fuga, uno menos es un mensaje que no llega.
--
--   Q1. DM entre amigos.
--   Q2. DM a alguien que NO es amigo (sembrado por debajo de la RLS):
--       nadie lo puede leer, así que no se le manda a nadie, ni a quien
--       lo escribió.
--   Q3. Mensaje de club: sus miembros.
--   Q4. Mensaje de partido: inscritos y confirmados; la solicitud pendiente no.
--   Q5. Mensaje de desafío: quien tenga permiso de verlo en los dos clubes.
--   Q6. Quien sale del club deja de recibir los mensajes nuevos.
--   Q7. Ninguno de los Broadcast sale de las ocho personas sembradas.
--   U1. Marcar leído un DM manda un UPDATE a los dos lados.
--   U2. Un UPDATE que no cambia nada no manda nada.
--   D1. Borrar un mensaje de club manda un DELETE a sus miembros.
--   A1. Una sesión lee su propio topic.
--   A2. Una sesión NO lee el topic de otra.
--   A3. `anon` no lee ningún topic.
--   A4. Un cliente no puede publicar en `realtime.messages`: 42501.
--   A5. `authenticated` no puede ejecutar `chat_destinatarios`: 42501.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK: como
-- `realtime.send` escribe en `realtime.messages`, tampoco sale ningún
-- Broadcast real.
-- =============================================================

begin;

create temp table r175 (caso text, ok boolean, detalle text);
grant all on r175 to authenticated, anon;

-- `realtime.messages` está particionada por día y las particiones las crea
-- el servicio de Realtime mientras hay clientes conectados. En un proyecto
-- sin nadie conectado hace días, la de hoy puede no existir: `realtime.send`
-- atrapa el error (23514) como WARNING y no manda nada, y el arnés daría
-- todo en falso. Desde SQL no se puede crear (el esquema es del servicio),
-- así que el arnés se niega a correr y dice qué hacer. En uso real no pasa:
-- quien recibe está conectado, y conectarse despierta el servicio.
do $$
begin
  if to_regclass('realtime.messages_' || to_char((now() at time zone 'utc')::date, 'YYYY_MM_DD')) is null then
    raise exception 'Falta la partición de hoy de realtime.messages: abre la app (o cualquier cliente Realtime) unos segundos para que el servicio la cree, y vuelve a correr este arnés.';
  end if;
end $$;

-- Compara Broadcast contra RLS para un mensaje y un evento.
create or replace function pg_temp.r175_compara(p_msg uuid, p_evento text, p_users uuid[])
returns text
language plpgsql
as $$
declare
  v_enviados uuid[];
  v_legibles uuid[] := '{}';
  v_u uuid;
  v_ve boolean;
begin
  select coalesce(array_agg(substring(rm.topic from 6)::uuid order by 1), '{}')
    into v_enviados
    from realtime.messages rm
   where rm.event = p_evento
     and rm.topic like 'chat:%'
     and coalesce(rm.payload->'new'->>'id', rm.payload->'old'->>'id') = p_msg::text;

  foreach v_u in array p_users loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    select exists (select 1 from public.messages where id = p_msg) into v_ve;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    if v_ve then v_legibles := v_legibles || v_u; end if;
  end loop;

  select coalesce(array_agg(x order by x), '{}') into v_legibles from unnest(v_legibles) x;

  if v_enviados = v_legibles then
    return 'ok:' || coalesce(array_length(v_enviados, 1), 0);
  end if;
  return 'enviados=' || v_enviados::text || ' legibles=' || v_legibles::text;
end;
$$;

do $$
declare
  v_a uuid := gen_random_uuid();  -- amiga de B, admin del club 1
  v_b uuid := gen_random_uuid();  -- amigo de A, inscrito en el partido
  v_c uuid := gen_random_uuid();  -- no es amiga de nadie
  v_d uuid := gen_random_uuid();  -- jugador del club 1
  v_e uuid := gen_random_uuid();  -- confirmado por GPS en el partido
  v_f uuid := gen_random_uuid();  -- solicitud pendiente en el partido
  v_g uuid := gen_random_uuid();  -- admin del club 2
  v_h uuid := gen_random_uuid();  -- jugador del club 2
  v_todos uuid[];
  v_marca text := 'r175' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_club1 uuid := gen_random_uuid();
  v_club2 uuid := gen_random_uuid();
  v_partido uuid := gen_random_uuid();
  v_desafio uuid := gen_random_uuid();
  v_m uuid;
  v_n int;
  v_r text;
  v_codigo text;
begin
  v_todos := array[v_a, v_b, v_c, v_d, v_e, v_f, v_g, v_h];

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r175-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(v_todos) u;

  insert into public.friendships (requester_id, addressee_id, status) values (v_a, v_b, 'accepted');

  insert into public.clubs (id, nombre, slug, created_by) values
    (v_club1, v_marca || ' Uno', v_marca || '-uno', v_a),
    (v_club2, v_marca || ' Dos', v_marca || '-dos', v_g);
  insert into public.club_members (club_id, user_id, rol) values
    (v_club1, v_a, 'admin'), (v_club1, v_d, 'jugador'),
    (v_club2, v_g, 'admin'), (v_club2, v_h, 'jugador')
  on conflict do nothing;

  insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (v_partido, v_a, v_marca || ' partido', 'Comuna', 'Cancha',
          -33.45, -70.66, now() + interval '2 days', 10, 7);
  insert into public.attendees (id_partido, id_jugador, estado) values
    (v_partido, v_b, 'inscrito'), (v_partido, v_e, 'confirmado_gps'), (v_partido, v_f, 'pendiente');

  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por)
  values (v_desafio, v_club1, v_club2, v_a);

  -- Q1: DM entre amigos
  insert into public.messages (sender_id, receiver_id, content) values (v_a, v_b, v_marca || ' dm')
  returning id into v_m;
  v_r := pg_temp.r175_compara(v_m, 'INSERT', v_todos);
  insert into r175 values ('Q1 DM entre amigos', v_r = 'ok:2', v_r);

  -- U1: B lo marca leído
  update public.messages set read_at = now() where id = v_m;
  v_r := pg_temp.r175_compara(v_m, 'UPDATE', v_todos);
  insert into r175 values ('U1 marcar leído manda UPDATE a los dos', v_r = 'ok:2', v_r);

  -- U2: un UPDATE que no cambia nada
  update public.messages set content = content where id = v_m;
  select count(*) into v_n from realtime.messages
   where event = 'UPDATE' and payload->'new'->>'id' = v_m::text;
  insert into r175 values ('U2 un UPDATE sin cambios no manda nada', v_n = 2, v_n::text);

  -- Q2: DM a quien no es amigo
  insert into public.messages (sender_id, receiver_id, content) values (v_a, v_c, v_marca || ' dm2')
  returning id into v_m;
  v_r := pg_temp.r175_compara(v_m, 'INSERT', v_todos);
  insert into r175 values ('Q2 DM sin amistad no le llega a nadie', v_r = 'ok:0', v_r);

  -- Q3: club
  insert into public.messages (sender_id, club_id, content) values (v_d, v_club1, v_marca || ' club')
  returning id into v_m;
  v_r := pg_temp.r175_compara(v_m, 'INSERT', v_todos);
  insert into r175 values ('Q3 club: a sus miembros', v_r like 'ok:%' and v_r <> 'ok:0', v_r);

  -- D1: se borra
  delete from public.messages where id = v_m;
  v_r := pg_temp.r175_compara(v_m, 'DELETE', v_todos);
  -- Ya no existe: nadie lo lee por RLS, así que se cuenta directo.
  select count(*) into v_n from realtime.messages
   where event = 'DELETE' and payload->'old'->>'id' = v_m::text
     and substring(topic from 6)::uuid in (v_a, v_d);
  insert into r175 values ('D1 borrar avisa a los miembros', v_n = 2, v_n::text || ' / ' || v_r);

  -- Q4: partido
  insert into public.messages (sender_id, match_id, content) values (v_b, v_partido, v_marca || ' partido')
  returning id into v_m;
  v_r := pg_temp.r175_compara(v_m, 'INSERT', v_todos);
  insert into r175 values ('Q4 partido: inscritos y confirmados', v_r like 'ok:%' and v_r <> 'ok:0', v_r);
  select count(*) into v_n from realtime.messages
   where event = 'INSERT' and payload->'new'->>'id' = v_m::text and topic = 'chat:' || v_f;
  insert into r175 values ('Q4b la solicitud pendiente no lo recibe', v_n = 0, v_n::text);

  -- Q5: desafío
  insert into public.messages (sender_id, challenge_id, content) values (v_a, v_desafio, v_marca || ' desafio')
  returning id into v_m;
  v_r := pg_temp.r175_compara(v_m, 'INSERT', v_todos);
  insert into r175 values ('Q5 desafío: quien puede verlo', v_r like 'ok:%' and v_r <> 'ok:0', v_r);

  -- Q6: D sale del club 1
  delete from public.club_members where club_id = v_club1 and user_id = v_d;
  insert into public.messages (sender_id, club_id, content) values (v_a, v_club1, v_marca || ' club2')
  returning id into v_m;
  v_r := pg_temp.r175_compara(v_m, 'INSERT', v_todos);
  select count(*) into v_n from realtime.messages
   where payload->'new'->>'id' = v_m::text and topic = 'chat:' || v_d;
  insert into r175 values ('Q6 quien sale del club no recibe lo nuevo', v_n = 0 and v_r like 'ok:%', v_n::text || ' / ' || v_r);

  -- Q7: nada sale de las ocho personas
  select count(*) into v_n from realtime.messages rm
   where rm.topic like 'chat:%'
     and coalesce(rm.payload->'new'->>'content', rm.payload->'old'->>'content') like v_marca || '%'
     and substring(rm.topic from 6)::uuid <> all (v_todos);
  insert into r175 values ('Q7 ningún Broadcast sale de los sembrados', v_n = 0, v_n::text);

  -- A1 y A2: la autorización del topic
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('realtime.topic', 'chat:' || v_a, true);
  select count(*) into v_n from realtime.messages where topic = 'chat:' || v_a;
  insert into r175 values ('A1 una sesión lee su propio topic', v_n > 0, v_n::text);
  perform set_config('realtime.topic', 'chat:' || v_b, true);
  select count(*) into v_n from realtime.messages where topic = 'chat:' || v_b;
  insert into r175 values ('A2 una sesión no lee el topic de otra', v_n = 0, v_n::text);

  -- A4: publicar desde el cliente
  v_codigo := 'sin error';
  begin
    insert into realtime.messages (topic, extension, payload, event, private)
    values ('chat:' || v_b, 'broadcast', '{"eventType":"INSERT"}', 'INSERT', true);
  exception when others then
    v_codigo := sqlstate;
  end;
  insert into r175 values ('A4 un cliente no publica en realtime.messages: 42501', v_codigo = '42501', v_codigo);

  -- A5: la función de destinatarios
  v_codigo := 'sin error';
  begin
    perform public.chat_destinatarios(m) from public.messages m limit 1;
  exception when others then
    v_codigo := sqlstate;
  end;
  insert into r175 values ('A5 authenticated no ejecuta chat_destinatarios: 42501', v_codigo = '42501', v_codigo);
  reset role;

  -- A3: anon
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('realtime.topic', 'chat:' || v_a, true);
  begin
    select count(*) into v_n from realtime.messages where topic = 'chat:' || v_a;
  exception when others then
    v_n := 0;
  end;
  insert into r175 values ('A3 anon no lee ningún topic', v_n = 0, v_n::text);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

select caso, ok, detalle from r175 order by caso;
do $$
declare v_mal int;
begin
  select count(*) into v_mal from r175 where not ok;
  if v_mal > 0 then
    raise exception '% caso(s) de la 175 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
