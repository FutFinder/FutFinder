-- =============================================================
-- FutFinder — pruebas del tablero abierto de desafíos (migración 112)
--
-- QUÉ CUBRE:
--   1. Un administrador publica un desafío abierto.
--   2. Un jugador sin admin no puede publicar.
--   3. Cualquiera (incluso ajeno) puede LEER una publicación abierta.
--   4. Un club distinto responde a la publicación.
--   5. El club que publicó NO puede responder a su propia publicación.
--   6. El club que respondió retira su respuesta y luego la reconsidera.
--   7. El club que publicó rechaza una respuesta y la reconsidera.
--   8. Aceptar una respuesta (RPC): crea un club_challenges real en
--      'negociacion' —mismo ciclo formal, vía aceptar_desafio()—, cierra
--      la publicación y rechaza el resto de las respuestas pendientes.
--   9. Aceptar dos veces la misma respuesta es idempotente.
--  10. Sólo un administrador del club que publicó puede aceptar.
--  11. Editar la publicación mientras sigue abierta (admin del club).
--  12. Retirar (cancelar) la publicación; NO se puede forzar 'cerrado'
--      directo desde el cliente.
--  13. Un ajeno no puede leer las respuestas privadas de otro club ni
--      responder por otro club.
--  14. expirar_desafios_abiertos() marca como expirada una publicación
--      vieja sin respuesta aceptada.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run, en un proyecto de desarrollo, con la migración 112
-- ya aplicada (y con ella, las 41/42 de las que depende). Todo pasa
-- dentro de una transacción que termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_admin_a   uuid := gen_random_uuid();
  v_jugador_a uuid := gen_random_uuid();
  v_admin_b   uuid := gen_random_uuid();
  v_admin_c   uuid := gen_random_uuid();
  v_ajeno     uuid := gen_random_uuid();

  v_club_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();
  v_club_c uuid := gen_random_uuid();

  v_open_id  uuid;
  v_resp_b   uuid;
  v_resp_c   uuid;

  v_estado    text;
  v_filas     int;
  v_rechazado boolean;
  v_challenge public.club_challenges%rowtype;
