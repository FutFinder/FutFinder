-- =============================================================
-- FutFinder — pruebas de la migración 140
--
-- Qué cubre:
--   1. Una cuenta con sesión NO puede crear un aviso para otra llamando a
--      `create_notification`. Antes de la 140, sí: y el aviso salía como
--      push.
--   2. anon tampoco (lo cerró la 98; se vuelve a comprobar).
--   3. El camino interno sigue vivo: una solicitud de amistad dispara
--      trg_notify_friend_request, que llama a create_notification por
--      dentro, y el aviso se crea.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado. Si algún caso falla, la
-- ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_tipo text;
  v_n int;
  v_pudo boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_a, 'authenticated','authenticated','m140-a-' || v_a || '@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''),
    ('00000000-0000-0000-0000-000000000000', v_b, 'authenticated','authenticated','m140-b-' || v_b || '@futfinder.test','x',now(),now(),now(),'{}','{}','','','','');

  select substring(pg_get_constraintdef(oid) from '''([a-z_]+)''') into v_tipo
    from pg_constraint where conname = 'notifications_type_check';

  -- ── Caso 1: con sesión no se notifica a otro ──────────────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  begin
    perform public.create_notification(v_b, v_tipo, 'Tu cuenta será suspendida', 'Entra aquí', '{}'::jsonb);
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false;
  end;
  reset role;
  if v_pudo then
    raise exception 'FALLÓ (caso 1): una cuenta con sesión creó un aviso para otra';
  end if;
  raise notice 'OK (caso 1): authenticated no puede llamar a create_notification';

  -- ── Caso 2: anon tampoco ──────────────────────────────────────
  set local role anon;
  begin
    perform public.create_notification(v_b, v_tipo, 'Phishing', 'No debería llegar', '{}'::jsonb);
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false;
  end;
  reset role;
  if v_pudo then
    raise exception 'FALLÓ (caso 2): anon pudo crear un aviso';
  end if;
  raise notice 'OK (caso 2): anon no puede llamar a create_notification';

  -- ── Caso 3: el camino interno sigue vivo ──────────────────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  insert into public.friendships (requester_id, addressee_id, status)
  values (v_a, v_b, 'pending');
  reset role;
  select count(*) into v_n from public.notifications where user_id = v_b;
  if v_n = 0 then
    raise exception 'FALLÓ (caso 3): la solicitud de amistad no creó el aviso; la 140 revocó de más';
  end if;
  raise notice 'OK (caso 3): los avisos que crea el servidor siguen llegando';

  raise notice 'TODAS LAS PRUEBAS DE LA MIGRACIÓN 140 PASARON';
end $$;

rollback;
