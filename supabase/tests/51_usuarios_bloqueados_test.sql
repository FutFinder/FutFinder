-- =============================================================
-- FutFinder — pruebas manuales de bloqueo de usuarios (migración 51)
--
-- Qué cubre:
--   1. A bloquea a B con bloquear_usuario(): queda una fila en
--      blocked_users con blocker_id = A.
--   2. B no puede ver esa fila (RLS de blocked_users solo deja ver al
--      bloqueador) ni tampoco borrarla actuando como B.
--   3. Con el bloqueo activo, B ya no puede enviarle una solicitud de
--      amistad a A (ni A a B): la RLS de friendships_insert lo rechaza
--      en las dos direcciones.
--   4. Si A y B ya eran amigos ('accepted'), bloquear pasa esa fila a
--      'blocked' (el mismo valor que ya sabía mostrar messages.js).
--   5. desbloquear_usuario() borra la fila de blocked_users y limpia la
--      fila de friendships que quedó en 'blocked', dejando el camino
--      libre para una solicitud nueva.
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
  v_a_id      uuid := gen_random_uuid();
  v_b_id      uuid := gen_random_uuid();
  v_c_id      uuid := gen_random_uuid();
  v_count     int;
  v_status    text;
  v_inserted  boolean;
begin
  -- ── Setup: usuarios de prueba ────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_a_id, 'authenticated', 'authenticated', 'block-test-a-' || v_a_id || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_b_id, 'authenticated', 'authenticated', 'block-test-b-' || v_b_id || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_c_id, 'authenticated', 'authenticated', 'block-test-c-' || v_c_id || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  -- A y C ya son amigos, para probar el caso 4 (accepted -> blocked).
  insert into public.friendships (requester_id, addressee_id, status)
  values (v_a_id, v_c_id, 'accepted');

  -- ── Actuar como A: bloquea a B ────────────────────────────────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a_id, 'role', 'authenticated')::text);

  perform public.bloquear_usuario(v_b_id);

  select count(*) into v_count
  from public.blocked_users
  where blocker_id = v_a_id and blocked_id = v_b_id;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 1): debería quedar una fila blocked_users con A como bloqueador';
  end if;
  raise notice 'OK (caso 1): A bloqueó a B';

  -- ── Caso 4: A y C ya eran amigos; A bloquea a C ───────────────
  perform public.bloquear_usuario(v_c_id);
  select status into v_status
  from public.friendships
  where requester_id = v_a_id and addressee_id = v_c_id;
  if v_status <> 'blocked' then
    raise exception 'FALLÓ (caso 4): la amistad A-C debería pasar a blocked, quedó en %', v_status;
  end if;
  raise notice 'OK (caso 4): la amistad existente pasó a blocked al bloquear';

  -- ── Actuar como B: no ve la fila que lo bloqueó, ni la borra ──
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b_id, 'role', 'authenticated')::text);

  select count(*) into v_count
  from public.blocked_users
  where blocked_id = v_b_id;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 2a): B no debería poder ver que lo bloquearon';
  end if;
  raise notice 'OK (caso 2a): B no ve el bloqueo';

  delete from public.blocked_users where blocker_id = v_a_id and blocked_id = v_b_id;
  select count(*) into v_count
  from public.blocked_users
  where blocker_id = v_a_id and blocked_id = v_b_id;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 2b): B no debería poder borrar el bloqueo de A hacia B';
  end if;
  raise notice 'OK (caso 2b): B no puede borrar el bloqueo';

  -- ── Caso 3: con el bloqueo activo, B no puede pedir amistad a A ──
  begin
    insert into public.friendships (requester_id, addressee_id, status)
    values (v_b_id, v_a_id, 'pending');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 3): B no debería poder enviarle una solicitud a A estando bloqueado';
  end if;
  raise notice 'OK (caso 3): la solicitud de B hacia A fue rechazada por RLS';

  -- ── Actuar como A de nuevo: desbloquea a B ────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a_id, 'role', 'authenticated')::text);

  perform public.desbloquear_usuario(v_b_id);

  select count(*) into v_count
  from public.blocked_users
  where blocker_id = v_a_id and blocked_id = v_b_id;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 5a): desbloquear_usuario debería borrar la fila de blocked_users';
  end if;
  raise notice 'OK (caso 5a): el bloqueo se deshizo';

  select count(*) into v_count
  from public.friendships
  where (requester_id = v_a_id and addressee_id = v_b_id)
     or (requester_id = v_b_id and addressee_id = v_a_id);
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 5b): no debería quedar ninguna fila de friendships entre A y B tras desbloquear';
  end if;
  raise notice 'OK (caso 5b): no quedó rastro en friendships, se puede volver a pedir amistad';

  raise notice 'TODAS LAS PRUEBAS DE BLOQUEO DE USUARIOS PASARON';
end $$;

rollback;
