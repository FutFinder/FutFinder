-- =============================================================
-- FutFinder — pruebas de plazos y propuesta oficial (migración 43)
--
-- Qué cubre:
--   1. Un desafío pendiente de más de 7 días pasa a 'expirado' y solo
--      se avisa al club retador.
--   2. IDEMPOTENCIA del barrido: correr
--      `procesar_vencimientos_desafios()` dos veces seguidas no produce
--      un segundo evento ni un segundo aviso.
--   3. La negociación vencida abre una prórroga de 24 h y pregunta a
--      los administradores de los dos clubes.
--   4. `refrescar_desafio()` la puede llamar cualquier integrante de
--      los dos clubes, y nadie más.
--   5. Prórroga: la primera respuesta del club es la que vale (dos
--      administradores del mismo club dejan UNA fila), dos «Sí»
--      reabren la negociación y un «No» la cierra en el acto.
--   6. Vencida la prórroga sin respuestas, el desafío queda
--      'sin_acuerdo' y el hilo queda LEGIBLE pero MUDO.
--   7. Propuesta oficial: la crea un administrador, el mismo
--      `client_token` no crea una segunda, un jugador sin rol no puede
--      crearla pero SÍ puede leerla, y el índice parcial impide que
--      haya dos propuestas pendientes en el mismo desafío.
--   8. Solo el club CONTRARIO al proponente puede rechazar, el desafío
--      vuelve a 'negociacion' y rechazar dos veces no rompe nada.
--
-- Requisito: las migraciones 42 y 43 tienen que estar aplicadas.
--
-- EL TIEMPO NO SE CONGELA: para provocar un vencimiento se mueven las
-- fechas de la fila hacia atrás, nunca el reloj. Así lo que se prueba
-- es exactamente la comparación contra `now()` que hace el servidor.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado. Si algún caso falla, la
-- ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  -- Clubes A y B: expiración, prórroga y cierre sin acuerdo.
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_ap uuid := gen_random_uuid();
  v_b1 uuid := gen_random_uuid();
  v_b2 uuid := gen_random_uuid();
  -- Clubes C y D: propuesta oficial.
  v_c1 uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_cp uuid := gen_random_uuid();
  v_d1 uuid := gen_random_uuid();
  v_d2 uuid := gen_random_uuid();
  -- Ajeno a todo.
  v_x  uuid := gen_random_uuid();

  v_club_a uuid;
  v_club_b uuid;
  v_club_c uuid;
  v_club_d uuid;

  v_ch1  uuid;   -- pendiente que expira
  v_ch2  uuid;   -- negociación → prórroga → sin acuerdo
  v_ch3  uuid;   -- propuesta oficial
  v_prop uuid;

  v_token uuid := gen_random_uuid();

  v_count   int;
  v_count2  int;
  v_estado  text;
  v_vence   timestamptz;
  v_abierta timestamptz;
  v_ok      boolean;
  v_n       int;
  v_prop_a  public.club_challenge_proposals;
  v_prop_b  public.club_challenge_proposals;
