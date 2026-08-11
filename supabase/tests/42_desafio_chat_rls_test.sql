-- =============================================================
-- FutFinder — pruebas del chat grupal de desafío (migración 42)
--
-- Qué cubre:
--   1. Solo un administrador del club RETADO puede aceptar. Un jugador
--      sin rol de ese club, y un administrador del club retador, no.
--   2. Aceptar mueve el desafío a 'negociacion', abre el plazo con la
--      hora del servidor, deja UN evento, UN mensaje de sistema y avisa
--      a los administradores de ambos clubes menos a quien aceptó.
--   3. Idempotencia: aceptar dos veces no duplica nada.
--   4. Los administradores de LOS DOS clubes leen y escriben en el hilo.
--   5. Un jugador sin rol de cualquiera de los dos clubes no lee ni
--      escribe. Un tercero ajeno tampoco.
--   6. Degradar a un administrador a jugador le quita el acceso de
--      inmediato, sin tocar ninguna lista de participantes.
--   7. El hilo aparece en get_chat_unread_counts() y en
--      get_my_threads() con los dos clubes en el payload, y
--      `abierto_alguna_vez` pasa a true al marcarlo leído.
--   8. Un desafío cerrado deja el hilo LEGIBLE pero MUDO (archivado).
--   9. El hilo de desafío no se mezcla con el DM que esos mismos dos
--      administradores puedan tener: son dos conversaciones distintas.
--
-- Requisito: la migración 42 tiene que estar aplicada.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado. Si algún caso falla, la
-- ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  -- Club A (retador): dos administradores y un jugador sin rol.
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_ap uuid := gen_random_uuid();
  -- Club B (retado): dos administradores y un jugador sin rol.
  v_b1 uuid := gen_random_uuid();
  v_b2 uuid := gen_random_uuid();
  v_bp uuid := gen_random_uuid();
  -- Ajeno a todo.
  v_x  uuid := gen_random_uuid();

  v_club_a uuid;
  v_club_b uuid;
  v_ch     uuid;
  v_thread text;

  v_count    int;
  v_estado   text;
  v_vence    timestamptz;
  v_inserted boolean;
  v_ok       boolean;
  v_payload  jsonb;
  v_msg_sys  uuid;
