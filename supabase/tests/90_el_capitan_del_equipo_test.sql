-- =============================================================
-- FutFinder — pruebas del capitán del equipo (migración 90)
--
-- QUÉ CUBRE:
--   1. Un administrador puede nombrar capitán a un integrante.
--   2. Un administrador puede quitarle el rol de capitán (vuelve a
--      jugador).
--   3. Un integrante que no administra no puede cambiar ningún rol,
--      ni el propio ni el de otro.
--   4. EL BUG CORREGIDO: un administrador de OTRO club no puede tocar
--      el rol de un integrante de este club. Antes de la 90,
--      `club_members_update` tenía la misma auto-referencia que ya se
--      había corregido en insert (18) y delete (20), así que esto
--      habría pasado con cualquier administrador de cualquier club.
--   5. Nombrar capitán no cuenta contra el tope de administradores del
--      plan: un club 'estandar' (tope 1 admin) ya con su admin puesto
--      puede además nombrar un capitán sin que el trigger lo rechace.
--   6. Puede haber más de un capitán a la vez en el mismo club.
--   7. Un rol inventado ('presidente') lo rechaza el CHECK del servidor.
--   8. Un usuario ajeno al club (ni siquiera integrante) tampoco puede
--      cambiar roles.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run, en un proyecto de desarrollo, con la migración 90
-- ya aplicada. Todo pasa dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

do $$
declare
  v_admin_a    uuid := gen_random_uuid();
  v_jugador_a1 uuid := gen_random_uuid();
  v_jugador_a2 uuid := gen_random_uuid();
  v_admin_b    uuid := gen_random_uuid();
  v_ajeno      uuid := gen_random_uuid();

  v_club_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();

  v_miembro_a1 uuid;
  v_miembro_a2 uuid;

  v_rol       text;
  v_filas     int;
  v_rechazado boolean;