begin
  -- ── Setup: usuarios y clubes ──────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin_a,   'authenticated', 'authenticated', 'tablero-admin-a-'   || v_admin_a   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_a, 'authenticated', 'authenticated', 'tablero-jugador-a-' || v_jugador_a || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_admin_b,   'authenticated', 'authenticated', 'tablero-admin-b-'   || v_admin_b   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_admin_c,   'authenticated', 'authenticated', 'tablero-admin-c-'   || v_admin_c   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_ajeno,     'authenticated', 'authenticated', 'tablero-ajeno-'     || v_ajeno     || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  insert into public.clubs (id, nombre, slug, created_by) values
    (v_club_a, 'Tablero Club A ' || left(v_club_a::text, 8), 'tablero-club-a-' || left(v_club_a::text, 8), v_admin_a),
    (v_club_b, 'Tablero Club B ' || left(v_club_b::text, 8), 'tablero-club-b-' || left(v_club_b::text, 8), v_admin_b),
    (v_club_c, 'Tablero Club C ' || left(v_club_c::text, 8), 'tablero-club-c-' || left(v_club_c::text, 8), v_admin_c);

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_admin_a,   'admin'),
    (v_club_a, v_jugador_a, 'jugador'),
    (v_club_b, v_admin_b,   'admin'),
    (v_club_c, v_admin_c,   'admin');

  -- ── Actuar como admin del club A ──────────────────────────────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);

  -- ── Caso 1: el administrador publica ─────────────────────────
  insert into public.club_open_challenges (club_id, creado_por, modalidad, fecha_propuesta, zona, mensaje)
  values (v_club_a, v_admin_a, 'futbol7', now() + interval '3 days', 'Cancha Los Aromos', 'Buscamos rival para el sábado')
  returning id into v_open_id;
  raise notice 'OK (caso 1): el administrador publica un desafío abierto';

  -- ── Caso 2: un jugador sin admin no puede publicar ───────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  begin
    insert into public.club_open_challenges (club_id, creado_por, modalidad, fecha_propuesta)
    values (v_club_a, v_jugador_a, 'futbol7', now() + interval '1 day');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 2): un jugador sin admin no debería poder publicar';
  end if;
  raise notice 'OK (caso 2): un jugador sin admin no puede publicar';

  -- ── Caso 3: cualquiera lee una publicación abierta ───────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  if not exists (select 1 from public.club_open_challenges where id = v_open_id) then
    raise exception 'FALLÓ (caso 3): una publicación abierta debería ser visible para cualquiera';
  end if;
  raise notice 'OK (caso 3): cualquier autenticado ve una publicación abierta';

  -- ── Caso 5: el club que publicó no puede responderse a sí mismo ─
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  begin
    insert into public.club_open_challenge_responses (open_challenge_id, club_id, creado_por, mensaje)
    values (v_open_id, v_club_a, v_admin_a, 'Nos respondemos a nosotros mismos');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 5): el club que publicó no debería poder responder su propia publicación';
  end if;
  raise notice 'OK (caso 5): el club que publicó no se puede responder a sí mismo';

  -- ── Caso 4: el club B responde ────────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text);
  insert into public.club_open_challenge_responses (open_challenge_id, club_id, creado_por, mensaje)
  values (v_open_id, v_club_b, v_admin_b, 'Nos acomoda, vamos con equipo completo')
  returning id into v_resp_b;
  raise notice 'OK (caso 4): un club distinto responde a la publicación';

  -- ── Caso 6: el club B retira su respuesta y la reconsidera ───
  update public.club_open_challenge_responses set estado = 'retirada' where id = v_resp_b;
  select estado into v_estado from public.club_open_challenge_responses where id = v_resp_b;
  if v_estado is distinct from 'retirada' then
    raise exception 'FALLÓ (caso 6): el club debería poder retirar su propia respuesta';
  end if;
  update public.club_open_challenge_responses set estado = 'pendiente' where id = v_resp_b;
  select estado into v_estado from public.club_open_challenge_responses where id = v_resp_b;
  if v_estado is distinct from 'pendiente' then
    raise exception 'FALLÓ (caso 6): el club debería poder reconsiderar su respuesta retirada';
  end if;
  raise notice 'OK (caso 6): el club que respondió retira y reconsidera su propia respuesta';

  -- ── El club C también responde (para el caso 8: se rechaza al resto) ─
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_c, 'role', 'authenticated')::text);
  insert into public.club_open_challenge_responses (open_challenge_id, club_id, creado_por, mensaje)
  values (v_open_id, v_club_c, v_admin_c, 'También nos interesa')
  returning id into v_resp_c;

  -- ── Caso 7: el club que publicó rechaza y reconsidera una respuesta ─
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  update public.club_open_challenge_responses set estado = 'rechazada' where id = v_resp_c;
  select estado into v_estado from public.club_open_challenge_responses where id = v_resp_c;
  if v_estado is distinct from 'rechazada' then
    raise exception 'FALLÓ (caso 7): el club que publicó debería poder rechazar una respuesta';
  end if;
  update public.club_open_challenge_responses set estado = 'pendiente' where id = v_resp_c;
  raise notice 'OK (caso 7): el club que publicó rechaza y reconsidera una respuesta';

  -- ── Caso 13a: un ajeno no puede responder por el club C ──────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  begin
    insert into public.club_open_challenge_responses (open_challenge_id, club_id, creado_por, mensaje)
    values (v_open_id, v_club_c, v_ajeno, 'Intento ajeno');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 13a): un ajeno no debería poder responder por un club del que no es admin';
  end if;
  raise notice 'OK (caso 13a): un ajeno no puede responder por un club ajeno';

  -- ── Caso 10: sólo el club que publicó puede aceptar una respuesta ─
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text);
  begin
    perform public.aceptar_respuesta_desafio_abierto(v_resp_b);
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 10): el club que respondió no debería poder aceptarse a sí mismo';
  end if;
  raise notice 'OK (caso 10): sólo un administrador del club que publicó puede aceptar';

  -- ── Caso 8: el club A acepta la respuesta del club B ─────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  v_challenge := public.aceptar_respuesta_desafio_abierto(v_resp_b);

  if v_challenge.estado is distinct from 'negociacion' then
    raise exception 'FALLÓ (caso 8): el desafío resultante debería quedar en negociacion (vía aceptar_desafio), quedó en %', v_challenge.estado;
  end if;
  if v_challenge.club_retador_id is distinct from v_club_b or v_challenge.club_retado_id is distinct from v_club_a then
    raise exception 'FALLÓ (caso 8): el desafío resultante debería ser retador=club B, retado=club A';
  end if;

  select estado into v_estado from public.club_open_challenges where id = v_open_id;
  if v_estado is distinct from 'cerrado' then
    raise exception 'FALLÓ (caso 8): la publicación debería quedar cerrada';
  end if;

  select estado into v_estado from public.club_open_challenge_responses where id = v_resp_b;
  if v_estado is distinct from 'aceptada' then
    raise exception 'FALLÓ (caso 8): la respuesta elegida debería quedar aceptada';
  end if;

  select estado into v_estado from public.club_open_challenge_responses where id = v_resp_c;
  if v_estado is distinct from 'rechazada' then
    raise exception 'FALLÓ (caso 8): la respuesta del club C debería quedar rechazada al aceptar la del club B';
  end if;

  if not exists (select 1 from public.messages where challenge_id = v_challenge.id) then
    raise exception 'FALLÓ (caso 8): aceptar_desafio() debería haber dejado el mensaje de sistema del ciclo formal';
  end if;
  raise notice 'OK (caso 8): aceptar una respuesta entra al ciclo formal y descarta el resto';

  -- ── Caso 9: aceptar de nuevo la misma respuesta es idempotente ─
  v_challenge := public.aceptar_respuesta_desafio_abierto(v_resp_b);
  if v_challenge.estado is distinct from 'negociacion' then
    raise exception 'FALLÓ (caso 9): reintentar debería devolver el mismo desafío sin romper nada';
  end if;
  if (select count(*) from public.club_challenges where club_retador_id = v_club_b and club_retado_id = v_club_a) <> 1 then
    raise exception 'FALLÓ (caso 9): no debería haberse creado un segundo desafío';
  end if;
  raise notice 'OK (caso 9): aceptar dos veces la misma respuesta es idempotente';

  -- ── Caso 11 y 12: editar y retirar una publicación nueva ─────
  insert into public.club_open_challenges (club_id, creado_por, modalidad, fecha_propuesta, mensaje)
  values (v_club_a, v_admin_a, 'futbol11', now() + interval '5 days', 'Otra publicación')
  returning id into v_open_id;

  update public.club_open_challenges set mensaje = 'Mensaje editado' where id = v_open_id;
  select mensaje into v_estado from public.club_open_challenges where id = v_open_id;
  if v_estado is distinct from 'Mensaje editado' then
    raise exception 'FALLÓ (caso 11): el admin debería poder editar su publicación mientras sigue abierta';
  end if;
  raise notice 'OK (caso 11): se edita una publicación mientras sigue abierta';

  begin
    update public.club_open_challenges set estado = 'cerrado' where id = v_open_id;
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 12): el cliente no debería poder forzar el estado a cerrado directamente';
  end if;

  update public.club_open_challenges set estado = 'cancelado' where id = v_open_id;
  select estado into v_estado from public.club_open_challenges where id = v_open_id;
  if v_estado is distinct from 'cancelado' then
    raise exception 'FALLÓ (caso 12): el admin debería poder retirar (cancelar) su publicación';
  end if;
  raise notice 'OK (caso 12): se retira la publicación; no se puede forzar "cerrado" a mano';

  -- ── Caso 13b: un ajeno no lee las respuestas privadas del club C ─
  -- (usa la publicación original, ya cerrada, y la respuesta rechazada
  -- del club C, que nunca fue pública)
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  if exists (select 1 from public.club_open_challenge_responses where id = v_resp_c) then
    raise exception 'FALLÓ (caso 13b): un ajeno no debería poder leer la respuesta de un club del que no es admin ni dueño de la publicación';
  end if;
  raise notice 'OK (caso 13b): un ajeno no lee respuestas privadas de otros clubes';

  -- ── Caso 14: expirar_desafios_abiertos() ─────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  insert into public.club_open_challenges (club_id, creado_por, modalidad, fecha_propuesta, created_at)
  values (v_club_a, v_admin_a, 'futbol7', now() + interval '10 days', now() - interval '8 days')
  returning id into v_open_id;

  perform public.expirar_desafios_abiertos();

  select estado into v_estado from public.club_open_challenges where id = v_open_id;
  if v_estado is distinct from 'expirado' then
    raise exception 'FALLÓ (caso 14): una publicación de hace más de 7 días sin aceptar debería expirar, quedó en %', v_estado;
  end if;
  raise notice 'OK (caso 14): expirar_desafios_abiertos() expira publicaciones viejas';

  raise notice 'TODAS LAS PRUEBAS DEL TABLERO ABIERTO DE DESAFÍOS PASARON';
end $$;

rollback;
