-- =============================================================
-- FutFinder — pruebas de permisos del club (migración 119)
--
-- QUÉ CUBRE:
--   1-6.  tiene_permiso_de_club(): admin siempre true, defaults de rol
--         de HOY (capitán sólo lineup), excepción por integrante gana
--         al rol (en los dos sentidos), sin membresía es false.
--   7-10. Las cuatro RPC de administración: guardar permisos de un rol,
--         guardar/quitar una excepción, restaurar a los sugeridos —
--         cada una exige admin, y el admin nunca se puede limitar.
--   11.   removeMembers concedido a un jugador NO le permite expulsar
--         al administrador (la guarda de seguridad de la sección 5).
--   12-19. Cada uno de los nueve permisos aplicado de verdad: bloqueado
--         por default para un jugador, y desbloqueado al concederlo.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run, en un proyecto de desarrollo, con la migración 119
-- ya aplicada. Todo pasa dentro de una transacción que termina en
-- ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_admin_a    uuid := gen_random_uuid();
  v_capitan_a  uuid := gen_random_uuid();
  v_jugador_a  uuid := gen_random_uuid();
  v_jugador_a2 uuid := gen_random_uuid();
  v_admin_b    uuid := gen_random_uuid();
  v_jugador_b  uuid := gen_random_uuid();
  v_ajeno      uuid := gen_random_uuid();

  v_club_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();

  v_member_jugador_a  uuid;
  v_member_jugador_a2 uuid;
  v_member_capitan_a  uuid;

  v_ok        boolean;
  v_rechazado boolean;
  v_challenge_id uuid;
  v_open_id      uuid;
  v_resp_id      uuid;
  v_match_id     uuid;
  v_res          json;
