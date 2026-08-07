-- =============================================================
-- FutFinder — pruebas manuales de RLS del chat (migración 36)
--
-- Qué cubre:
--   1. Amigo (accepted)              → DM se puede leer y escribir.
--   2. No amigo (sin relación)       → DM no se puede leer ni escribir,
--                                       aunque seas el remitente/destinatario.
--   3. Solicitud pendiente           → igual que "no amigo": 'pending'
--                                       no habilita el chat.
--   4. Usuario ajeno                 → sin fila en `attendees` ni en
--                                       `club_members`, no puede leer ni
--                                       escribir en el chat de un partido
--                                       ni en el de un club.
--   5. Asistente autorizado          → estado 'inscrito' sí puede leer
--                                       y escribir en el chat del partido.
--   6. Asistente pendiente           → solicitud de aprobación manual aún
--                                       no aceptada: no puede leer ni escribir.
--   7. Asistente cancelado           → no puede leer ni escribir.
--   8. Desafío de club aceptado      → admins de dos clubes con un desafío
--                                       'aceptado' entre ellos SÍ pueden
--                                       chatear por DM sin ser amigos.
--   9. Desafío de club NO aceptado   → la excepción es sólo para
--                                       'aceptado': ni 'pendiente' ni
--                                       'rechazado' dan acceso al chat,
--                                       ni siquiera a quien lo envió.
--  10. Marcador de lectura           → `mark_thread_as_read` sólo marca
--                                       como leído un DM válido (amigo o
--                                       desafío vigente); para uno inválido
--                                       no toca nada.
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
  v_alice        uuid := gen_random_uuid();
  v_bob          uuid := gen_random_uuid();
  v_carol        uuid := gen_random_uuid();
  v_dave         uuid := gen_random_uuid();
  v_ajeno        uuid := gen_random_uuid();

  v_organizador  uuid := gen_random_uuid();
  v_att_ok       uuid := gen_random_uuid();
  v_att_pend     uuid := gen_random_uuid();
  v_att_cancel   uuid := gen_random_uuid();

  v_club_member  uuid := gen_random_uuid();

  v_admin_a      uuid := gen_random_uuid();
  v_admin_b      uuid := gen_random_uuid();
  v_admin_c      uuid := gen_random_uuid();
  v_admin_d      uuid := gen_random_uuid();

  v_match1       uuid;
  v_club_x       uuid;
  v_club_a       uuid;
  v_club_b       uuid;
  v_club_c       uuid;
  v_club_d       uuid;

  v_msg_friend        uuid;
  v_msg_stranger      uuid;
  v_msg_pending       uuid;
  v_msg_match_ok      uuid;
  v_msg_club          uuid;
  v_msg_challenge_ok  uuid;
  v_msg_challenge_pend uuid;
  v_msg_challenge_rej uuid;

  v_count    int;
  v_inserted boolean;
  v_marked   int;
