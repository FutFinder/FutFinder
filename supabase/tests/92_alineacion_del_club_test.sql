-- =============================================================
-- FutFinder — pruebas de la alineación del club (migración 92)
--
-- QUÉ CUBRE:
--   1. Un administrador guarda (INSERT) la alineación por primera vez.
--   2. Un administrador la vuelve a guardar (UPDATE): se sobrescribe, no
--      se crea una segunda fila (PK en club_id).
--   3. Un capitán también puede guardarla.
--   4. Un jugador sin admin/capitán NO puede guardarla ni modificarla.
--   5. Un jugador SÍ puede leerla.
--   6. Alguien ajeno al club no puede leerla (RLS, cero filas).
--   7. Alguien ajeno al club tampoco puede escribirla.
--   8. El administrador de OTRO club no puede tocar la alineación de este
--      club (regresión del mismo bug de auto-referencia que la 90 corrigió
--      en `club_members_update`; acá la tabla nace con la calificación
--      correcta, y este caso lo demuestra).
--   9. `modo` fuera de {7, 11} lo rechaza el CHECK.
--  10. Nadie puede guardar la alineación con `updated_by` de otra persona.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run, en un proyecto de desarrollo, con la migración 92
-- ya aplicada. Todo pasa dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

do $$
declare
  v_admin_a    uuid := gen_random_uuid();
  v_capitan_a  uuid := gen_random_uuid();
  v_jugador_a  uuid := gen_random_uuid();
  v_admin_b    uuid := gen_random_uuid();
  v_ajeno      uuid := gen_random_uuid();

  v_club_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();

  v_miembro_a uuid;

  v_formacion text;
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
    ('00000000-0000-0000-0000-000000000000', v_admin_a,   'authenticated', 'authenticated', 'lineup-admin-a-'   || v_admin_a   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_capitan_a, 'authenticated', 'authenticated', 'lineup-capitan-a-' || v_capitan_a || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_a, 'authenticated', 'authenticated', 'lineup-jugador-a-' || v_jugador_a || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_admin_b,   'authenticated', 'authenticated', 'lineup-admin-b-'   || v_admin_b   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_ajeno,     'authenticated', 'authenticated', 'lineup-ajeno-'     || v_ajeno     || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  insert into public.clubs (id, nombre, slug, created_by) values
    (v_club_a, 'Alineación Club A ' || left(v_club_a::text, 8), 'alineacion-club-a-' || left(v_club_a::text, 8), v_admin_a),
    (v_club_b, 'Alineación Club B ' || left(v_club_b::text, 8), 'alineacion-club-b-' || left(v_club_b::text, 8), v_admin_b);

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_admin_a,   'admin'),
    (v_club_a, v_capitan_a, 'capitan'),
    (v_club_a, v_jugador_a, 'jugador'),
    (v_club_b, v_admin_b,   'admin');

  select id into v_miembro_a from public.club_members where club_id = v_club_a and user_id = v_jugador_a;

  -- ── Actuar como el administrador del club A ──────────────────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);

  -- ── Caso 1: primer guardado (INSERT) ──────────────────────────
  insert into public.club_lineups (club_id, modo, formacion, asignaciones, updated_by)
  values (v_club_a, 11, '4-3-3', jsonb_build_object('gk', v_miembro_a::text), v_admin_a);
  select formacion into v_formacion from public.club_lineups where club_id = v_club_a;
  if v_formacion is distinct from '4-3-3' then
    raise exception 'FALLÓ (caso 1): el administrador debería poder guardar la primera alineación';
  end if;
  raise notice 'OK (caso 1): el administrador guarda la alineación por primera vez';

  -- ── Caso 2: segundo guardado (UPDATE), sobrescribe ───────────
  update public.club_lineups
     set modo = 7, formacion = '2-3-1', asignaciones = '{}'::jsonb, updated_by = v_admin_a
   where club_id = v_club_a;
  if (select count(*) from public.club_lineups where club_id = v_club_a) <> 1 then
    raise exception 'FALLÓ (caso 2): debería seguir habiendo una sola fila para el club A';
  end if;
  select formacion into v_formacion from public.club_lineups where club_id = v_club_a;
  if v_formacion is distinct from '2-3-1' then
    raise exception 'FALLÓ (caso 2): la alineación debería haberse sobrescrito a 2-3-1';
  end if;
  raise notice 'OK (caso 2): guardar de nuevo sobrescribe, no duplica';

  -- ── Caso 10: no se puede guardar con el updated_by de otra persona ─
  begin
    update public.club_lineups set updated_by = v_jugador_a where club_id = v_club_a;
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 10): no debería poder guardar con el updated_by de otra persona';
  end if;
  raise notice 'OK (caso 10): el WITH CHECK exige updated_by = auth.uid()';

  -- ── Actuar como el capitán del club A ─────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_capitan_a, 'role', 'authenticated')::text);

  -- ── Caso 3: el capitán también puede guardarla ───────────────
  update public.club_lineups
     set formacion = '3-2-1', updated_by = v_capitan_a
   where club_id = v_club_a;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'FALLÓ (caso 3): el capitán debería poder guardar la alineación';
  end if;
  raise notice 'OK (caso 3): el capitán guarda la alineación';

  -- ── Actuar como un jugador SIN admin ni capitán ──────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);

  -- ── Caso 4: un jugador no puede modificarla ──────────────────
  update public.club_lineups set formacion = '1-4-1' where club_id = v_club_a;
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then
    raise exception 'FALLÓ (caso 4): un jugador sin admin ni capitán no debería poder guardar (afectó % filas)', v_filas;
  end if;
  raise notice 'OK (caso 4): un jugador sin permiso no puede modificar la alineación';

  -- ── Caso 5: un jugador SÍ puede leerla ────────────────────────
  select formacion into v_formacion from public.club_lineups where club_id = v_club_a;
  if v_formacion is distinct from '3-2-1' then
    raise exception 'FALLÓ (caso 5): un jugador del club debería poder leer la alineación';
  end if;
  raise notice 'OK (caso 5): un jugador lee la alineación de su club';

  -- ── Actuar como alguien ajeno al club ─────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);

  -- ── Caso 6: un ajeno no ve la alineación (RLS, cero filas) ───
  if exists (select 1 from public.club_lineups where club_id = v_club_a) then
    raise exception 'FALLÓ (caso 6): alguien ajeno al club no debería poder leer su alineación';
  end if;
  raise notice 'OK (caso 6): alguien ajeno no lee la alineación (RLS le devuelve cero filas)';

  -- ── Caso 7: un ajeno tampoco puede escribirla ────────────────
  begin
    insert into public.club_lineups (club_id, modo, formacion, updated_by)
    values (v_club_a, 7, '3-3', v_ajeno)
    on conflict (club_id) do update set formacion = '3-3', updated_by = v_ajeno;
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 7): alguien ajeno al club no debería poder escribir su alineación';
  end if;
  raise notice 'OK (caso 7): alguien ajeno no puede escribir la alineación';

  -- ── Actuar como el administrador del club B (EL BUG A CORROBORAR) ─
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text);

  -- ── Caso 8: administrar el club B no da permiso sobre el club A ──
  update public.club_lineups set formacion = 'hackeada', updated_by = v_admin_b where club_id = v_club_a;
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then
    raise exception 'FALLÓ (caso 8): el administrador del club B no debería poder tocar la alineación del club A (afectó % filas)', v_filas;
  end if;
  select formacion into v_formacion from public.club_lineups where club_id = v_club_a;
  -- Como admin_b no puede ni leer la fila (RLS), esto debe dar null, no un valor cambiado.
  if v_formacion is not null then
    raise exception 'FALLÓ (caso 8): admin_b no debería poder ver ni haber cambiado la formación del club A';
  end if;
  raise notice 'OK (caso 8): administrar un club no da permiso sobre la alineación de otro club';

  -- ── Volver a admin_a para el CHECK de modo ───────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);

  -- ── Caso 9: modo fuera de {7, 11} lo rechaza el CHECK ────────
  begin
    update public.club_lineups set modo = 9, updated_by = v_admin_a where club_id = v_club_a;
    v_rechazado := false;
  exception when check_violation then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 9): el CHECK debería rechazar un modo que no sea 7 ni 11';
  end if;
  raise notice 'OK (caso 9): el servidor rechaza un modo inválido';

  raise notice 'TODAS LAS PRUEBAS DE LA ALINEACIÓN DEL CLUB PASARON';
end $$;

rollback;