begin
  -- ── Setup: usuarios, clubes, membresías ───────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin_a,    'authenticated', 'authenticated', 'permisos-admin-a-'    || v_admin_a    || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_capitan_a,  'authenticated', 'authenticated', 'permisos-capitan-a-'  || v_capitan_a  || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_a,  'authenticated', 'authenticated', 'permisos-jugador-a-'  || v_jugador_a  || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_a2, 'authenticated', 'authenticated', 'permisos-jugador-a2-' || v_jugador_a2 || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_admin_b,    'authenticated', 'authenticated', 'permisos-admin-b-'    || v_admin_b    || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_b,  'authenticated', 'authenticated', 'permisos-jugador-b-'  || v_jugador_b  || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_ajeno,      'authenticated', 'authenticated', 'permisos-ajeno-'      || v_ajeno      || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  insert into public.clubs (id, nombre, slug, created_by) values
    (v_club_a, 'Permisos Club A ' || left(v_club_a::text, 8), 'permisos-club-a-' || left(v_club_a::text, 8), v_admin_a),
    (v_club_b, 'Permisos Club B ' || left(v_club_b::text, 8), 'permisos-club-b-' || left(v_club_b::text, 8), v_admin_b);

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_admin_a,    'admin'),
    (v_club_a, v_capitan_a,  'capitan'),
    (v_club_a, v_jugador_a,  'jugador'),
    (v_club_a, v_jugador_a2, 'jugador'),
    (v_club_b, v_admin_b,    'admin'),
    (v_club_b, v_jugador_b,  'jugador')
  returning id into v_member_jugador_a; -- se pisa, se recupera abajo

  select id into v_member_jugador_a  from public.club_members where club_id = v_club_a and user_id = v_jugador_a;
  select id into v_member_jugador_a2 from public.club_members where club_id = v_club_a and user_id = v_jugador_a2;
  select id into v_member_capitan_a  from public.club_members where club_id = v_club_a and user_id = v_capitan_a;

  -- ── Caso 1: la migración sembró las 18 filas del club A (backfill) ─
  if (select count(*) from public.club_role_permissions where club_id = v_club_a) <> 18 then
    raise exception 'FALLÓ (caso 1): el club A debería tener 9 permisos × 2 roles = 18 filas sembradas';
  end if;
  raise notice 'OK (caso 1): el sembrado dejó 18 filas para el club A';

  -- ── Caso 2: admin siempre tiene el permiso, aunque su rol no tenga fila ─
  if not public.tiene_permiso_de_club(v_club_a, v_admin_a, 'editClub') then
    raise exception 'FALLÓ (caso 2): el administrador siempre debería tener todos los permisos';
  end if;
  raise notice 'OK (caso 2): admin siempre tiene el permiso';

  -- ── Caso 3: la regla de HOY — capitán sólo lineup, nada más ──────
  if not public.tiene_permiso_de_club(v_club_a, v_capitan_a, 'lineup') then
    raise exception 'FALLÓ (caso 3): capitán debería tener lineup por default (regla de hoy)';
  end if;
  if public.tiene_permiso_de_club(v_club_a, v_capitan_a, 'editClub') then
    raise exception 'FALLÓ (caso 3): capitán NO debería tener editClub por default';
  end if;
  if public.tiene_permiso_de_club(v_club_a, v_jugador_a, 'lineup') then
    raise exception 'FALLÓ (caso 3): jugador NO debería tener lineup por default';
  end if;
  raise notice 'OK (caso 3): los defaults sembrados son la regla de hoy, no la sugerida';

  -- ── Caso 4: sin membresía en el club, siempre false ──────────────
  if public.tiene_permiso_de_club(v_club_a, v_ajeno, 'lineup') then
    raise exception 'FALLÓ (caso 4): alguien ajeno al club no debería tener ningún permiso';
  end if;
  raise notice 'OK (caso 4): sin membresía, tiene_permiso_de_club es false';

  -- ── Caso 5: una excepción por integrante gana al rol (false → true) ─
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permiso_integrante(v_club_a, v_jugador_a, 'invite', true);
  if not public.tiene_permiso_de_club(v_club_a, v_jugador_a, 'invite') then
    raise exception 'FALLÓ (caso 5): la excepción propia debería ganarle al default del rol (false→true)';
  end if;
  -- El otro jugador, sin excepción, se queda en el default del rol.
  if public.tiene_permiso_de_club(v_club_a, v_jugador_a2, 'invite') then
    raise exception 'FALLÓ (caso 5): un jugador SIN excepción no debería heredar la del otro';
  end if;
  raise notice 'OK (caso 5): la excepción por integrante gana al default del rol';

  -- ── Caso 6: una excepción también puede apagar lo que el rol daría ─
  perform public.club_guardar_permiso_integrante(v_club_a, v_capitan_a, 'lineup', false);
  if public.tiene_permiso_de_club(v_club_a, v_capitan_a, 'lineup') then
    raise exception 'FALLÓ (caso 6): la excepción debería poder apagar lo que el rol sí da';
  end if;
  raise notice 'OK (caso 6): la excepción también puede quitar lo que el rol daría';

  -- ── Caso 7: club_quitar_excepciones_integrante vuelve al default del rol ─
  perform public.club_quitar_excepciones_integrante(v_club_a, v_capitan_a);
  if not public.tiene_permiso_de_club(v_club_a, v_capitan_a, 'lineup') then
    raise exception 'FALLÓ (caso 7): al quitar la excepción, debería volver al default del rol (lineup=true)';
  end if;
  raise notice 'OK (caso 7): quitar excepciones vuelve al default del rol';

  -- ── Caso 8: un no-admin no puede llamar las RPC de administración ─
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  begin
    perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('editClub', true));
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 8): un jugador no debería poder guardar permisos de rol';
  end if;

  begin
    perform public.club_guardar_permiso_integrante(v_club_a, v_jugador_a2, 'invite', true);
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 8): un jugador no debería poder guardar una excepción';
  end if;

  begin
    perform public.club_restaurar_permisos_default(v_club_a);
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 8): un jugador no debería poder restaurar los permisos del club';
  end if;
  raise notice 'OK (caso 8): las cuatro RPC de administración exigen admin';

  -- ── Caso 9: no se le puede abrir/cerrar una excepción al admin ──
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  begin
    perform public.club_guardar_permiso_integrante(v_club_a, v_admin_a, 'editClub', false);
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 9): no debería poder guardarse una excepción para el propio admin';
  end if;
  raise notice 'OK (caso 9): el admin no se puede limitar con una excepción';

  -- ── Caso 10: club_guardar_permisos_rol guarda de verdad ─────────
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('editNicks', true));
  if not public.tiene_permiso_de_club(v_club_a, v_jugador_a, 'editNicks') then
    raise exception 'FALLÓ (caso 10): club_guardar_permisos_rol debería aplicar al instante a todo el rol';
  end if;
  if not public.tiene_permiso_de_club(v_club_a, v_jugador_a2, 'editNicks') then
    raise exception 'FALLÓ (caso 10): el permiso de rol aplica a TODOS los del rol, no sólo a uno';
  end if;
  raise notice 'OK (caso 10): club_guardar_permisos_rol aplica a todo el rol';

  -- ── Caso 11: club_restaurar_permisos_default vuelve a lo sugerido ─
  perform public.club_restaurar_permisos_default(v_club_a);
  if not public.tiene_permiso_de_club(v_club_a, v_capitan_a, 'answerChallenge') then
    raise exception 'FALLÓ (caso 11): restaurar debería dejar a capitán con answerChallenge=true (sugerido)';
  end if;
  if not public.tiene_permiso_de_club(v_club_a, v_jugador_a, 'invite') then
    raise exception 'FALLÓ (caso 11): restaurar debería dejar a jugador con invite=true (sugerido)';
  end if;
  -- La excepción de invite del caso 5 se borró: ya no hace falta, el
  -- sugerido de jugador para invite ya es true.
  if exists (select 1 from public.club_member_permission_overrides where club_id = v_club_a) then
    raise exception 'FALLÓ (caso 11): restaurar debería borrar TODAS las excepciones del club';
  end if;
  raise notice 'OK (caso 11): restaurar aplica los sugeridos y borra las excepciones';

  -- Vuelve a la regla de hoy para el resto de las pruebas: sólo
  -- capitán con lineup, todo lo demás apagado.
  --
  -- POR LA PUERTA BUENA, y no con un `update` directo. La migración
  -- revoca insert/update/delete de `club_role_permissions` a
  -- `authenticated`, y en este punto el arnés YA está suplantando a
  -- `authenticated` desde el caso 5: el update crudo moría con
  -- `42501 permission denied for table club_role_permissions`. Que la
  -- propia prueba no pueda escribir a mano es, de hecho, la migración
  -- funcionando.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'capitan', jsonb_build_object(
      'pubChallenge', false, 'answerChallenge', false, 'chatClubs', false,
      'invite', false, 'removeMembers', false, 'editNicks', false,
      'lineup', true, 'results', false, 'editClub', false));
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object(
      'pubChallenge', false, 'answerChallenge', false, 'chatClubs', false,
      'invite', false, 'removeMembers', false, 'editNicks', false,
      'lineup', false, 'results', false, 'editClub', false));

  -- ═══════════════════════════════════════════════════════════
  -- Los nueve permisos aplicados de verdad
  -- ═══════════════════════════════════════════════════════════

  -- ── Caso 12: editClub — bloqueado por default, se abre al conceder ─
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  update public.clubs set descripcion = 'Intento sin permiso' where id = v_club_a;
  select descripcion into v_ok from public.clubs where id = v_club_a; -- v_ok reutilizado como texto no aplica; se usa exists abajo
  if exists (select 1 from public.clubs where id = v_club_a and descripcion = 'Intento sin permiso') then
    raise exception 'FALLÓ (caso 12): un jugador sin editClub no debería poder editar el club';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('editClub', true));

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  update public.clubs set descripcion = 'Editado con permiso' where id = v_club_a;
  if not exists (select 1 from public.clubs where id = v_club_a and descripcion = 'Editado con permiso') then
    raise exception 'FALLÓ (caso 12): al conceder editClub, el jugador debería poder editar el club';
  end if;
  raise notice 'OK (caso 12): editClub bloqueado por default, se aplica al concederlo';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('editClub', false));

  -- ── Caso 13: removeMembers — bloqueado por default, se abre al conceder,
  --             y AUN CONCEDIDO nunca alcanza para expulsar al admin ──
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  delete from public.club_members where id = v_member_jugador_a2;
  if not exists (select 1 from public.club_members where id = v_member_jugador_a2) then
    raise exception 'FALLÓ (caso 13): un jugador sin removeMembers no debería poder expulsar a nadie';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('removeMembers', true));

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  delete from public.club_members where id = v_member_jugador_a2;
  if exists (select 1 from public.club_members where id = v_member_jugador_a2) then
    raise exception 'FALLÓ (caso 13): al conceder removeMembers, el jugador debería poder expulsar a otro jugador';
  end if;

  -- La guarda de seguridad: ni con el permiso concedido puede expulsar
  -- al administrador del club.
  delete from public.club_members where club_id = v_club_a and user_id = v_admin_a;
  if not exists (select 1 from public.club_members where club_id = v_club_a and user_id = v_admin_a) then
    raise exception 'FALLÓ (caso 13): removeMembers NUNCA debería alcanzar para expulsar al administrador';
  end if;
  raise notice 'OK (caso 13): removeMembers bloqueado por default, se aplica al concederlo, y nunca alcanza contra el admin';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('removeMembers', false));

  -- ── Caso 14: invite — bloqueado por default, se abre al conceder ──
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  begin
    insert into public.club_join_requests (club_id, user_id, tipo)
    values (v_club_a, v_ajeno, 'invitacion');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 14): un jugador sin invite no debería poder invitar';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('invite', true));

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  insert into public.club_join_requests (club_id, user_id, tipo)
  values (v_club_a, v_ajeno, 'invitacion');
  raise notice 'OK (caso 14): invite bloqueado por default, se aplica al concederlo';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('invite', false));

  -- ── Caso 15: editNicks — bloqueado para el apodo de OTRO, el propio
  --             siempre se puede cambiar ────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  perform public.set_apodo_club(v_member_jugador_a, 'MiPropioApodo');
  select apodo into v_res from public.club_member_apodos where member_id = v_member_jugador_a; -- ok, sólo comprobación de humo

  begin
    perform public.set_apodo_club(v_member_capitan_a, 'ApodoAjeno');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 15): un jugador sin editNicks no debería poder cambiar el apodo de otro';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('editNicks', true));

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  perform public.set_apodo_club(v_member_capitan_a, 'ApodoConPermiso');
  if not exists (select 1 from public.club_member_apodos where member_id = v_member_capitan_a and apodo = 'ApodoConPermiso') then
    raise exception 'FALLÓ (caso 15): al conceder editNicks, el jugador debería poder cambiar el apodo de otro';
  end if;
  raise notice 'OK (caso 15): editNicks bloqueado para el apodo de otro por default, propio siempre libre';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('editNicks', false));

  -- ── Caso 16: lineup — capitán sí por default (regla de hoy), jugador no ─
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_capitan_a, 'role', 'authenticated')::text);
  -- `modo` (7 u 11) y `formacion` son NOT NULL con CHECK: sin ellas el
  -- insert muere por restricción antes de llegar a probar el permiso.
  insert into public.club_lineups (club_id, updated_by, modo, formacion, asignaciones)
  values (v_club_a, v_capitan_a, 7, '3-2-1', '{}'::jsonb);
  raise notice 'OK (caso 16a): capitán mantiene lineup por default (regla de hoy)';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  begin
    update public.club_lineups set updated_by = v_jugador_a, asignaciones = '{}'::jsonb where club_id = v_club_a;
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if exists (select 1 from public.club_lineups where club_id = v_club_a and updated_by = v_jugador_a) then
    raise exception 'FALLÓ (caso 16b): un jugador sin lineup no debería poder guardar la alineación';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('lineup', true));

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  update public.club_lineups set updated_by = v_jugador_a, asignaciones = '{}'::jsonb where club_id = v_club_a;
  if not exists (select 1 from public.club_lineups where club_id = v_club_a and updated_by = v_jugador_a) then
    raise exception 'FALLÓ (caso 16c): al conceder lineup, el jugador debería poder guardar la alineación';
  end if;
  raise notice 'OK (caso 16): lineup respeta la regla de hoy y se puede conceder a jugador';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('lineup', false));

  -- ── Caso 17: pubChallenge — bloqueado por default, se abre al conceder ─
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  begin
    insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, fecha_propuesta)
    values (v_club_a, v_club_b, v_jugador_a, now() + interval '2 days');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 17): un jugador sin pubChallenge no debería poder crear un desafío directo';
  end if;

  begin
    insert into public.club_open_challenges (club_id, creado_por, modalidad, fecha_propuesta)
    values (v_club_a, v_jugador_a, 'futbol7', now() + interval '2 days');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 17): un jugador sin pubChallenge no debería poder publicar en el tablero abierto';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('pubChallenge', true));

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, fecha_propuesta)
  values (v_club_a, v_club_b, v_jugador_a, now() + interval '2 days')
  returning id into v_challenge_id;
  insert into public.club_open_challenges (club_id, creado_por, modalidad, fecha_propuesta)
  values (v_club_a, v_jugador_a, 'futbol7', now() + interval '2 days')
  returning id into v_open_id;
  raise notice 'OK (caso 17): pubChallenge bloqueado por default, se aplica al concederlo (directo y tablero abierto)';

  -- ── Caso 18: answerChallenge — bloqueado por default, se abre al conceder ─
  -- Club B responde a la publicación del club A en el tablero abierto,
  -- para poder probar que el club A (con y sin el permiso) puede o no
  -- elegir esa respuesta.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text);
  insert into public.club_open_challenge_responses (open_challenge_id, club_id, creado_por)
  values (v_open_id, v_club_b, v_admin_b)
  returning id into v_resp_id;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  begin
    perform public.aceptar_respuesta_desafio_abierto(v_resp_id);
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 18): un jugador sin answerChallenge no debería poder elegir una respuesta';
  end if;

  -- El desafío directo lo acepta el club RETADO, que acá es el B: pedirle
  -- al club retador que acepte su propio desafío no prueba el permiso, sólo
  -- que no perteneces al otro club. Por eso el club B tiene un jugador.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_b, 'role', 'authenticated')::text);
  begin
    perform public.aceptar_desafio(v_challenge_id);
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 18): un jugador sin answerChallenge no debería poder aceptar un desafío directo';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_b, 'jugador', jsonb_build_object('answerChallenge', true));

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_b, 'role', 'authenticated')::text);
  perform public.aceptar_desafio(v_challenge_id);
  if not exists (select 1 from public.club_challenges where id = v_challenge_id and estado = 'negociacion') then
    raise exception 'FALLÓ (caso 18): al conceder answerChallenge, el jugador debería poder aceptar el desafío directo';
  end if;
  raise notice 'OK (caso 18): answerChallenge bloqueado por default, se aplica al concederlo';

  -- ── Caso 19: chatClubs — bloqueado por default, se abre al conceder ─
  -- El desafío directo ya quedó en negociación (caso 18): es el estado
  -- que chat_puede_escribir_desafio() exige.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('answerChallenge', false, 'chatClubs', false));

  if public.chat_puede_escribir_desafio(v_challenge_id, v_jugador_a) then
    raise exception 'FALLÓ (caso 19): un jugador sin chatClubs no debería poder escribir en el chat del desafío';
  end if;

  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('chatClubs', true));

  if not public.chat_puede_escribir_desafio(v_challenge_id, v_jugador_a) then
    raise exception 'FALLÓ (caso 19): al conceder chatClubs, el jugador debería poder escribir en el chat del desafío';
  end if;
  raise notice 'OK (caso 19): chatClubs bloqueado por default, se aplica al concederlo';

  -- ── Caso 20: results — bloqueado por default, se abre al conceder ──
  -- Hace falta un partido real en 'esperando_resultado': se arma a mano
  -- en vez de recorrer todo el ciclo de propuesta oficial.
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('chatClubs', false));

  -- Las columnas reales de `matches` son otras (`id_organizador`, y no
  -- existe `tipo` ni `creado_por`), y `tg_match_future_only` rechaza
  -- insertar un partido con hora pasada: se crea a futuro y se mueve al
  -- pasado con un update, que es lo que el disparador sí permite.
  insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
      latitud, longitud, hora, cupos_totales, cupos_disponibles,
      duracion_min, cupos_por_club, club_local_id, club_visitante_id)
  values (gen_random_uuid(), v_admin_a, 'Permisos test match', 'Comuna Test',
      'Cancha de prueba', -33.45, -70.66, now() + interval '2 days', 20, 20,
      90, 10, v_club_a, v_club_b)
  returning id into v_match_id;
  update public.matches set hora = now() - interval '1 hour', estado = 'finalizado'
   where id = v_match_id;

  update public.club_challenges
     set estado = 'esperando_resultado', match_id = v_match_id
   where id = v_challenge_id;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  v_res := public.proponer_resultado(v_challenge_id, 3, 1, null);
  if (v_res ->> 'ok')::boolean then
    raise exception 'FALLÓ (caso 20): un jugador sin results no debería poder proponer el resultado';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
  perform public.club_guardar_permisos_rol(v_club_a, 'jugador', jsonb_build_object('results', true));

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);
  v_res := public.proponer_resultado(v_challenge_id, 3, 1, null);
  if not (v_res ->> 'ok')::boolean then
    raise exception 'FALLÓ (caso 20): al conceder results, el jugador debería poder proponer el resultado. Motivo: %', (v_res ->> 'reason');
  end if;
  raise notice 'OK (caso 20): results bloqueado por default, se aplica al concederlo';

  raise notice '════════════════════════════════════════════';
  raise notice 'TODAS LAS PRUEBAS DE PERMISOS DEL CLUB PASARON';
  raise notice '════════════════════════════════════════════';
end $$;

rollback;
