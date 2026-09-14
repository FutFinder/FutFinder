-- =============================================================
-- FutFinder — pruebas del apodo dentro del club (migración 91)
--
-- QUÉ CUBRE:
--   1. Un integrante puede ponerse su propio apodo.
--   2. Un administrador puede ponerle apodo a otro integrante.
--   3. Un integrante SIN administrar no puede cambiar el apodo de otro
--      (sólo el propio).
--   4. Vaciar el apodo lo QUITA (borra la fila), no lo deja en blanco.
--   5. Un apodo de más de 18 caracteres lo rechaza la función.
--   6. Un compañero de club SÍ puede leer el apodo.
--   7. Alguien AJENO al club NO puede leerlo — RLS le devuelve cero filas,
--      no un error, que es la forma en que Postgres esconde una fila.
--   8. Alguien que ni siquiera es integrante no puede escribir el apodo
--      de nadie (la función corta antes de tocar la tabla).
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run, en un proyecto de desarrollo, con la migración 91
-- ya aplicada. Todo pasa dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

do $$
declare
  v_admin_a    uuid := gen_random_uuid();
  v_jugador_a1 uuid := gen_random_uuid();
  v_jugador_a2 uuid := gen_random_uuid();
  v_ajeno      uuid := gen_random_uuid();

  v_club_a uuid := gen_random_uuid();

  v_miembro_a1 uuid;
  v_miembro_a2 uuid;

  v_apodo     text;
  v_resultado json;
  v_rechazado boolean;
  v_filas     int;
begin
  -- ── Setup: usuarios ───────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin_a,    'authenticated', 'authenticated', 'apodo-admin-a-'    || v_admin_a    || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_a1, 'authenticated', 'authenticated', 'apodo-jugador-a1-' || v_jugador_a1 || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_a2, 'authenticated', 'authenticated', 'apodo-jugador-a2-' || v_jugador_a2 || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_ajeno,      'authenticated', 'authenticated', 'apodo-ajeno-'      || v_ajeno      || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  insert into public.clubs (id, nombre, slug, created_by) values
    (v_club_a, 'Apodo Club A ' || left(v_club_a::text, 8), 'apodo-club-a-' || left(v_club_a::text, 8), v_admin_a);

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_admin_a,    'admin'),
    (v_club_a, v_jugador_a1, 'jugador'),
    (v_club_a, v_jugador_a2, 'jugador');

  select id into v_miembro_a1 from public.club_members where club_id = v_club_a and user_id = v_jugador_a1;
  select id into v_miembro_a2 from public.club_members where club_id = v_club_a and user_id = v_jugador_a2;

  -- ── Actuar como jugador_a1 ────────────────────────────────────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a1, 'role', 'authenticated')::text);

  -- ── Caso 1: se pone su propio apodo ───────────────────────────
  v_resultado := public.set_apodo_club(v_miembro_a1, 'El Muro');
  if (v_resultado->>'apodo') is distinct from 'El Muro' then
    raise exception 'FALLÓ (caso 1): debería poder ponerse su propio apodo, devolvió %', v_resultado;
  end if;
  select apodo into v_apodo from public.club_member_apodos where member_id = v_miembro_a1;
  if v_apodo is distinct from 'El Muro' then
    raise exception 'FALLÓ (caso 1): el apodo guardado debería ser «El Muro», quedó en %', v_apodo;
  end if;
  raise notice 'OK (caso 1): un integrante se pone su propio apodo';

  -- ── Caso 3: jugador_a1 NO puede ponerle apodo a jugador_a2 ────
  begin
    perform public.set_apodo_club(v_miembro_a2, 'Intento ajeno');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 3): un integrante sin administrar no debería poder cambiar el apodo de otro';
  end if;
  if exists (select 1 from public.club_member_apodos where member_id = v_miembro_a2) then
    raise exception 'FALLÓ (caso 3): no debería haber quedado ningún apodo para jugador_a2';
  end if;
  raise notice 'OK (caso 3): un integrante sin administrar no cambia el apodo de otro';

  -- ── Caso 5: un apodo demasiado largo se rechaza ──────────────
  begin
    perform public.set_apodo_club(v_miembro_a1, 'Un apodo absurdamente largo que no cabe');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 5): un apodo de más de 18 caracteres debería rechazarse';
  end if;
  raise notice 'OK (caso 5): un apodo demasiado largo se rechaza';

  -- ── Actuar como el administrador ──────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);

  -- ── Caso 2: el administrador SÍ puede ponerle apodo a otro ───
  v_resultado := public.set_apodo_club(v_miembro_a2, 'Rayo');
  if (v_resultado->>'apodo') is distinct from 'Rayo' then
    raise exception 'FALLÓ (caso 2): el administrador debería poder ponerle apodo a otro integrante';
  end if;
  raise notice 'OK (caso 2): el administrador le pone apodo a otro integrante';

  -- ── Caso 4: vaciar el apodo lo quita, no lo deja en blanco ───
  v_resultado := public.set_apodo_club(v_miembro_a2, '   ');
  if (v_resultado->>'apodo') is not null then
    raise exception 'FALLÓ (caso 4): vaciar el apodo debería devolver apodo=null, devolvió %', v_resultado;
  end if;
  get diagnostics v_filas = row_count;
  if exists (select 1 from public.club_member_apodos where member_id = v_miembro_a2) then
    raise exception 'FALLÓ (caso 4): no debería quedar ninguna fila de apodo para jugador_a2';
  end if;
  raise notice 'OK (caso 4): vaciar el apodo borra la fila, no la deja en blanco';

  -- ── Caso 6: un compañero de club sí puede LEER el apodo ──────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a2, 'role', 'authenticated')::text);
  select apodo into v_apodo from public.club_member_apodos where member_id = v_miembro_a1;
  if v_apodo is distinct from 'El Muro' then
    raise exception 'FALLÓ (caso 6): un compañero de club debería poder leer el apodo, leyó %', v_apodo;
  end if;
  raise notice 'OK (caso 6): un compañero de club lee el apodo';

  -- ── Actuar como alguien ajeno al club ─────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);

  -- ── Caso 7: un ajeno no ve el apodo (RLS, cero filas) ────────
  if exists (select 1 from public.club_member_apodos where member_id = v_miembro_a1) then
    raise exception 'FALLÓ (caso 7): alguien ajeno al club no debería poder leer el apodo';
  end if;
  raise notice 'OK (caso 7): alguien ajeno al club no lee el apodo (RLS le devuelve cero filas)';

  -- ── Caso 8: un ajeno tampoco puede escribirlo ────────────────
  begin
    perform public.set_apodo_club(v_miembro_a1, 'Intento externo');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 8): alguien que ni siquiera es integrante no debería poder escribir un apodo';
  end if;
  raise notice 'OK (caso 8): alguien ajeno al club no puede escribir un apodo';

  raise notice 'TODAS LAS PRUEBAS DEL APODO DENTRO DEL CLUB PASARON';
end $$;

rollback;
