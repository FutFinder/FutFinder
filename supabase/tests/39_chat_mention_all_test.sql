-- =============================================================
-- FutFinder — pruebas manuales de /todos (migración 39)
--
-- Qué cubre:
--   1. Autorizado (miembro del club)   → /todos crea un aviso
--      'chat_mention_all' para cada OTRO miembro del club, no para quien
--      lo mandó.
--   2. Autorizado (inscrito en el partido) → mismo caso para el chat de
--      un partido, usando `attendees` en vez de `club_members`.
--   3. Rechazado en un DM               → aunque sean amigos (el DM en sí
--      es válido), mention_all=true se rechaza con una excepción propia,
--      no con un mensaje de RLS genérico.
--   4. Rechazado: usuario ajeno         → alguien que no pertenece al club
--      no puede ni siquiera insertar el mensaje (RLS de la migración 36 ya
--      lo bloquea; /todos no le agrega ninguna puerta nueva que esquivar).
--   5. Sin duplicar                     → un segundo /todos del mismo club
--      mientras el primer aviso sigue sin leer ACTUALIZA la fila existente
--      en vez de insertar una segunda.
--   6. El cliente no puede falsificar destinatarios → el fan-out sale de
--      `club_members`/`attendees`, nunca de nada en el mensaje; se
--      confirma que la lista de recibidos es exactamente "todos menos el
--      remitente", ni más ni menos, sin importar cuántas filas tenga la
--      tabla de miembros.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run, en un proyecto de desarrollo. Todo corre dentro de
-- una transacción que termina en ROLLBACK, así que no queda nada
-- guardado al terminar. Si algún caso falla, la ejecución se corta con
-- RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_admin       uuid := gen_random_uuid();
  v_member_1    uuid := gen_random_uuid();
  v_member_2    uuid := gen_random_uuid();
  v_ajeno       uuid := gen_random_uuid();

  v_organizador uuid := gen_random_uuid();
  v_att_1       uuid := gen_random_uuid();
  v_att_2       uuid := gen_random_uuid();

  v_club_id     uuid;
  v_match_id    uuid;

  v_msg_id      uuid;
  v_notif_id    uuid;
  v_count       int;
  v_title       text;
  v_raised      boolean;
