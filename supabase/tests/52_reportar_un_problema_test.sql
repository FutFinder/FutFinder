-- =============================================================
-- FutFinder — pruebas manuales de "Reportar un problema"
-- (migración 52: tabla support_tickets)
--
-- Qué cubre:
--   1. Un usuario autenticado puede insertar un ticket propio con una
--      categoría válida.
--   2. No puede insertar un ticket a nombre de otro usuario (RLS).
--   3. Una categoría fuera del CHECK es rechazada.
--   4. El autor puede leer su propio ticket.
--   5. NO puede leer el ticket de otro usuario (RLS de select).
--   6. No puede actualizar el estado de su propio ticket (no hay
--      política de UPDATE: eso es trabajo de soporte, con su rol).
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
  v_a_id     uuid := gen_random_uuid();
  v_b_id     uuid := gen_random_uuid();
  v_ticket_id uuid;
  v_count    int;
  v_inserted boolean;
begin
  -- ── Setup: usuarios de prueba ────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_a_id, 'authenticated', 'authenticated', 'ticket-test-a-' || v_a_id || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_b_id, 'authenticated', 'authenticated', 'ticket-test-b-' || v_b_id || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  -- ── Actuar como A ──────────────────────────────────────────────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a_id, 'role', 'authenticated')::text);

  -- ── Caso 1: A inserta un ticket propio con categoría válida ────
  insert into public.support_tickets (user_id, category, title, description)
  values (v_a_id, 'fallo_tecnico', 'La app se congela', 'Al abrir un partido')
  returning id into v_ticket_id;

  select count(*) into v_count from public.support_tickets where id = v_ticket_id;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 1): el ticket propio debería haberse insertado';
  end if;
  raise notice 'OK (caso 1): A insertó su ticket';

  -- ── Caso 2: A no puede insertar un ticket a nombre de B ────────
  begin
    insert into public.support_tickets (user_id, category, title)
    values (v_b_id, 'sugerencia', 'Ticket ajeno');
    v_inserted := true;
  exception when insufficient_privilege then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 2): A no debería poder insertar un ticket a nombre de B';
  end if;
  raise notice 'OK (caso 2): insertar a nombre de otro fue rechazado por RLS';

  -- ── Caso 3: categoría inválida es rechazada por el CHECK ───────
  begin
    insert into public.support_tickets (user_id, category, title)
    values (v_a_id, 'motivo_inventado', 'Categoría inválida');
    v_inserted := true;
  exception when check_violation then
    v_inserted := false;
  end;
  if v_inserted then
    raise exception 'FALLÓ (caso 3): una categoría fuera del CHECK debería rechazarse';
  end if;
  raise notice 'OK (caso 3): categoría inválida rechazada';

  -- ── Caso 4: A lee su propio ticket ──────────────────────────────
  select count(*) into v_count from public.support_tickets where id = v_ticket_id;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 4): A debería poder leer su propio ticket';
  end if;
  raise notice 'OK (caso 4): A lee su propio ticket';

  -- ── Caso 6: A no puede actualizar el estado de su propio ticket ─
  begin
    update public.support_tickets set estado = 'resuelto' where id = v_ticket_id;
    get diagnostics v_count = row_count;
  exception when insufficient_privilege then
    v_count := 0;
  end;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): nadie debería poder actualizar el estado desde la app';
  end if;
  raise notice 'OK (caso 6): no hay forma de cambiar el estado desde la app';

  -- ── Actuar como B: no ve el ticket de A ─────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b_id, 'role', 'authenticated')::text);

  select count(*) into v_count from public.support_tickets where id = v_ticket_id;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 5): B no debería poder ver el ticket de A';
  end if;
  raise notice 'OK (caso 5): B no ve el ticket de A';

  raise notice 'TODAS LAS PRUEBAS DE REPORTAR UN PROBLEMA PASARON';
end $$;

rollback;
