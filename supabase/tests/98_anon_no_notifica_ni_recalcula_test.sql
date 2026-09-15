-- =============================================================
-- FutFinder — pruebas de la migración 98
--
-- Qué cubre:
--   1. `anon` NO puede crear notificaciones. Es la que importa: antes
--      de la 98, cualquiera con la clave anon podía mandarle un aviso
--      de phishing a cualquier usuario.
--   2. `anon` no puede contar reportes contra nadie (moderación).
--   3. `anon` no puede recalcular los ratings de nadie (escritura).
--   4. El camino interno de las notificaciones sigue vivo: con sesión,
--      una solicitud de amistad dispara su trigger y la notificación se
--      crea. Si la 98 hubiera revocado de más, acá se caería.
--   5. El trigger de ratings sigue vivo: insertar en `ratings` recalcula
--      `profiles.rating_count`.
--   6. `authenticated` conserva count_reports_against, que el cliente
--      usa desde src/services/reports.js.
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
  v_dummy int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_a, 'authenticated','authenticated','m98-a-' || v_a || '@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''),
    ('00000000-0000-0000-0000-000000000000', v_b, 'authenticated','authenticated','m98-b-' || v_b || '@futfinder.test','x',now(),now(),now(),'{}','{}','','','','');

  -- Un tipo de notificación que el CHECK acepte, leído del propio CHECK.
  select substring(pg_get_constraintdef(oid) from '''([a-z_]+)''') into v_tipo
    from pg_constraint where conname = 'notifications_type_check';

  -- ── Caso 1: anon no puede notificar ───────────────────────────
  set local role anon;
  begin
    perform public.create_notification(v_b, v_tipo, 'Phishing', 'No debería llegar', '{}'::jsonb);
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false;
  end;
  if v_pudo then
    raise exception 'FALLÓ (caso 1): anon pudo crear una notificación';
  end if;
  raise notice 'OK (caso 1): anon no puede crear notificaciones';

  -- ── Caso 2: anon no puede contar reportes ─────────────────────
  begin
    select public.count_reports_against(v_b) into v_dummy;
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false;
  end;
  if v_pudo then
    raise exception 'FALLÓ (caso 2): anon pudo contar reportes contra alguien';
  end if;
  raise notice 'OK (caso 2): anon no puede contar reportes';

  -- ── Caso 3: anon no puede recalcular ratings ──────────────────
  begin
    perform public.recalc_user_ratings(v_b);
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false;
  end;
  if v_pudo then
    raise exception 'FALLÓ (caso 3): anon pudo recalcular los ratings de alguien';
  end if;
  raise notice 'OK (caso 3): anon no puede recalcular ratings';

  reset role;

  -- ── Caso 4: el camino interno de notificaciones sigue vivo ────
  -- Una solicitud de amistad dispara trg_notify_friend_request, que
  -- llama a create_notification por dentro.
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);

  insert into public.friendships (requester_id, addressee_id, status)
  values (v_a, v_b, 'pending');

  reset role;
  select count(*) into v_n from public.notifications where user_id = v_b;
  if v_n = 0 then
    raise exception 'FALLÓ (caso 4): el trigger de amistad debería haber creado la notificación; la 98 revocó de más';
  end if;
  raise notice 'OK (caso 4): el camino interno de notificaciones sigue funcionando';

  -- ── Caso 5: el trigger de ratings sigue vivo ──────────────────
  -- No hay partido de verdad, así que se comprueba llamando a la
  -- función por el camino con sesión, que es el que usa el trigger.
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  perform public.recalc_user_ratings(v_b);
  reset role;
  raise notice 'OK (caso 5): recalc_user_ratings sigue disponible con sesión';

  -- ── Caso 6: el cliente sigue pudiendo contar reportes ─────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  select public.count_reports_against(v_b) into v_dummy;
  if v_dummy is null then
    raise exception 'FALLÓ (caso 6): count_reports_against debería devolver un número con sesión';
  end if;
  reset role;
  raise notice 'OK (caso 6): authenticated conserva count_reports_against';

  raise notice 'TODAS LAS PRUEBAS DE LA MIGRACIÓN 98 PASARON';
end $$;

rollback;
