-- =============================================================
-- FutFinder — pruebas manuales de fiabilidad del push (migración 38)
--
-- Qué cubre:
--   1. Una notificación nueva nace con push_status = 'pending'.
--   2. El "claim" atómico que usa send-push/index.ts (update ...
--      where push_status = 'pending' or (sending y vencido)) sólo
--      deja reclamar la fila una vez: un segundo intento inmediato
--      no encuentra fila para actualizar.
--   3. Un reclamo "sending" viejo (más de 2 minutos) sí se puede
--      volver a reclamar — recupera una invocación que se cayó a
--      mitad de camino.
--   4. push_status rechaza cualquier valor fuera del enum.
--   5. push_tickets no permite un ticket 'ok' sin ticket_id (dato
--      necesario para poder consultar el receipt después).
--   6. Un lote mixto de tickets (uno ok, uno error) para la misma
--      notificación conserva ambas filas de forma independiente.
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
  v_user_id     uuid := gen_random_uuid();
  v_notif_id    uuid;
  v_claimed_id  uuid;
  v_count       int;
  v_rejected    boolean;
begin
  -- ── Setup: usuario de prueba ─────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    'push-test-' || v_user_id || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
  );

  -- ── Caso 1: notificación nueva nace 'pending' ────────────────
  insert into public.notifications (user_id, type, title, body)
  values (v_user_id, 'match_join', 'Test', 'body de prueba')
  returning id into v_notif_id;

  if (select push_status from public.notifications where id = v_notif_id) <> 'pending' then
    raise exception 'FALLÓ (caso 1): push_status debería nacer en pending';
  end if;
  raise notice 'OK (caso 1): push_status nace en pending';

  -- ── Caso 2: el claim atómico sólo funciona una vez ───────────
  update public.notifications
     set push_status = 'sending', push_claimed_at = now()
   where id = v_notif_id
     and (push_status = 'pending'
          or (push_status = 'sending' and push_claimed_at < now() - interval '2 minutes'))
  returning id into v_claimed_id;

  if v_claimed_id is null then
    raise exception 'FALLÓ (caso 2): el primer claim debería tomar la fila';
  end if;
  raise notice 'OK (caso 2a): el primer claim tomó la fila';

  v_claimed_id := null;
  update public.notifications
     set push_status = 'sending', push_claimed_at = now()
   where id = v_notif_id
     and (push_status = 'pending'
          or (push_status = 'sending' and push_claimed_at < now() - interval '2 minutes'))
  returning id into v_claimed_id;

  if v_claimed_id is not null then
    raise exception 'FALLÓ (caso 2b): un segundo claim inmediato no debería tomar la misma fila (evita doble envío)';
  end if;
  raise notice 'OK (caso 2b): el reintento del webhook no volvió a reclamar la fila';

  -- ── Caso 3: un claim "sending" viejo se puede recuperar ──────
  update public.notifications
     set push_claimed_at = now() - interval '5 minutes'
   where id = v_notif_id;

  v_claimed_id := null;
  update public.notifications
     set push_status = 'sending', push_claimed_at = now()
   where id = v_notif_id
     and (push_status = 'pending'
          or (push_status = 'sending' and push_claimed_at < now() - interval '2 minutes'))
  returning id into v_claimed_id;

  if v_claimed_id is null then
    raise exception 'FALLÓ (caso 3): un claim "sending" de hace 5 minutos debería poder recuperarse';
  end if;
  raise notice 'OK (caso 3): se recuperó un claim abandonado (función caída a mitad de camino)';

  -- ── Caso 4: push_status rechaza valores fuera del enum ───────
  begin
    update public.notifications set push_status = 'no_existe' where id = v_notif_id;
    v_rejected := false;
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FALLÓ (caso 4): push_status debería rechazar valores fuera del enum';
  end if;
  raise notice 'OK (caso 4): push_status rechazó un valor inválido';

  update public.notifications set push_status = 'sent' where id = v_notif_id;

  -- ── Caso 5: un ticket 'ok' sin ticket_id no se puede insertar ─
  begin
    insert into public.push_tickets (notification_id, token, ticket_status, ticket_id)
    values (v_notif_id, 'ExponentPushToken[sin-id]', 'ok', null);
    v_rejected := false;
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FALLÓ (caso 5): un ticket ok sin ticket_id no debería poder guardarse';
  end if;
  raise notice 'OK (caso 5): se rechazó un ticket ok sin ticket_id';

  -- ── Caso 6: lote mixto guarda cada resultado por separado ────
  insert into public.push_tickets (notification_id, token, ticket_status, ticket_id, receipt_status)
  values
    (v_notif_id, 'ExponentPushToken[bueno]',  'ok',    'ticket-abc', 'pending'),
    (v_notif_id, 'ExponentPushToken[muerto]', 'error', null,         'skipped');

  select count(*) into v_count from public.push_tickets where notification_id = v_notif_id;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 6): deberían quedar 2 filas de ticket para la misma notificación';
  end if;
  raise notice 'OK (caso 6): el lote mixto guardó ambos resultados de forma independiente';

  raise notice 'TODAS LAS PRUEBAS DE FIABILIDAD DE PUSH PASARON';
end $$;

rollback;