begin
  -- ── Setup: usuarios ──────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         'desafio-chat-' || u.tag || '-' || u.id || '@futfinder.test', 'x', now(), now(), now(),
         '{}', '{}', '', '', '', ''
  from (values
    (v_a1, 'a1'), (v_a2, 'a2'), (v_ap, 'ap'),
    (v_b1, 'b1'), (v_b2, 'b2'), (v_bp, 'bp'),
    (v_x, 'x')
  ) as u(id, tag);

  -- ── Setup: clubes y membresías ───────────────────────────────
  -- Plan premium a propósito: `check_club_limits()` permite 1 solo
  -- administrador en el plan estándar y 3 en premium. Con un admin por
  -- club no se podría probar lo que de verdad importa acá — que el hilo
  -- es GRUPAL y alcanza a TODOS los administradores de ambos clubes.
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Desafio Test A', 'club-desafio-test-a', v_a1, 'premium')
  returning id into v_club_a;

  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Desafio Test B', 'club-desafio-test-b', v_b1, 'premium')
  returning id into v_club_b;

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_a1, 'admin'),
    (v_club_a, v_a2, 'admin'),
    (v_club_a, v_ap, 'jugador'),
    (v_club_b, v_b1, 'admin'),
    (v_club_b, v_b2, 'admin'),
    (v_club_b, v_bp, 'jugador');

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_a, v_club_b, v_a1, 'pendiente')
  returning id into v_ch;

  v_thread := 'challenge:' || v_ch::text;

  -- La clave del hilo tiene que caber en chat_reads.thread_key.
  if length(v_thread) < 3 or length(v_thread) > 120 then
    raise exception 'FALLÓ (caso 0): la clave del hilo no cabe en chat_reads (% caracteres)',
      length(v_thread);
  end if;
  raise notice 'OK (caso 0): la clave del hilo cabe en chat_reads';

  -- ══ CASO 1: un jugador sin rol del club retado no acepta ═════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_bp, 'role', 'authenticated')::text);

  begin
    perform public.aceptar_desafio(v_ch);
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 1): un jugador sin rol no debería poder aceptar el desafío';
  end if;
  raise notice 'OK (caso 1): un jugador sin rol no acepta el desafío';

  -- ══ CASO 2: el club retador no acepta su propio desafío ══════
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a1, 'role', 'authenticated')::text);

  begin
    perform public.aceptar_desafio(v_ch);
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 2): el club retador no debería poder aceptar su propio desafío';
  end if;
  raise notice 'OK (caso 2): el club retador no acepta su propio desafío';

  -- ══ CASO 3: un administrador del retado acepta ═══════════════
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_b1, 'role', 'authenticated')::text);

  perform public.aceptar_desafio(v_ch);

  execute 'reset role';

  select estado, negociacion_vence_at into v_estado, v_vence
  from public.club_challenges where id = v_ch;

  if v_estado <> 'negociacion' then
    raise exception 'FALLÓ (caso 3): el estado debería ser negociacion y es %', v_estado;
  end if;
  if v_vence is null
     or v_vence <= now() + interval '71 hours'
     or v_vence >= now() + interval '73 hours' then
    raise exception 'FALLÓ (caso 3): el plazo de negociación no quedó en 72 h (%)', v_vence;
  end if;

  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch and tipo = 'aceptado';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 3): debería haber 1 evento "aceptado" y hay %', v_count;
  end if;

  select count(*) into v_count from public.messages where challenge_id = v_ch;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 3): debería haber 1 mensaje de sistema y hay %', v_count;
  end if;
  select id into v_msg_sys from public.messages where challenge_id = v_ch;

  -- Avisos: A1, A2 y B2. NO el propio B1.
  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_accepted'
    and (data->>'challengeId')::uuid = v_ch;
  if v_count <> 3 then
    raise exception 'FALLÓ (caso 3): deberían ser 3 avisos (A1, A2, B2) y son %', v_count;
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_accepted'
    and (data->>'challengeId')::uuid = v_ch
    and user_id = v_b1;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 3): quien acepta no debería recibir su propio aviso';
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_accepted'
    and (data->>'challengeId')::uuid = v_ch
    and data->>'threadKey' = v_thread;
  if v_count <> 3 then
    raise exception 'FALLÓ (caso 3): los 3 avisos deberían traer threadKey y traen %', v_count;
  end if;
  raise notice 'OK (caso 3): aceptar abre la negociación, el evento, el mensaje y los avisos';

  -- ══ CASO 4: idempotencia ═════════════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_b1, 'role', 'authenticated')::text);

  perform public.aceptar_desafio(v_ch);

  execute 'reset role';

  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch and tipo = 'aceptado';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 4): aceptar dos veces duplicó el evento (%)', v_count;
  end if;
  select count(*) into v_count from public.messages where challenge_id = v_ch;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 4): aceptar dos veces duplicó el mensaje de sistema (%)', v_count;
  end if;
  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_accepted' and (data->>'challengeId')::uuid = v_ch;
  if v_count <> 3 then
    raise exception 'FALLÓ (caso 4): aceptar dos veces duplicó los avisos (%)', v_count;
  end if;
  raise notice 'OK (caso 4): aceptar dos veces deja una sola transición';

  -- ══ CASO 5: los admins de los dos clubes leen y escriben ═════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a1, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where challenge_id = v_ch;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 5): un admin del club retador debería leer el hilo';
  end if;

  begin
    insert into public.messages (sender_id, challenge_id, content)
    values (v_a1, v_ch, 'Proponemos el sábado a las 18:00');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if not v_inserted then
    raise exception 'FALLÓ (caso 5): un admin del club retador debería escribir en el hilo';
  end if;

  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_b2, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where challenge_id = v_ch;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 5): el segundo admin del retado debería ver los 2 mensajes, ve %', v_count;
  end if;

  begin
    insert into public.messages (sender_id, challenge_id, content)
    values (v_b2, v_ch, 'El sábado nos sirve');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if not v_inserted then
    raise exception 'FALLÓ (caso 5): el segundo admin del retado debería escribir en el hilo';
  end if;
  raise notice 'OK (caso 5): los administradores de ambos clubes leen y escriben';

  -- ══ CASO 6: jugadores sin rol y ajenos quedan fuera ══════════
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_ap, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where challenge_id = v_ch;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): un jugador sin rol del club retador no debería leer el hilo';
  end if;
  begin
    insert into public.messages (sender_id, challenge_id, content) values (v_ap, v_ch, 'yo opino');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 6): un jugador sin rol no debería escribir en el hilo';
  end if;

  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_bp, 'role', 'authenticated')::text);
  select count(*) into v_count from public.messages where challenge_id = v_ch;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): un jugador sin rol del club retado no debería leer el hilo';
  end if;

  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_x, 'role', 'authenticated')::text);
  select count(*) into v_count from public.messages where challenge_id = v_ch;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): un tercero ajeno no debería leer el hilo';
  end if;

  select count(*) into v_count from public.club_challenge_events where challenge_id = v_ch;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): un tercero ajeno no debería leer la bitácora';
  end if;
  raise notice 'OK (caso 6): jugadores sin rol y terceros quedan fuera del hilo';

  -- ══ CASO 7: degradar a un admin le quita el acceso ═══════════
  execute 'reset role';
  update public.club_members set rol = 'jugador'
   where club_id = v_club_a and user_id = v_a2;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a2, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where challenge_id = v_ch;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 7): un admin degradado a jugador no debería seguir leyendo el hilo';
  end if;
  begin
    insert into public.messages (sender_id, challenge_id, content) values (v_a2, v_ch, 'sigo aquí');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 7): un admin degradado no debería seguir escribiendo';
  end if;
  raise notice 'OK (caso 7): degradar a un admin le quita el acceso en la siguiente consulta';

  -- ══ CASO 8: bandeja y no leídos ══════════════════════════════
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a1, 'role', 'authenticated')::text);

  -- A1 escribió uno de los tres mensajes; los otros dos son ajenos.
  select unread into v_count
  from public.get_chat_unread_counts() where thread_key = v_thread;
  if coalesce(v_count, 0) <> 2 then
    raise exception 'FALLÓ (caso 8): A1 debería tener 2 no leídos en el hilo y tiene %',
      coalesce(v_count, 0);
  end if;

  select payload into v_payload
  from public.get_my_threads() where thread_key = v_thread;
  if v_payload is null then
    raise exception 'FALLÓ (caso 8): el hilo de desafío no aparece en la bandeja';
  end if;
  if v_payload->'club_retador'->>'nombre' <> 'Club Desafio Test A'
     or v_payload->'club_retado'->>'nombre' <> 'Club Desafio Test B' then
    raise exception 'FALLÓ (caso 8): el payload no trae los dos clubes (%)', v_payload;
  end if;
  if (v_payload->>'estado') <> 'negociacion' then
    raise exception 'FALLÓ (caso 8): el payload no trae el estado correcto (%)', v_payload->>'estado';
  end if;
  if (v_payload->>'vence_at') is null then
    raise exception 'FALLÓ (caso 8): el payload no trae vence_at';
  end if;
  if (v_payload->>'abierto_alguna_vez')::boolean then
    raise exception 'FALLÓ (caso 8): sin abrirlo nunca, abierto_alguna_vez debería ser false';
  end if;
  if (v_payload->>'mi_club_id')::uuid <> v_club_a then
    raise exception 'FALLÓ (caso 8): mi_club_id debería ser el club del administrador';
  end if;

  perform public.mark_chat_read(v_thread);

  select payload into v_payload
  from public.get_my_threads() where thread_key = v_thread;
  if not (v_payload->>'abierto_alguna_vez')::boolean then
    raise exception 'FALLÓ (caso 8): tras abrirlo, abierto_alguna_vez debería ser true';
  end if;
  if (v_payload->>'unread')::int <> 0 then
    raise exception 'FALLÓ (caso 8): tras marcarlo leído no debería quedar ningún no leído';
  end if;
  raise notice 'OK (caso 8): el hilo aparece en la bandeja, cuenta no leídos y se apaga al abrirlo';

  -- ══ CASO 9: el DM sigue siendo otra conversación ═════════════
  -- A1 y B1 son administradores con un desafío en curso, pero eso ya no
  -- les abre un DM: `chat_valid_club_challenge_dm()` solo mira el estado
  -- legado 'aceptado', y este desafío está en 'negociacion'.
  begin
    insert into public.messages (sender_id, receiver_id, content)
    values (v_a1, v_b1, 'te escribo por privado');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 9): el hilo de desafío no debería abrir además un DM entre los admins';
  end if;

  select count(*) into v_count
  from public.get_my_threads() where thread_type = 'dm';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 9): los mensajes del desafío no deberían generar un hilo DM fantasma (%)', v_count;
  end if;
  raise notice 'OK (caso 9): el hilo de desafío no se mezcla con los mensajes privados';

  -- ══ CASO 10: desafío cerrado = archivo en solo lectura ═══════
  execute 'reset role';
  update public.club_challenges set estado = 'cancelado' where id = v_ch;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a1, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where challenge_id = v_ch;
  if v_count <> 3 then
    raise exception 'FALLÓ (caso 10): un desafío cerrado debería conservar su historial legible, se ven %', v_count;
  end if;

  begin
    insert into public.messages (sender_id, challenge_id, content)
    values (v_a1, v_ch, 'un mensaje más');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 10): un desafío cerrado no debería aceptar mensajes nuevos';
  end if;
  raise notice 'OK (caso 10): el desafío cerrado queda archivado en solo lectura';

  -- ══ CASO 11: el destino de un mensaje es inmutable ═══════════
  execute 'reset role';
  begin
    update public.messages set challenge_id = null where id = v_msg_sys;
    v_inserted := true;
  exception when others then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 11): challenge_id debería ser inmutable tras el insert';
  end if;
  raise notice 'OK (caso 11): challenge_id es inmutable tras el insert';

  raise notice '=== TODAS LAS PRUEBAS DE LA MIGRACIÓN 42 PASARON ===';
end $$;

rollback;