begin
  -- ── Setup: usuarios ───────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin_a,    'authenticated', 'authenticated', 'cap-admin-a-'    || v_admin_a    || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_a1, 'authenticated', 'authenticated', 'cap-jugador-a1-' || v_jugador_a1 || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_a2, 'authenticated', 'authenticated', 'cap-jugador-a2-' || v_jugador_a2 || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_admin_b,    'authenticated', 'authenticated', 'cap-admin-b-'    || v_admin_b    || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_ajeno,      'authenticated', 'authenticated', 'cap-ajeno-'      || v_ajeno      || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  -- ── Setup: dos clubes 'estandar' (tope 1 admin / 15 integrantes) ─
  insert into public.clubs (id, nombre, slug, created_by) values
    (v_club_a, 'Capitán Club A ' || left(v_club_a::text, 8), 'capitan-club-a-' || left(v_club_a::text, 8), v_admin_a),
    (v_club_b, 'Capitán Club B ' || left(v_club_b::text, 8), 'capitan-club-b-' || left(v_club_b::text, 8), v_admin_b);

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_admin_a,    'admin'),
    (v_club_a, v_jugador_a1, 'jugador'),
    (v_club_a, v_jugador_a2, 'jugador'),
    (v_club_b, v_admin_b,    'admin');

  select id into v_miembro_a1 from public.club_members where club_id = v_club_a and user_id = v_jugador_a1;
  select id into v_miembro_a2 from public.club_members where club_id = v_club_a and user_id = v_jugador_a2;

  -- ── Actuar como el administrador del club A ──────────────────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);

  -- ── Caso 1: el administrador nombra capitán ──────────────────
  update public.club_members set rol = 'capitan' where id = v_miembro_a1;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'FALLÓ (caso 1): el administrador debería poder nombrar capitán, afectó % filas', v_filas;
  end if;
  select rol into v_rol from public.club_members where id = v_miembro_a1;
  if v_rol is distinct from 'capitan' then
    raise exception 'FALLÓ (caso 1): el rol debería quedar en capitan, quedó en %', v_rol;
  end if;
  raise notice 'OK (caso 1): el administrador nombra capitán';

  -- ── Caso 5: nombrar un SEGUNDO capitán no choca con el tope de admins ─
  update public.club_members set rol = 'capitan' where id = v_miembro_a2;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'FALLÓ (caso 5): nombrar un segundo capitán no debería chocar con el tope de administradores';
  end if;
  raise notice 'OK (caso 5): capitán no cuenta contra el tope de administradores del plan';

  -- ── Caso 6: puede haber más de un capitán a la vez ───────────
  if (select count(*) from public.club_members where club_id = v_club_a and rol = 'capitan') <> 2 then
    raise exception 'FALLÓ (caso 6): deberían quedar dos capitanes en el club A';
  end if;
  raise notice 'OK (caso 6): más de un capitán a la vez, sin exclusividad';

  -- ── Caso 2: el administrador quita el capitán (vuelve a jugador) ─
  update public.club_members set rol = 'jugador' where id = v_miembro_a1;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'FALLÓ (caso 2): el administrador debería poder quitar el capitán';
  end if;
  select rol into v_rol from public.club_members where id = v_miembro_a1;
  if v_rol is distinct from 'jugador' then
    raise exception 'FALLÓ (caso 2): el rol debería volver a jugador, quedó en %', v_rol;
  end if;
  raise notice 'OK (caso 2): el administrador quita el capitán';

  -- ── Caso 7: un rol inventado lo rechaza el CHECK ─────────────
  begin
    update public.club_members set rol = 'presidente' where id = v_miembro_a1;
    v_rechazado := false;
  exception when check_violation then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 7): el CHECK debería rechazar un rol inventado';
  end if;
  raise notice 'OK (caso 7): el servidor rechaza un rol inventado';

  -- ── Actuar como un jugador SIN permiso de administrar ────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a1, 'role', 'authenticated')::text);

  -- ── Caso 3: un jugador no puede cambiar ningún rol ───────────
  update public.club_members set rol = 'capitan' where id = v_miembro_a1;
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then
    raise exception 'FALLÓ (caso 3): un jugador sin rol admin no debería poder cambiar roles (afectó % filas)', v_filas;
  end if;
  raise notice 'OK (caso 3): un jugador sin permiso no puede cambiar ningún rol, ni el propio';

  -- ── Actuar como un usuario AJENO (ni siquiera integrante) ────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);

  -- ── Caso 8: un ajeno tampoco ──────────────────────────────────
  update public.club_members set rol = 'capitan' where id = v_miembro_a2;
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then
    raise exception 'FALLÓ (caso 8): un usuario ajeno no debería poder cambiar roles (afectó % filas)', v_filas;
  end if;
  raise notice 'OK (caso 8): un usuario ajeno no puede cambiar roles';

  -- ── Actuar como el administrador del club B (EL BUG A CORROBORAR) ─
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text);

  -- ── Caso 4: administrar el club B no da permiso sobre el club A ──
  -- Antes de la 90, `club_members_update` resolvía `club_id` sin
  -- calificar DENTRO de la subconsulta (contra su propio alias `m`), así
  -- que esta condición daba siempre verdadero para cualquier admin de
  -- cualquier club. Este es el caso que lo habría detectado.
  update public.club_members set rol = 'capitan' where id = v_miembro_a2;
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then
    raise exception 'FALLÓ (caso 4): el administrador del club B no debería poder cambiar roles del club A (afectó % filas) — bug de RLS cruzado sin corregir', v_filas;
  end if;
  select rol into v_rol from public.club_members where id = v_miembro_a2;
  if v_rol is distinct from 'capitan' then
    -- v_miembro_a2 ya había quedado en 'capitan' por el caso 5; sigue así.
    raise exception 'FALLÓ (caso 4): el rol de miembro_a2 cambió inesperadamente a %', v_rol;
  end if;
  raise notice 'OK (caso 4): administrar un club no da permiso para cambiar roles de otro club (bug de RLS cruzado corregido)';

  raise notice 'TODAS LAS PRUEBAS DEL CAPITÁN DEL EQUIPO PASARON';
end $$;

rollback;