begin
  -- ── Setup: usuarios ──────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         'desafio-plazos-' || u.tag || '-' || u.id || '@futfinder.test', 'x', now(), now(), now(),
         '{}', '{}', '', '', '', ''
  from (values
    (v_a1, 'a1'), (v_a2, 'a2'), (v_ap, 'ap'),
    (v_b1, 'b1'), (v_b2, 'b2'),
    (v_c1, 'c1'), (v_c2, 'c2'), (v_cp, 'cp'),
    (v_d1, 'd1'), (v_d2, 'd2'),
    (v_x, 'x')
  ) as u(id, tag);

  -- Plan premium: `check_club_limits()` solo deja 1 administrador en el
  -- plan estándar, y acá hace falta probar que la respuesta de UN
  -- administrador vale por todo su club.
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Plazos A', 'club-plazos-a', v_a1, 'premium') returning id into v_club_a;
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Plazos B', 'club-plazos-b', v_b1, 'premium') returning id into v_club_b;
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Plazos C', 'club-plazos-c', v_c1, 'premium') returning id into v_club_c;
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Plazos D', 'club-plazos-d', v_d1, 'premium') returning id into v_club_d;

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_a1, 'admin'), (v_club_a, v_a2, 'admin'), (v_club_a, v_ap, 'jugador'),
    (v_club_b, v_b1, 'admin'), (v_club_b, v_b2, 'admin'),
    (v_club_c, v_c1, 'admin'), (v_club_c, v_c2, 'admin'), (v_club_c, v_cp, 'jugador'),
    (v_club_d, v_d1, 'admin'), (v_club_d, v_d2, 'admin');

  -- ══ CASO 1: pendiente de más de 7 días → expirado ════════════
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_a, v_club_b, v_a1, 'pendiente')
  returning id into v_ch1;

  -- Se envejece la fila, no el reloj.
  update public.club_challenges
     set created_at = now() - interval '8 days'
   where id = v_ch1;

  v_n := public.procesar_vencimientos_desafios();

  select estado into v_estado from public.club_challenges where id = v_ch1;
  if v_estado <> 'expirado' then
    raise exception 'FALLÓ (caso 1): el desafío debería estar expirado y está %', v_estado;
  end if;

  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch1 and tipo = 'expirado';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 1): debería haber 1 evento "expirado" y hay %', v_count;
  end if;

  -- Solo el club retador: A1 y A2. Nadie de B.
  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_closed' and (data ->> 'challengeId')::uuid = v_ch1;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 1): debería haber 2 avisos de cierre (A1, A2) y hay %', v_count;
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_closed'
    and (data ->> 'challengeId')::uuid = v_ch1
    and user_id in (v_b1, v_b2);
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 1): el club retado no debería recibir aviso de expiración';
  end if;

  -- Un desafío que nunca se aceptó no tiene hilo: sin threadKey.
  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_closed'
    and (data ->> 'challengeId')::uuid = v_ch1
    and data ? 'threadKey';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 1): un desafío sin hilo no debería mandar threadKey';
  end if;
  raise notice 'OK (caso 1): el pendiente de 8 días expiró y solo se avisó al retador';

  -- ══ CASO 2: el barrido es idempotente ════════════════════════
  v_n := public.procesar_vencimientos_desafios();

  -- El conteo de avisos se filtra por tipo a propósito: el trigger
  -- antiguo `notify_club_challenge` ya avisó al club retado cuando se
  -- creó el desafío, y esos avisos también llevan `challengeId`. Lo que
  -- esta prueba mide es que el BARRIDO no vuelva a avisar.
  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch1;
  select count(*) into v_count2
  from public.notifications
  where type = 'club_challenge_closed' and (data ->> 'challengeId')::uuid = v_ch1;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 2): la segunda pasada dejó % eventos en vez de 1', v_count;
  end if;
  if v_count2 <> 2 then
    raise exception 'FALLÓ (caso 2): la segunda pasada dejó % avisos en vez de 2', v_count2;
  end if;
  raise notice 'OK (caso 2): la segunda pasada del barrido no repite nada';

  -- ══ CASO 3: negociación vencida → prórroga de 24 h ═══════════
  -- B reta a A (el índice de pendientes es direccional y el desafío
  -- anterior era A → B).
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_b, v_club_a, v_b1, 'pendiente')
  returning id into v_ch2;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a1, 'role', 'authenticated')::text);
  perform public.aceptar_desafio(v_ch2);
  execute 'reset role';

  update public.club_challenges
     set negociacion_vence_at = now() - interval '1 minute'
   where id = v_ch2;

  v_n := public.procesar_vencimientos_desafios();

  select estado, prorroga_vence_at into v_estado, v_vence
  from public.club_challenges where id = v_ch2;

  if v_estado <> 'negociacion' then
    raise exception 'FALLÓ (caso 3): abrir la prórroga no debería cambiar el estado (%)', v_estado;
  end if;
  if v_vence is null
     or v_vence <= now() + interval '23 hours'
     or v_vence >= now() + interval '25 hours' then
    raise exception 'FALLÓ (caso 3): la prórroga no quedó en 24 h (%)', v_vence;
  end if;

  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch2 and tipo = 'prorroga_abierta';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 3): debería haber 1 evento "prorroga_abierta" y hay %', v_count;
  end if;

  -- Los cuatro administradores: A1, A2, B1 y B2.
  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_extension' and (data ->> 'challengeId')::uuid = v_ch2;
  if v_count <> 4 then
    raise exception 'FALLÓ (caso 3): deberían ser 4 avisos de prórroga y son %', v_count;
  end if;

  -- Este sí tiene hilo, así que el aviso lleva a la conversación.
  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_extension'
    and (data ->> 'challengeId')::uuid = v_ch2
    and data ->> 'threadKey' = 'challenge:' || v_ch2::text;
  if v_count <> 4 then
    raise exception 'FALLÓ (caso 3): los 4 avisos deberían llevar al hilo y llevan %', v_count;
  end if;

  -- Y la segunda pasada no abre una segunda prórroga.
  v_n := public.procesar_vencimientos_desafios();
  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch2 and tipo = 'prorroga_abierta';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 3): la segunda pasada abrió otra prórroga (% eventos)', v_count;
  end if;
  raise notice 'OK (caso 3): la negociación vencida abrió UNA prórroga de 24 h';

  -- ══ CASO 4: quién puede refrescar ════════════════════════════
  execute 'set local role authenticated';

  -- Un jugador sin rol de administrador, pero integrante del club, sí.
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_ap, 'role', 'authenticated')::text);
  perform public.refrescar_desafio(v_ch2);

  -- Un ajeno a los dos clubes, no.
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_x, 'role', 'authenticated')::text);
  begin
    perform public.refrescar_desafio(v_ch2);
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 4): un ajeno no debería poder refrescar el desafío';
  end if;
  execute 'reset role';
  raise notice 'OK (caso 4): refrescar es de los integrantes de los dos clubes y de nadie más';

  -- ══ CASO 5: la primera respuesta del club es la que vale ═════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a1, 'role', 'authenticated')::text);
  perform public.responder_prorroga(v_ch2, true);

  -- El segundo administrador del MISMO club no puede cambiarla.
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a2, 'role', 'authenticated')::text);
  perform public.responder_prorroga(v_ch2, false);
  execute 'reset role';

  select count(*) into v_count
  from public.club_challenge_extension_replies
  where challenge_id = v_ch2 and club_id = v_club_a;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 5): el club A debería tener 1 respuesta y tiene %', v_count;
  end if;

  select respuesta into v_ok
  from public.club_challenge_extension_replies
  where challenge_id = v_ch2 and club_id = v_club_a;
  if not v_ok then
    raise exception 'FALLÓ (caso 5): manda la primera respuesta del club, que fue «Sí»';
  end if;

  select estado into v_estado from public.club_challenges where id = v_ch2;
  if v_estado <> 'negociacion' then
    raise exception 'FALLÓ (caso 5): el «No» de un segundo administrador no debía cerrar nada (%)', v_estado;
  end if;
  raise notice 'OK (caso 5): un club responde una sola vez y el segundo admin no la cambia';

  -- ══ CASO 6: dos «Sí» reabren la negociación ══════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_b1, 'role', 'authenticated')::text);
  perform public.responder_prorroga(v_ch2, true);
  execute 'reset role';

  select estado, negociacion_vence_at, prorroga_abierta_at
    into v_estado, v_vence, v_abierta
  from public.club_challenges where id = v_ch2;

  if v_estado <> 'negociacion' then
    raise exception 'FALLÓ (caso 6): el desafío debería seguir en negociación y está %', v_estado;
  end if;
  if v_abierta is not null then
    raise exception 'FALLÓ (caso 6): la prórroga debería haber quedado cerrada';
  end if;
  if v_vence is null
     or v_vence <= now() + interval '71 hours'
     or v_vence >= now() + interval '73 hours' then
    raise exception 'FALLÓ (caso 6): la negociación no se reabrió por 72 h (%)', v_vence;
  end if;

  -- Las respuestas de la prórroga cerrada no se arrastran a la siguiente.
  select count(*) into v_count
  from public.club_challenge_extension_replies where challenge_id = v_ch2;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): quedaron % respuestas de la prórroga cerrada', v_count;
  end if;
  raise notice 'OK (caso 6): dos «Sí» reabren la negociación y limpian la prórroga';

  -- ══ CASO 7: un «No» cierra el desafío en el acto ═════════════
  update public.club_challenges
     set negociacion_vence_at = now() - interval '1 minute'
   where id = v_ch2;
  v_n := public.procesar_vencimientos_desafios();

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_b1, 'role', 'authenticated')::text);
  perform public.responder_prorroga(v_ch2, false);
  execute 'reset role';

  select estado into v_estado from public.club_challenges where id = v_ch2;
  if v_estado <> 'sin_acuerdo' then
    raise exception 'FALLÓ (caso 7): un «No» debería cerrar el desafío y quedó en %', v_estado;
  end if;

  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch2 and tipo = 'sin_acuerdo';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 7): debería haber 1 evento "sin_acuerdo" y hay %', v_count;
  end if;
  raise notice 'OK (caso 7): un «No» cierra el desafío sin esperar a que venza la prórroga';

  -- ══ CASO 8: el hilo cerrado queda legible pero mudo ══════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a1, 'role', 'authenticated')::text);

  select count(*) into v_count from public.messages where challenge_id = v_ch2;
  if v_count < 1 then
    raise exception 'FALLÓ (caso 8): el historial del hilo cerrado debería seguir visible';
  end if;

  begin
    insert into public.messages (sender_id, challenge_id, content)
    values (v_a1, v_ch2, 'después del cierre');
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  execute 'reset role';
  if v_ok then
    raise exception 'FALLÓ (caso 8): no se debería poder escribir en un desafío cerrado';
  end if;
  raise notice 'OK (caso 8): el hilo cerrado se lee pero no admite mensajes nuevos';

  -- ══ CASO 9: crear la propuesta oficial ═══════════════════════
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_c, v_club_d, v_c1, 'pendiente')
  returning id into v_ch3;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_d1, 'role', 'authenticated')::text);
  perform public.aceptar_desafio(v_ch3);

  -- Un jugador sin rol de administrador no propone.
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_cp, 'role', 'authenticated')::text);
  begin
    perform public.crear_propuesta_oficial(
      v_ch3,
      jsonb_build_object(
        'fecha', (now() + interval '3 days')::text,
        'duracion_min', 90,
        'direccion', 'Av. Siempre Viva 742',
        'cancha_nombre', 'Complejo Municipal',
        'comuna', 'Ñuñoa', 'region', 'Metropolitana',
        'modalidad', 'futbol7', 'cupos_por_club', 7,
        'metodo_inscripcion', 'orden_llegada', 'cuota_por_persona', 4000
      ),
      null
    );
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 9): un jugador sin rol no debería poder crear la propuesta';
  end if;

  -- Un administrador del club retador sí.
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_c1, 'role', 'authenticated')::text);
  v_prop_a := public.crear_propuesta_oficial(
    v_ch3,
    jsonb_build_object(
      'fecha', (now() + interval '3 days')::text,
      'duracion_min', 90,
      'direccion', 'Av. Siempre Viva 742',
      'cancha_nombre', 'Complejo Municipal',
      'comuna', 'Ñuñoa', 'region', 'Metropolitana',
      'modalidad', 'futbol7', 'cupos_por_club', 7,
      'metodo_inscripcion', 'orden_llegada', 'cuota_por_persona', 4000,
      'instrucciones', 'Llegar 20 minutos antes con el carnet.'
    ),
    v_token
  );
  execute 'reset role';

  v_prop := v_prop_a.id;

  select estado into v_estado from public.club_challenges where id = v_ch3;
  if v_estado <> 'esperando_aprobacion' then
    raise exception 'FALLÓ (caso 9): el desafío debería estar esperando aprobación y está %', v_estado;
  end if;
  if v_prop_a.club_proponente_id <> v_club_c then
    raise exception 'FALLÓ (caso 9): el club proponente se derivó mal';
  end if;

  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch3 and tipo = 'propuesta_creada';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 9): debería haber 1 evento "propuesta_creada" y hay %', v_count;
  end if;

  -- Avisos a los cuatro administradores menos el proponente: C2, D1, D2.
  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_proposal' and (data ->> 'challengeId')::uuid = v_ch3;
  if v_count <> 3 then
    raise exception 'FALLÓ (caso 9): deberían ser 3 avisos de propuesta y son %', v_count;
  end if;
  raise notice 'OK (caso 9): la propuesta oficial se crea y mueve el desafío';

  -- ══ CASO 10: el mismo client_token no crea otra propuesta ════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_c1, 'role', 'authenticated')::text);
  v_prop_b := public.crear_propuesta_oficial(
    v_ch3,
    jsonb_build_object(
      'fecha', (now() + interval '4 days')::text,
      'duracion_min', 60,
      'direccion', 'Otra dirección 111',
      'cancha_nombre', 'Otra cancha',
      'comuna', 'Maipú', 'region', 'Metropolitana',
      'modalidad', 'futbol11', 'cupos_por_club', 11,
      'metodo_inscripcion', 'seleccion_admin', 'cuota_por_persona', 9000
    ),
    v_token
  );
  execute 'reset role';

  if v_prop_b.id <> v_prop then
    raise exception 'FALLÓ (caso 10): el reintento creó una propuesta distinta';
  end if;
  select count(*) into v_count
  from public.club_challenge_proposals where challenge_id = v_ch3;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 10): debería haber 1 propuesta y hay %', v_count;
  end if;
  raise notice 'OK (caso 10): reintentar con el mismo token devuelve la propuesta que ya existía';

  -- ══ CASO 11: dos propuestas pendientes no pueden coexistir ═══
  begin
    insert into public.club_challenge_proposals (
      challenge_id, club_proponente_id, creada_por, fecha, duracion_min,
      direccion, cancha_nombre, comuna, region, modalidad, cupos_por_club,
      metodo_inscripcion, cuota_por_persona
    )
    values (
      v_ch3, v_club_d, v_d1, now() + interval '5 days', 90,
      'Paralela 1', 'Cancha paralela', 'Maipú', 'Metropolitana', 'futbol7', 7,
      'orden_llegada', 0
    );
    v_ok := true;
  exception when unique_violation then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 11): no debería admitirse una segunda propuesta pendiente';
  end if;
  raise notice 'OK (caso 11): el índice parcial deja una sola propuesta abierta por desafío';

  -- ══ CASO 12: un integrante sin rol SÍ lee la propuesta ═══════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_cp, 'role', 'authenticated')::text);
  select count(*) into v_count
  from public.club_challenge_proposals where challenge_id = v_ch3;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 12): un jugador del club debería leer la propuesta (ve %)', v_count;
  end if;

  -- Un ajeno a los dos clubes, no.
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_x, 'role', 'authenticated')::text);
  select count(*) into v_count
  from public.club_challenge_proposals where challenge_id = v_ch3;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 12): un ajeno no debería ver la propuesta (ve %)', v_count;
  end if;
  raise notice 'OK (caso 12): la propuesta la lee todo el club, y solo el club';

  -- ══ CASO 13: el proponente no rechaza su propia propuesta ════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_c2, 'role', 'authenticated')::text);
  begin
    perform public.rechazar_propuesta(v_prop, 'no me gusta la mía');
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 13): el club proponente no debería poder responder su propia propuesta';
  end if;

  -- El club contrario sí.
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_d1, 'role', 'authenticated')::text);
  perform public.rechazar_propuesta(v_prop, 'La cancha nos queda muy lejos');
  execute 'reset role';

  select estado into v_estado from public.club_challenge_proposals where id = v_prop;
  if v_estado <> 'rechazada' then
    raise exception 'FALLÓ (caso 13): la propuesta debería estar rechazada y está %', v_estado;
  end if;

  select estado into v_estado from public.club_challenges where id = v_ch3;
  if v_estado <> 'negociacion' then
    raise exception 'FALLÓ (caso 13): el desafío debería volver a negociación y está %', v_estado;
  end if;

  -- El aviso va al club proponente: C1 y C2 menos nadie (rechazó D1).
  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_proposal_rejected' and (data ->> 'challengeId')::uuid = v_ch3;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 13): deberían ser 2 avisos de rechazo (C1, C2) y son %', v_count;
  end if;
  raise notice 'OK (caso 13): solo el club contrario rechaza, y el desafío vuelve a negociación';

  -- ══ CASO 14: rechazar dos veces no rompe nada ════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_d1, 'role', 'authenticated')::text);
  v_prop_b := public.rechazar_propuesta(v_prop, 'otro motivo');
  execute 'reset role';

  if v_prop_b.motivo_rechazo <> 'La cancha nos queda muy lejos' then
    raise exception 'FALLÓ (caso 14): el segundo rechazo pisó el motivo original';
  end if;

  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch3 and tipo = 'propuesta_rechazada';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 14): debería haber 1 evento de rechazo y hay %', v_count;
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'club_challenge_proposal_rejected' and (data ->> 'challengeId')::uuid = v_ch3;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 14): el segundo rechazo mandó avisos de nuevo (%)', v_count;
  end if;
  raise notice 'OK (caso 14): rechazar dos veces devuelve lo mismo sin repetir efectos';

  raise notice '════════ TODAS LAS PRUEBAS DE LA MIGRACIÓN 43 PASARON ════════';
end;
$$;

rollback;
