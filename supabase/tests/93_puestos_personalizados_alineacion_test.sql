-- =============================================================
-- FutFinder — pruebas de los puestos personalizados (migración 93)
--
-- QUÉ CUBRE:
--   1. La columna existe, no acepta null y por defecto es un objeto vacío.
--   2. Se puede guardar un puesto arrastrado a mano junto con el resto de
--      la alineación.
--   3. Sigue rigiendo la misma RLS de `club_lineups`: un jugador sin
--      admin/capitán no puede guardar puestos personalizados.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run, en un proyecto de desarrollo, con las migraciones 92 y
-- 93 ya aplicadas. Todo pasa dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

do $$
declare
  v_admin_a   uuid := gen_random_uuid();
  v_jugador_a uuid := gen_random_uuid();
  v_club_a    uuid := gen_random_uuid();

  v_puestos jsonb;
  v_filas   int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin_a,   'authenticated', 'authenticated', 'puestos-admin-a-'   || v_admin_a   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_a, 'authenticated', 'authenticated', 'puestos-jugador-a-' || v_jugador_a || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  insert into public.clubs (id, nombre, slug, created_by) values
    (v_club_a, 'Puestos Club A ' || left(v_club_a::text, 8), 'puestos-club-a-' || left(v_club_a::text, 8), v_admin_a);

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_admin_a,   'admin'),
    (v_club_a, v_jugador_a, 'jugador');

  -- ── Caso 1: default en una alineación sin personalizar ───────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);

  insert into public.club_lineups (club_id, modo, formacion, asignaciones, updated_by)
  values (v_club_a, 7, '2-3-1', '{}'::jsonb, v_admin_a);

  select puestos_personalizados into v_puestos from public.club_lineups where club_id = v_club_a;
  if v_puestos is distinct from '{}'::jsonb then
    raise exception 'FALLÓ (caso 1): sin arrastrar nada, puestos_personalizados debería quedar en {}';
  end if;
  raise notice 'OK (caso 1): por defecto no hay puestos personalizados';

  -- ── Caso 2: guardar un puesto arrastrado a mano ──────────────
  update public.club_lineups
     set personalizado = true,
         puestos_personalizados = jsonb_build_object('l0p0', jsonb_build_object('left', 33.5, 'top', 71.2, 'label', 'DFC')),
         updated_by = v_admin_a
   where club_id = v_club_a;

  select puestos_personalizados into v_puestos from public.club_lineups where club_id = v_club_a;
  if (v_puestos->'l0p0'->>'label') is distinct from 'DFC' then
    raise exception 'FALLÓ (caso 2): debería haber guardado el puesto arrastrado con su etiqueta recalculada';
  end if;
  raise notice 'OK (caso 2): se guarda un puesto personalizado junto con la alineación';

  -- ── Caso 3: un jugador sin admin/capitán no puede tocarlo ────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);

  update public.club_lineups
     set puestos_personalizados = '{}'::jsonb, updated_by = v_jugador_a
   where club_id = v_club_a;
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then
    raise exception 'FALLÓ (caso 3): un jugador sin admin ni capitán no debería poder modificar los puestos personalizados';
  end if;
  raise notice 'OK (caso 3): sigue rigiendo la misma RLS de club_lineups';

  raise notice 'TODAS LAS PRUEBAS DE LOS PUESTOS PERSONALIZADOS PASARON';
end $$;

rollback;
