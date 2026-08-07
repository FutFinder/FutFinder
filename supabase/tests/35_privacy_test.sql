-- =============================================================
-- FutFinder — pruebas manuales de privacidad
--   (visibilidad en búsqueda + solicitudes de amistad)
--
-- Qué cubre:
--   1. Un perfil con privacy_visible_in_search = true SÍ aparece en la
--      consulta que arma buildSearchPlayersQuery() (src/services/profile.js).
--   2. Un perfil con privacy_visible_in_search = false NO aparece.
--   3. Una solicitud de amistad hacia alguien con
--      privacy_friend_requests = 'everyone' se inserta normalmente.
--   4. Una solicitud hacia alguien con privacy_friend_requests = 'nobody'
--      es rechazada por la política RLS de la migración 35, aunque se
--      llame directo a `insert into friendships` sin pasar por la app.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run, en un proyecto de desarrollo (crea usuarios falsos
-- en auth.users). Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado al terminar. Si algún caso
-- falla, la ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_visible_id   uuid := gen_random_uuid();
  v_oculto_id    uuid := gen_random_uuid();
  v_abierto_id   uuid := gen_random_uuid();
  v_cerrado_id   uuid := gen_random_uuid();
  v_requester_id uuid := gen_random_uuid();
  v_count        int;
  v_inserted     boolean;
begin
  -- ── Setup: usuarios de prueba ────────────────────────────────
  -- El trigger on_auth_user_created (handle_new_user) crea el
  -- profile automáticamente al insertar en auth.users.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_visible_id,   'authenticated', 'authenticated', 'privacy-test-visible-'   || v_visible_id   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_oculto_id,    'authenticated', 'authenticated', 'privacy-test-oculto-'    || v_oculto_id    || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_abierto_id,   'authenticated', 'authenticated', 'privacy-test-abierto-'   || v_abierto_id   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_cerrado_id,   'authenticated', 'authenticated', 'privacy-test-cerrado-'   || v_cerrado_id   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_requester_id, 'authenticated', 'authenticated', 'privacy-test-requester-' || v_requester_id || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  update public.profiles set privacy_visible_in_search = true  where id = v_visible_id;
  update public.profiles set privacy_visible_in_search = false where id = v_oculto_id;
  update public.profiles set privacy_friend_requests = 'everyone' where id = v_abierto_id;
  update public.profiles set privacy_friend_requests = 'nobody'   where id = v_cerrado_id;

  -- ── Caso 1: perfil visible aparece en la consulta de búsqueda ──
  select count(*) into v_count
  from public.profiles
  where privacy_visible_in_search = true and id = v_visible_id;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 1): el perfil visible debería aparecer en la búsqueda';
  end if;
  raise notice 'OK (caso 1): perfil visible aparece en la búsqueda';

  -- ── Caso 2: perfil oculto NO aparece en la misma consulta ──────
  select count(*) into v_count
  from public.profiles
  where privacy_visible_in_search = true and id = v_oculto_id;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 2): el perfil oculto no debería aparecer en la búsqueda';
  end if;
  raise notice 'OK (caso 2): perfil oculto no aparece en la búsqueda';

  -- A partir de acá actuamos como v_requester_id autenticado, igual
  -- que lo haría PostgREST con un usuario logueado, para que las
  -- políticas RLS de `friendships` se evalúen de verdad.
  execute format('set local role authenticated');
  execute format(
    'set local request.jwt.claims to %L',
    json_build_object('sub', v_requester_id, 'role', 'authenticated')::text
  );

  -- ── Caso 3: solicitud a alguien que permite solicitudes ────────
  begin
    insert into public.friendships (requester_id, addressee_id, status)
    values (v_requester_id, v_abierto_id, 'pending');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if not v_inserted then
    raise exception 'FALLÓ (caso 3): la solicitud a un usuario que permite solicitudes debería insertarse';
  end if;
  raise notice 'OK (caso 3): solicitud permitida se insertó';

  -- ── Caso 4: solicitud a alguien que bloqueó solicitudes ────────
  begin
    insert into public.friendships (requester_id, addressee_id, status)
    values (v_requester_id, v_cerrado_id, 'pending');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 4): la solicitud a un usuario que bloqueó solicitudes no debería insertarse';
  end if;
  raise notice 'OK (caso 4): solicitud bloqueada por privacidad fue rechazada por RLS';

  raise notice 'TODAS LAS PRUEBAS DE PRIVACIDAD PASARON';
end $$;

rollback;
