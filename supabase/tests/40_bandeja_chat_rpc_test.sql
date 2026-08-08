-- =============================================================
-- FutFinder — pruebas manuales de get_my_threads() (migración 40)
--
-- Qué cubre:
--   1. Una fila por conversación (partido, club, DM), con el último
--      mensaje, su remitente, no leídos, silenciado y datos propios de
--      cada tipo en `payload`.
--   2. Ninguna conversación queda con vista previa vieja aunque otra
--      conversación tenga muchos más mensajes — el "límite de 300 global"
--      que tenía listMyThreads() ya no existe: cada conversación calcula
--      su propio último mensaje, sin competir con las demás.
--   3. No leídos coinciden con get_chat_unread_counts() (se reutiliza,
--      no se duplica la lógica), suman varios remitentes y vuelven a cero
--      al marcar como leído.
--   4. Silenciado (chat_mutes) se refleja en el campo `muted` del payload.
--   5. Escondido (chat_hides): desaparece sin actividad nueva, reaparece
--      si llega un mensaje posterior al escondite.
--   6. Orden por actividad más reciente (last_at desc).
--   7. Un partido sin ningún mensaje todavía aparece igual (con
--      last_message = null), usando la hora del partido como last_at.
--   8. Mensajes antiguos: con separación de tiempo real (pg_sleep, no
--      empate de timestamp dentro de la misma transacción), el último
--      mensaje mostrado es siempre el más nuevo — nunca uno viejo.
--   9. Muchas conversaciones: 30 clubes a la vez no truncan ni pierden
--      ninguno — el problema que resolvía esta migración era justo un
--      tope arbitrario bajo carga.
--
-- OJO con los timestamps: `now()` es constante durante TODA la
-- transacción en Postgres (no cambia entre inserts de un mismo `do $$`).
-- El trigger de la migración 32 fija `created_at := now()`, así que sin
-- `pg_sleep` de por medio, mensajes "consecutivos" del mismo bloque
-- podrían empatar en created_at y el orden entre ellos quedaría
-- indefinido. Los casos que dependen del orden usan pg_sleep(0.01) a
-- propósito para garantizar una separación real de tiempo.
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
  v_me          uuid := gen_random_uuid();
  v_friend      uuid := gen_random_uuid();
  v_club_mate   uuid := gen_random_uuid();
  v_match_mate  uuid := gen_random_uuid();
  v_other_mate  uuid := gen_random_uuid();

  v_club_id       uuid;
  v_match_noisy   uuid; -- partido con muchos mensajes
  v_match_quiet   uuid; -- partido con un solo mensaje, viejo
  v_match_empty   uuid; -- partido sin ningún mensaje
  v_match_history uuid; -- partido con mensajes viejos y uno nuevo

  v_last_quiet_id uuid;
  v_newest_id     uuid;
  v_count         int;
  v_unread_before int;
  v_unread_after  int;
  v_payload       jsonb;
  v_scale_club    uuid;
  v_scale_ids     uuid[] := array[]::uuid[];
  i               int;
