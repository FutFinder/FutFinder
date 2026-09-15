-- =============================================================
-- FutFinder — pruebas de que `anon` no ejecuta el bloqueo (migración 95)
--
-- Qué cubre:
--   1. `anon` NO puede ejecutar is_blocked_pair. Es la que importa: no
--      tiene guarda de auth.uid(), así que antes de la 95 cualquiera con
--      la clave anon podía sondear el grafo de bloqueos.
--   2. `anon` tampoco puede ejecutar bloquear_usuario ni
--      desbloquear_usuario.
--   3. `authenticated` SÍ conserva las tres.
--   4. Bloquear y desbloquear siguen funcionando de punta a punta con
--      sesión: la 95 no rompió nada de la 51.
--   5. Una solicitud de amistad normal (sin bloqueo de por medio) sigue
--      pasando. Esto prueba que `authenticated` puede evaluar
--      is_blocked_pair DENTRO de la policy friendships_insert; si la 95
--      hubiera revocado de más, acá se caería con insufficient_privilege.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado. Si algún caso falla, la
-- ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_a_id uuid := gen_random_uuid();
  v_b_id uuid := gen_random_uuid();
  v_count int;
  v_pudo boolean;
  v_dummy boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_a_id, 'authenticated', 'authenticated', 'anon95-a-' || v_a_id || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_b_id, 'authenticated', 'authenticated', 'anon95-b-' || v_b_id || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  -- ── Caso 1: anon no puede sondear el grafo de bloqueos ────────
  execute format('set local role anon');
  begin
    select public.is_blocked_pair(v_a_id, v_b_id) into v_dummy;
    v_pudo := true;
  exception when insufficient_privilege then
    v_pudo := false;
  end;
  if v_pudo then
    raise exception 'FALLÓ (caso 1): anon no debería poder ejecutar is_blocked_pair';
  end if;
  raise notice 'OK (caso 1): anon no puede sondear is_blocked_pair';

  -- ── Caso 2: tampoco las otras dos ─────────────────────────────
  begin
    perform public.bloquear_usuario(v_b_id);
    v_pudo := true;
  exception
    when insufficient_privilege then v_pudo := false;
  end;
  if v_pudo then
    raise exception 'FALLÓ (caso 2a): anon no debería poder ejecutar bloquear_usuario';
  end if;

  begin
    perform public.desbloquear_usuario(v_b_id);
    v_pudo := true;
  exception
    when insufficient_privilege then v_pudo := false;
  end;
  if v_pudo then
    raise exception 'FALLÓ (caso 2b): anon no debería poder ejecutar desbloquear_usuario';
  end if;
  raise notice 'OK (caso 2): anon no puede bloquear ni desbloquear';

  -- ── Caso 3 y 4: con sesión, todo sigue igual que en la 51 ─────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a_id, 'role', 'authenticated')::text);

  if public.is_blocked_pair(v_a_id, v_b_id) then
    raise exception 'FALLÓ (caso 3): A y B no deberían estar bloqueados todavía';
  end if;
  raise notice 'OK (caso 3): authenticated conserva is_blocked_pair';

  perform public.bloquear_usuario(v_b_id);
  select count(*) into v_count from public.blocked_users
   where blocker_id = v_a_id and blocked_id = v_b_id;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 4a): bloquear con sesión debería seguir funcionando';
  end if;

  perform public.desbloquear_usuario(v_b_id);
  select count(*) into v_count from public.blocked_users
   where blocker_id = v_a_id and blocked_id = v_b_id;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 4b): desbloquear con sesión debería seguir funcionando';
  end if;
  raise notice 'OK (caso 4): bloquear y desbloquear siguen funcionando con sesión';

  -- ── Caso 5: la policy friendships_insert sigue evaluable ──────
  -- Si la 95 hubiera revocado is_blocked_pair de `authenticated`, este
  -- insert moriría con insufficient_privilege en vez de pasar.
  insert into public.friendships (requester_id, addressee_id, status)
  values (v_a_id, v_b_id, 'pending');
  select count(*) into v_count from public.friendships
   where requester_id = v_a_id and addressee_id = v_b_id;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 5): una solicitud de amistad normal debería pasar';
  end if;
  raise notice 'OK (caso 5): friendships_insert sigue pudiendo evaluar is_blocked_pair';

  raise notice 'TODAS LAS PRUEBAS DE ANON SIN BLOQUEO PASARON';
end $$;

rollback;