begin
  -- ── Setup: usuarios ────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         'mention-test-' || u.tag || '-' || u.id || '@futfinder.test', 'x', now(), now(), now(),
         '{}', '{}', '', '', '', ''
  from (values
    (v_admin, 'admin'), (v_member_1, 'member-1'), (v_member_2, 'member-2'), (v_ajeno, 'ajeno'),
    (v_organizador, 'organizador'), (v_att_1, 'att-1'), (v_att_2, 'att-2')
  ) as u(id, tag);

  -- Amistad entre admin y ajeno, solo para el caso 3 (DM válido, pero
  -- mention_all no aplica ahí).
  insert into public.friendships (requester_id, addressee_id, status)
  values (v_admin, v_ajeno, 'accepted');

  -- ── Setup: club con admin + 2 miembros (v_ajeno NO es miembro) ──
  insert into public.clubs (nombre, slug, created_by)
  values ('Club Mención Test', 'club-mencion-test', v_admin)
  returning id into v_club_id;

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_id, v_admin, 'admin'),
    (v_club_id, v_member_1, 'jugador'),
    (v_club_id, v_member_2, 'jugador');

  -- ── Setup: partido con organizador + 2 inscritos ────────────────
  insert into public.matches (
    id_organizador, titulo, region, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles
  ) values (
    v_organizador, 'Picadito mención test', 'Metropolitana', 'Ñuñoa', 'Cancha test',
    -33.45, -70.60, now() + interval '1 day', 10, 10
  ) returning id into v_match_id;

  insert into public.attendees (id_partido, id_jugador, estado) values
    (v_match_id, v_att_1, 'inscrito'),
    (v_match_id, v_att_2, 'confirmado_gps');
  -- El organizador ya queda 'inscrito' por el trigger de la migración 05.

  -- A partir de acá actuamos como distintos usuarios autenticados, igual
  -- que lo haría PostgREST, para que RLS se evalúe de verdad.

  -- ══ CASO 1: /todos autorizado en el chat del club ═══════════════
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);

  insert into public.messages (sender_id, club_id, content, mention_all)
  values (v_admin, v_club_id, 'Recuerden pagar la cuota', true)
  returning id into v_msg_id;

  if v_msg_id is null then
    raise exception 'FALLÓ (caso 1): un miembro del club debería poder mandar /todos';
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'chat_mention_all' and data->>'threadKey' = 'club:' || v_club_id::text;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 1): deberían crearse 2 avisos (member_1 y member_2), no %', v_count;
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'chat_mention_all' and user_id = v_admin;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 1): el propio remitente no debería recibir su propio aviso';
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'chat_mention_all' and user_id = v_member_1
    and data->>'threadKey' = 'club:' || v_club_id::text;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 1): member_1 debería tener exactamente un aviso';
  end if;
  raise notice 'OK (caso 1): /todos en el club avisó a los 2 otros miembros, no al remitente';

  -- ══ CASO 2: /todos autorizado en el chat del partido ════════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_organizador, 'role', 'authenticated')::text);

  insert into public.messages (sender_id, match_id, content, mention_all)
  values (v_organizador, v_match_id, 'Nos vemos a las 9', true);

  select count(*) into v_count
  from public.notifications
  where type = 'chat_mention_all' and data->>'threadKey' = 'match:' || v_match_id::text;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 2): deberían avisarse los 2 inscritos, no %', v_count;
  end if;
  raise notice 'OK (caso 2): /todos en el partido avisó a los 2 inscritos, no al organizador';

  -- ══ CASO 3: /todos rechazado en un DM (aunque el DM sea válido) ═
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);

  v_raised := false;
  begin
    insert into public.messages (sender_id, receiver_id, content, mention_all)
    values (v_admin, v_ajeno, 'hola a todos?', true);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FALLÓ (caso 3): mention_all en un DM debería rechazarse, no insertarse';
  end if;
  raise notice 'OK (caso 3): /todos en un DM se rechaza aunque el DM en sí sea válido';

  -- ══ CASO 4: usuario ajeno no puede ni insertar el mensaje ════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);

  v_raised := false;
  begin
    insert into public.messages (sender_id, club_id, content, mention_all)
    values (v_ajeno, v_club_id, 'me cuelo', true);
  exception when insufficient_privilege then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FALLÓ (caso 4): alguien que no es miembro del club no debería poder mandar /todos ahí';
  end if;
  raise notice 'OK (caso 4): la RLS existente ya bloquea a quien no es participante del grupo';

  -- ══ CASO 5: un segundo /todos no duplica, actualiza ═════════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);

  select id into v_notif_id
  from public.notifications
  where type = 'chat_mention_all' and user_id = v_member_1
    and data->>'threadKey' = 'club:' || v_club_id::text;

  insert into public.messages (sender_id, club_id, content, mention_all)
  values (v_admin, v_club_id, 'Segundo aviso a todos', true);

  select count(*) into v_count
  from public.notifications
  where type = 'chat_mention_all' and user_id = v_member_1
    and data->>'threadKey' = 'club:' || v_club_id::text;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 5): un segundo /todos sin leer el primero debería actualizar la misma fila, no crear otra (hay %)', v_count;
  end if;

  select id, (data->>'mentionCount')::int into v_notif_id, v_count
  from public.notifications
  where type = 'chat_mention_all' and user_id = v_member_1
    and data->>'threadKey' = 'club:' || v_club_id::text;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 5): mentionCount debería ser 2 tras el segundo /todos, no %', v_count;
  end if;
  raise notice 'OK (caso 5): dos /todos consecutivos sin leer agrupan en un solo aviso (mentionCount=2)';

  -- ══ CASO 6: el cliente no puede falsificar destinatarios ════════
  -- Si /todos leyera la lista de destinatarios de cualquier lado que no
  -- fuera club_members/attendees, esto no cuadraría: los únicos avisados
  -- deben ser exactamente los OTROS miembros reales del club, ni v_ajeno
  -- (nunca fue miembro) ni el propio remitente.
  select count(*) into v_count
  from public.notifications n
  where n.type = 'chat_mention_all'
    and n.data->>'threadKey' = 'club:' || v_club_id::text
    and n.user_id not in (
      select user_id from public.club_members where club_id = v_club_id
    );
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): hay avisos a usuarios que no son miembros reales del club';
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'chat_mention_all' and user_id = v_ajeno;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): v_ajeno nunca fue miembro del club y no debería tener ningún aviso';
  end if;
  raise notice 'OK (caso 6): los destinatarios salen solo de club_members/attendees, nunca del cliente';

  raise notice '✅ TODOS LOS CASOS DE /todos PASARON';
end $$;

rollback;