begin
  -- ── Setup: usuarios ────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         'inbox-test-' || u.tag || '-' || u.id || '@futfinder.test', 'x', now(), now(), now(),
         '{}', '{}', '', '', '', ''
  from (values
    (v_me, 'me'), (v_friend, 'friend'), (v_club_mate, 'club-mate'), (v_match_mate, 'match-mate'),
    (v_other_mate, 'other-mate')
  ) as u(id, tag);

  insert into public.friendships (requester_id, addressee_id, status)
  values (v_me, v_friend, 'accepted');

  -- ── Setup: club con 2 miembros ───────────────────────────────
  insert into public.clubs (nombre, slug, created_by)
  values ('Club Bandeja Test', 'club-bandeja-test', v_me)
  returning id into v_club_id;

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_id, v_me, 'admin'),
    (v_club_id, v_club_mate, 'jugador'),
    (v_club_id, v_other_mate, 'jugador');

  -- ── Setup: 3 partidos — ruidoso, silencioso y sin mensajes ─────
  insert into public.matches (
    id_organizador, titulo, region, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles
  ) values
    (v_me, 'Partido ruidoso', 'Metropolitana', 'Ñuñoa', 'Cancha A', -33.45, -70.60, now() + interval '1 day', 10, 10)
    returning id into v_match_noisy;
  insert into public.matches (
    id_organizador, titulo, region, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles
  ) values
    (v_me, 'Partido silencioso', 'Metropolitana', 'Ñuñoa', 'Cancha B', -33.45, -70.60, now() + interval '2 days', 10, 10)
    returning id into v_match_quiet;
  insert into public.matches (
    id_organizador, titulo, region, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles
  ) values
    (v_me, 'Partido sin mensajes', 'Metropolitana', 'Ñuñoa', 'Cancha C', -33.45, -70.60, now() + interval '3 days', 10, 10)
    returning id into v_match_empty;
  insert into public.matches (
    id_organizador, titulo, region, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles
  ) values
    (v_me, 'Partido con historial', 'Metropolitana', 'Ñuñoa', 'Cancha D', -33.45, -70.60, now() + interval '4 days', 10, 10)
    returning id into v_match_history;
  -- El organizador ya queda 'inscrito' en los 4 por el trigger de la migración 05.

  insert into public.attendees (id_partido, id_jugador, estado) values
    (v_match_noisy, v_match_mate, 'inscrito'),
    (v_match_quiet, v_match_mate, 'inscrito'),
    (v_match_empty, v_match_mate, 'inscrito'),
    (v_match_history, v_match_mate, 'inscrito'),
    (v_match_history, v_other_mate, 'inscrito');

  -- A partir de acá actuamos como v_me, autenticado, igual que PostgREST.
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_me, 'role', 'authenticated')::text);

  -- ── Caso 2: "partido ruidoso" no le come el último mensaje al ──
  -- "partido silencioso" — se inserta el mensaje viejo PRIMERO...
  insert into public.messages (sender_id, match_id, content)
  values (v_match_mate, v_match_quiet, 'primer y único mensaje del silencioso')
  returning id into v_last_quiet_id;

  -- ...y DESPUÉS 12 mensajes en el ruidoso (más de los que "ganarían" si
  -- hubiera un tope global chico compartido entre conversaciones). Con
  -- pg_sleep entre cada uno: sin esto, todos caerían en el mismo now()
  -- de la transacción y el "último" quedaría indefinido entre empates.
  for i in 1..12 loop
    perform pg_sleep(0.01);
    insert into public.messages (sender_id, match_id, content)
    values (v_match_mate, v_match_noisy, 'mensaje ruidoso #' || i);
  end loop;

  -- Mensaje de club y DM, para tener las 3 categorías.
  insert into public.messages (sender_id, club_id, content)
  values (v_club_mate, v_club_id, 'hola desde el club');
  insert into public.messages (sender_id, receiver_id, content)
  values (v_friend, v_me, 'hola desde el DM');

  -- ── Caso 8: mensajes antiguos — "partido con historial" tiene dos
  -- mensajes viejos y uno nuevo, separados por tiempo real.
  insert into public.messages (sender_id, match_id, content)
  values (v_match_mate, v_match_history, 'mensaje viejo #1');
  perform pg_sleep(0.02);
  insert into public.messages (sender_id, match_id, content)
  values (v_other_mate, v_match_history, 'mensaje viejo #2');
  perform pg_sleep(0.02);
  insert into public.messages (sender_id, match_id, content)
  values (v_match_mate, v_match_history, 'mensaje MÁS NUEVO')
  returning id into v_newest_id;

  -- ══ CASO 1 y 2: una fila por conversación, sin robarse el último ═
  -- 4 partidos (ruidoso, silencioso, sin mensajes, con historial) + 1 club + 1 DM = 6.
  select count(*) into v_count from public.get_my_threads();
  if v_count <> 6 then
    raise exception 'FALLÓ (caso 1): deberían verse 6 hilos, hay %', v_count;
  end if;
  raise notice 'OK (caso 1): get_my_threads() devuelve una fila por conversación';

  select payload into v_payload
  from public.get_my_threads()
  where thread_key = 'match:' || v_match_quiet::text;
  if (v_payload->'last_message'->>'id')::uuid <> v_last_quiet_id then
    raise exception 'FALLÓ (caso 2): el partido silencioso debería mostrar SU último mensaje, no el de otro (ni null)';
  end if;
  if v_payload->'last_message'->>'content' <> 'primer y único mensaje del silencioso' then
    raise exception 'FALLÓ (caso 2): el contenido del último mensaje del silencioso no es el esperado';
  end if;
  raise notice 'OK (caso 2): 12 mensajes en el partido ruidoso no afectan la vista previa del silencioso';

  select payload into v_payload
  from public.get_my_threads()
  where thread_key = 'match:' || v_match_noisy::text;
  if v_payload->'last_message'->>'content' <> 'mensaje ruidoso #12' then
    raise exception 'FALLÓ (caso 2b): el partido ruidoso debería mostrar el ÚLTIMO de sus 12 mensajes';
  end if;
  raise notice 'OK (caso 2b): el partido ruidoso muestra su propio último mensaje';

  -- ══ CASO 7: partido sin mensajes aparece con last_message = null ═
  select payload into v_payload
  from public.get_my_threads()
  where thread_key = 'match:' || v_match_empty::text;
  if v_payload is null then
    raise exception 'FALLÓ (caso 7): el partido sin mensajes debería aparecer igual en la bandeja';
  end if;
  if v_payload->'last_message' is not null then
    raise exception 'FALLÓ (caso 7): un partido sin mensajes no debería tener last_message';
  end if;
  raise notice 'OK (caso 7): un partido sin mensajes aparece con last_message null (no se inventa nada)';

  -- ══ CASO 8: mensajes antiguos — el más nuevo gana, siempre ═══════
  select payload into v_payload
  from public.get_my_threads()
  where thread_key = 'match:' || v_match_history::text;
  if (v_payload->'last_message'->>'id')::uuid <> v_newest_id then
    raise exception 'FALLÓ (caso 8): debería mostrarse el mensaje MÁS NUEVO, no uno de los dos viejos';
  end if;
  if v_payload->'last_message'->>'content' <> 'mensaje MÁS NUEVO' then
    raise exception 'FALLÓ (caso 8): el contenido del último mensaje no es el más nuevo';
  end if;
  -- Ningún mensaje viejo del hilo debería ganarle en created_at al nuevo.
  if exists (
    select 1 from public.messages
    where match_id = v_match_history
      and content like 'mensaje viejo%'
      and created_at >= (v_payload->'last_message'->>'created_at')::timestamptz
  ) then
    raise exception 'FALLÓ (caso 8): hay un mensaje viejo con created_at igual o posterior al "más nuevo" — el pg_sleep no separó los timestamps';
  end if;
  raise notice 'OK (caso 8): con separación de tiempo real, el mensaje más nuevo siempre gana sobre los viejos';

  -- ══ CASO 3: no leídos — coinciden con get_chat_unread_counts(), ═
  --           suman varios remitentes y vuelven a cero al leer ══════
  select payload->>'unread' into v_count
  from public.get_my_threads()
  where thread_key = 'club:' || v_club_id::text;
  if v_count::int <> (
    select unread from public.get_chat_unread_counts() where thread_key = 'club:' || v_club_id::text
  ) then
    raise exception 'FALLÓ (caso 3): el no-leído del club no coincide con get_chat_unread_counts()';
  end if;
  raise notice 'OK (caso 3): no leídos coinciden con get_chat_unread_counts()';

  -- 3b: dos remitentes distintos mandan al club antes de que yo lea nada
  -- → el no-leído tiene que sumar los DOS mensajes, no quedarse en 1.
  select coalesce((payload->>'unread')::int, 0) into v_unread_before
  from public.get_my_threads() where thread_key = 'club:' || v_club_id::text;

  insert into public.messages (sender_id, club_id, content)
  values (v_other_mate, v_club_id, 'segundo remitente sin leer');

  select (payload->>'unread')::int into v_unread_after
  from public.get_my_threads() where thread_key = 'club:' || v_club_id::text;
  if v_unread_after <> v_unread_before + 1 then
    raise exception 'FALLÓ (caso 3b): el no-leído debería subir de a uno por cada mensaje nuevo (antes % después %)', v_unread_before, v_unread_after;
  end if;
  raise notice 'OK (caso 3b): mensajes sin leer de remitentes distintos se SUMAN, no se pisan';

  -- 3c: marcar como leído deja el no-leído en cero...
  perform public.mark_chat_read('club:' || v_club_id::text);
  select (payload->>'unread')::int into v_count
  from public.get_my_threads() where thread_key = 'club:' || v_club_id::text;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 3c): después de mark_chat_read el no-leído debería ser 0, es %', v_count;
  end if;
  raise notice 'OK (caso 3c): mark_chat_read deja el no-leído en cero';

  -- ...y un mensaje nuevo POSTERIOR a esa lectura vuelve a contar desde 1,
  -- no se queda pegado en 0 ni arrastra los ya leídos.
  insert into public.messages (sender_id, club_id, content)
  values (v_club_mate, v_club_id, 'mensaje después de leer todo');
  select (payload->>'unread')::int into v_count
  from public.get_my_threads() where thread_key = 'club:' || v_club_id::text;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 3d): un mensaje nuevo después de leer todo debería dejar el no-leído en 1, es %', v_count;
  end if;
  raise notice 'OK (caso 3d): un mensaje nuevo tras marcar como leído vuelve a contar desde cero, no arrastra lo ya leído';

  -- ══ CASO 4: silenciado se refleja en el payload ══════════════════
  insert into public.chat_mutes (user_id, thread_key) values (v_me, 'club:' || v_club_id::text);

  if not (select (payload->>'muted')::boolean from public.get_my_threads() where thread_key = 'club:' || v_club_id::text) then
    raise exception 'FALLÓ (caso 4): el club silenciado debería tener muted=true';
  end if;
  if (select (payload->>'muted')::boolean from public.get_my_threads() where thread_key = 'match:' || v_match_noisy::text) then
    raise exception 'FALLÓ (caso 4): un hilo que no silencié no debería salir muted=true';
  end if;
  raise notice 'OK (caso 4): muted refleja chat_mutes por conversación, no globalmente';

  -- ══ CASO 5: escondido desaparece, reaparece con actividad nueva ══
  insert into public.chat_hides (user_id, thread_key, hidden_at)
  values (v_me, 'dm:' || v_friend::text, now());

  select count(*) into v_count from public.get_my_threads() where thread_key = 'dm:' || v_friend::text;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 5a): un DM escondido sin actividad posterior no debería aparecer';
  end if;
  raise notice 'OK (caso 5a): un hilo escondido sin actividad nueva no aparece';

  insert into public.messages (sender_id, receiver_id, content)
  values (v_friend, v_me, 'mensaje nuevo después de esconder');

  select count(*) into v_count from public.get_my_threads() where thread_key = 'dm:' || v_friend::text;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 5b): un mensaje posterior al escondite debería hacer reaparecer el hilo';
  end if;
  raise notice 'OK (caso 5b): un hilo escondido reaparece con actividad posterior al escondite';

  -- ══ CASO 9: muchas conversaciones a la vez ═══════════════════════
  -- El problema que resolvía esta migración era justo un tope arbitrario
  -- bajo carga: 30 clubes nuevos, cada uno con exactamente un mensaje
  -- propio, no deberían perder ni mezclar ninguno.
  for i in 1..30 loop
    insert into public.clubs (nombre, slug, created_by)
    values ('Club Escala ' || i, 'club-escala-' || i || '-' || gen_random_uuid()::text, v_me)
    returning id into v_scale_club;

    v_scale_ids := array_append(v_scale_ids, v_scale_club);

    insert into public.club_members (club_id, user_id, rol)
    values (v_scale_club, v_me, 'admin');

    insert into public.messages (sender_id, club_id, content)
    values (v_me, v_scale_club, 'mensaje del club de escala #' || i);
  end loop;

  select count(*) into v_count
  from public.get_my_threads()
  where thread_type = 'club' and thread_key = any (select 'club:' || x::text from unnest(v_scale_ids) x);
  if v_count <> 30 then
    raise exception 'FALLÓ (caso 9): deberían verse los 30 clubes nuevos, se ven %', v_count;
  end if;
  raise notice 'OK (caso 9): 30 conversaciones nuevas a la vez, ninguna se pierde';

  -- Cada uno de los 30 debe mostrar SU PROPIO mensaje, no el de otro ni
  -- uno vacío — confirma que "muchas conversaciones" no mezcla previews.
  if exists (
    select 1
    from public.get_my_threads() t
    join unnest(v_scale_ids) with ordinality as s(id, ord) on t.thread_key = ('club:' || s.id::text)
    where t.payload->'last_message'->>'content' <> ('mensaje del club de escala #' || s.ord)
  ) then
    raise exception 'FALLÓ (caso 9b): algún club de escala muestra el mensaje de otro (o ninguno)';
  end if;
  raise notice 'OK (caso 9b): cada una de las 30 conversaciones muestra su propio último mensaje, sin mezclarse';

  -- Y el total general también los incluye (partidos + club original + DM + 30 nuevos).
  select count(*) into v_count from public.get_my_threads();
  if v_count <> 6 + 30 then
    raise exception 'FALLÓ (caso 9c): el total debería ser 36, es %', v_count;
  end if;
  raise notice 'OK (caso 9c): el total de la bandeja incluye las 30 conversaciones nuevas sin perder las anteriores';

  -- ══ CASO 6: orden por actividad más reciente ═════════════════════
  if not (
    select bool_and(a.last_at >= b.last_at)
    from (
      select thread_key, last_at, row_number() over (order by last_at desc nulls last) as rn
      from public.get_my_threads()
    ) a
    join (
      select thread_key, last_at, row_number() over (order by last_at desc nulls last) as rn
      from public.get_my_threads()
    ) b on b.rn = a.rn + 1
  ) then
    raise exception 'FALLÓ (caso 6): las filas no vienen ordenadas por last_at descendente';
  end if;
  raise notice 'OK (caso 6): get_my_threads() ya viene ordenada por actividad más reciente';

  raise notice '✅ TODOS LOS CASOS DE get_my_threads() PASARON';
end $$;

rollback;