begin
  -- ── Setup: usuarios (el trigger handle_new_user crea el profile) ──
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         'chat-test-' || u.tag || '-' || u.id || '@futfinder.test', 'x', now(), now(), now(),
         '{}', '{}', '', '', '', ''
  from (values
    (v_alice, 'alice'), (v_bob, 'bob'), (v_carol, 'carol'), (v_dave, 'dave'), (v_ajeno, 'ajeno'),
    (v_organizador, 'organizador'), (v_att_ok, 'att-ok'), (v_att_pend, 'att-pend'), (v_att_cancel, 'att-cancel'),
    (v_club_member, 'club-member'),
    (v_admin_a, 'admin-a'), (v_admin_b, 'admin-b'), (v_admin_c, 'admin-c'), (v_admin_d, 'admin-d')
  ) as u(id, tag);

  -- ── Setup: amistades ────────────────────────────────────────
  insert into public.friendships (requester_id, addressee_id, status)
  values
    (v_alice, v_bob, 'accepted'),   -- caso 1
    (v_dave, v_alice, 'pending');   -- caso 3
  -- alice-carol: sin fila = "no amigo" (caso 2)

  -- ── Setup: partido + asistentes ─────────────────────────────
  insert into public.matches (
    id_organizador, titulo, region, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles
  ) values (
    v_organizador, 'Picadito test RLS', 'Metropolitana', 'Ñuñoa', 'Cancha test',
    -33.45, -70.60, now() + interval '1 day', 10, 10
  ) returning id into v_match1;

  -- El organizador ya queda 'inscrito' por el trigger de la migración 05.
  insert into public.attendees (id_partido, id_jugador, estado) values
    (v_match1, v_att_ok, 'inscrito'),
    (v_match1, v_att_pend, 'pendiente'),
    (v_match1, v_att_cancel, 'cancelado');
  -- v_ajeno no tiene fila en attendees.

  -- ── Setup: club con un miembro (para el caso "ajeno") ───────
  insert into public.clubs (nombre, slug, created_by)
  values ('Club RLS Test X', 'club-rls-test-x', v_club_member)
  returning id into v_club_x;

  insert into public.club_members (club_id, user_id, rol) values (v_club_x, v_club_member, 'admin');
  -- v_ajeno no es miembro de v_club_x.

  -- ── Setup: club A desafía a B (pendiente), C (aceptado) y D (rechazado)
  insert into public.clubs (nombre, slug, created_by) values ('Club RLS Test A', 'club-rls-test-a', v_admin_a) returning id into v_club_a;
  insert into public.clubs (nombre, slug, created_by) values ('Club RLS Test B', 'club-rls-test-b', v_admin_b) returning id into v_club_b;
  insert into public.clubs (nombre, slug, created_by) values ('Club RLS Test C', 'club-rls-test-c', v_admin_c) returning id into v_club_c;
  insert into public.clubs (nombre, slug, created_by) values ('Club RLS Test D', 'club-rls-test-d', v_admin_d) returning id into v_club_d;

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_admin_a, 'admin'),
    (v_club_b, v_admin_b, 'admin'),
    (v_club_c, v_admin_c, 'admin'),
    (v_club_d, v_admin_d, 'admin');

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_a, v_club_b, v_admin_a, 'pendiente');   -- caso 9a: todavía no da acceso

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_a, v_club_c, v_admin_a, 'aceptado');    -- caso 8: única excepción válida

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_a, v_club_d, v_admin_a, 'rechazado');   -- caso 9b: ya no da acceso

  -- ── Setup: mensajes insertados directo (bypass RLS: aún somos
  --    el rol dueño de la tabla, no "authenticated") ────────────
  insert into public.messages (sender_id, receiver_id, content) values (v_alice, v_bob, 'hola bob') returning id into v_msg_friend;
  insert into public.messages (sender_id, receiver_id, content) values (v_alice, v_carol, 'hola carol') returning id into v_msg_stranger;
  insert into public.messages (sender_id, receiver_id, content) values (v_dave, v_alice, 'hola alice') returning id into v_msg_pending;
  insert into public.messages (sender_id, match_id, content) values (v_att_ok, v_match1, 'vamos') returning id into v_msg_match_ok;
  insert into public.messages (sender_id, club_id, content) values (v_club_member, v_club_x, 'hola club') returning id into v_msg_club;
  insert into public.messages (sender_id, receiver_id, content) values (v_admin_a, v_admin_b, 'proponemos fecha') returning id into v_msg_challenge_pend;
  insert into public.messages (sender_id, receiver_id, content) values (v_admin_a, v_admin_c, 'coordinemos') returning id into v_msg_challenge_ok;
  insert into public.messages (sender_id, receiver_id, content) values (v_admin_a, v_admin_d, 'coordinemos rechazado') returning id into v_msg_challenge_rej;

  -- A partir de acá actuamos como distintos usuarios autenticados,
  -- igual que lo haría PostgREST, para que RLS se evalúe de verdad.

  -- ══ CASO 1: amigo (accepted) ══════════════════════════════════
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_alice, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where id = v_msg_friend;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 1): un amigo aceptado debería poder leer el DM';
  end if;

  begin
    insert into public.messages (sender_id, receiver_id, content) values (v_alice, v_bob, 'otro mensaje');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if not v_inserted then
    raise exception 'FALLÓ (caso 1): un amigo aceptado debería poder escribir el DM';
  end if;
  raise notice 'OK (caso 1): amigo aceptado lee y escribe el DM';

  -- ══ CASO 2: no amigo ══════════════════════════════════════════
  select count(*) into v_count from public.messages where id = v_msg_stranger;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 2): sin amistad, ni el propio remitente debería poder leer el DM';
  end if;

  begin
    insert into public.messages (sender_id, receiver_id, content) values (v_alice, v_carol, 'otro mensaje');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 2): sin amistad no debería poder escribir el DM';
  end if;
  raise notice 'OK (caso 2): usuario sin amistad no lee ni escribe el DM';

  -- ══ CASO 3: solicitud pendiente ═══════════════════════════════
  select count(*) into v_count from public.messages where id = v_msg_pending;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 3): una solicitud "pending" no debería habilitar la lectura del DM';
  end if;

  begin
    insert into public.messages (sender_id, receiver_id, content) values (v_alice, v_dave, 'otro mensaje');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 3): una solicitud "pending" no debería habilitar la escritura del DM';
  end if;
  raise notice 'OK (caso 3): solicitud de amistad pendiente no habilita el DM';

  -- ══ CASO 4: usuario ajeno (partido y club) ════════════════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where id = v_msg_match_ok;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 4): un ajeno al partido no debería poder leer su chat';
  end if;

  begin
    insert into public.messages (sender_id, match_id, content) values (v_ajeno, v_match1, 'me cuelo');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 4): un ajeno al partido no debería poder escribir en su chat';
  end if;

  select count(*) into v_count from public.messages where id = v_msg_club;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 4): un ajeno al club no debería poder leer su chat';
  end if;

  begin
    insert into public.messages (sender_id, club_id, content) values (v_ajeno, v_club_x, 'me cuelo');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 4): un ajeno al club no debería poder escribir en su chat';
  end if;
  raise notice 'OK (caso 4): usuario ajeno no lee ni escribe en chat de partido ni de club';

  -- ══ CASO 5: asistente autorizado (inscrito) ═══════════════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_att_ok, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where id = v_msg_match_ok;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 5): un asistente inscrito debería poder leer el chat del partido';
  end if;

  begin
    insert into public.messages (sender_id, match_id, content) values (v_att_ok, v_match1, 'dale que dale');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if not v_inserted then
    raise exception 'FALLÓ (caso 5): un asistente inscrito debería poder escribir en el chat del partido';
  end if;
  raise notice 'OK (caso 5): asistente inscrito lee y escribe en el chat del partido';

  -- ══ CASO 6: asistente pendiente (aprobación manual no aceptada) ═
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_att_pend, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where id = v_msg_match_ok;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): un asistente "pendiente" no debería poder leer el chat del partido';
  end if;

  begin
    insert into public.messages (sender_id, match_id, content) values (v_att_pend, v_match1, 'me colé');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 6): un asistente "pendiente" no debería poder escribir en el chat del partido';
  end if;
  raise notice 'OK (caso 6): asistente con solicitud pendiente no lee ni escribe en el chat del partido';

  -- ══ CASO 7: asistente cancelado ═══════════════════════════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_att_cancel, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where id = v_msg_match_ok;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 7): un asistente cancelado no debería poder leer el chat del partido';
  end if;

  begin
    insert into public.messages (sender_id, match_id, content) values (v_att_cancel, v_match1, 'me colé');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 7): un asistente cancelado no debería poder escribir en el chat del partido';
  end if;
  raise notice 'OK (caso 7): asistente cancelado no lee ni escribe en el chat del partido';

  -- ══ CASO 8: excepción de desafío de club ACEPTADO ═════════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_c, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where id = v_msg_challenge_ok;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 8): admins con un desafío "aceptado" deberían poder leer el DM aunque no sean amigos';
  end if;

  begin
    insert into public.messages (sender_id, receiver_id, content) values (v_admin_c, v_admin_a, 'dale, va la cancha tal');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if not v_inserted then
    raise exception 'FALLÓ (caso 8): admins con un desafío "aceptado" deberían poder escribirse por DM';
  end if;
  raise notice 'OK (caso 8): la excepción de desafío de club aceptado habilita el DM sin amistad';

  -- ══ CASO 9: desafío NO aceptado (pendiente o rechazado) NO da acceso ═
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);

  -- 9a: todavía 'pendiente' — no alcanza para el DM.
  select count(*) into v_count from public.messages where id = v_msg_challenge_pend;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 9a): un desafío "pendiente" no debería dar acceso al DM todavía';
  end if;

  begin
    insert into public.messages (sender_id, receiver_id, content) values (v_admin_a, v_admin_b, 'otra propuesta');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 9a): un desafío "pendiente" no debería habilitar el DM';
  end if;

  -- 9b: 'rechazado' — tampoco, ni siquiera para quien lo envió.
  select count(*) into v_count from public.messages where id = v_msg_challenge_rej;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 9b): un desafío "rechazado" no debería seguir dando acceso al DM, ni al que lo envió';
  end if;

  begin
    insert into public.messages (sender_id, receiver_id, content) values (v_admin_a, v_admin_d, 'seguimos hablando');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 9b): un desafío "rechazado" no debería habilitar nuevos mensajes por DM';
  end if;
  raise notice 'OK (caso 9): sólo "aceptado" da acceso — "pendiente" y "rechazado" quedan bloqueados';

  -- ══ CASO 10: marcador de lectura respeta las mismas reglas ═════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_bob, 'role', 'authenticated')::text);
  -- (puede haber más de un mensaje sin leer de alice → bob por el
  -- insert de prueba del caso 1, así que basta con que marque >= 1)
  select public.mark_thread_as_read(v_alice, null) into v_marked;
  if v_marked < 1 then
    raise exception 'FALLÓ (caso 10): mark_thread_as_read debería marcar como leído un DM entre amigos';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_carol, 'role', 'authenticated')::text);
  select public.mark_thread_as_read(v_alice, null) into v_marked;
  if v_marked <> 0 then
    raise exception 'FALLÓ (caso 10): mark_thread_as_read no debería marcar nada para un DM sin amistad vigente';
  end if;
  raise notice 'OK (caso 10): mark_thread_as_read respeta las mismas reglas de amistad/desafío';

  raise notice 'TODAS LAS PRUEBAS DE SEGURIDAD DEL CHAT PASARON';
end $$;

rollback;
