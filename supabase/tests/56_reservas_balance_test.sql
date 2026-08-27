-- =============================================================
-- FutFinder — pruebas del Balance FutFinder / monedero interno
-- (migración 56).
--
-- QUÉ SE PRUEBA:
--   1. Carga mínima $1.000: menos que eso se rechaza.
--   2. Un método de carga inválido se rechaza.
--   3. Cargar con un método válido acumula saldo.
--   4. Dos cargas seguidas SUMAN, el saldo no se sobrescribe.
--   5. Cargar genera la notificación 'balance_cargado'.
--   6. get_mi_balance() devuelve el saldo y los movimientos correctos,
--      y ninguno de otro usuario.
--   7. RLS: un usuario no puede leer los movimientos de otro
--      directamente (privacidad de saldos).
--   8-10. Los CHECK de la tabla no dejan pasar un signo equivocado ni
--      una carga con reserva asociada.
--   11. Un usuario sin ningún movimiento tiene saldo 0, no NULL ni error.
--
-- Requiere la migración 56 aplicada (usa `public.notifications` y
-- `public.profiles`, previas).
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- Run. Todo corre en una transacción que termina en ROLLBACK. Si un
-- caso falla, la ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_user1 uuid := gen_random_uuid();
  v_user2 uuid := gen_random_uuid();

  v_j     json;
  v_count int;
  v_rechazado boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_user1, 'authenticated', 'authenticated', 'balance-u1-' || v_user1 || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_user2, 'authenticated', 'authenticated', 'balance-u2-' || v_user2 || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_user1, 'role', 'authenticated')::text);

  -- ── Caso 1: menos de $1.000 se rechaza ────────────────────────────
  v_j := public.cargar_balance(999, 'transferencia');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 1): cargar menos de $1.000 debería rechazarse, respondió %', v_j;
  end if;
  raise notice 'OK (caso 1): la carga mínima de $1.000 se exige';

  -- ── Caso 2: método inválido se rechaza ────────────────────────────
  v_j := public.cargar_balance(5000, 'bitcoin');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 2): un método de carga inválido debería rechazarse, respondió %', v_j;
  end if;
  raise notice 'OK (caso 2): un método de carga inválido se rechaza';

  -- ── Caso 3: carga válida acumula saldo ────────────────────────────
  v_j := public.cargar_balance(1000, 'transferencia');
  if (v_j->>'ok')::boolean is not true or (v_j->>'saldo')::int <> 1000 then
    raise exception 'FALLÓ (caso 3): cargar $1.000 debería dejar el saldo en 1000, respondió %', v_j;
  end if;
  raise notice 'OK (caso 3): una carga válida se refleja en el saldo';

  -- ── Caso 4: una segunda carga SUMA, no reemplaza ──────────────────
  v_j := public.cargar_balance(5000, 'tarjeta');
  if (v_j->>'ok')::boolean is not true or (v_j->>'saldo')::int <> 6000 then
    raise exception 'FALLÓ (caso 4): dos cargas seguidas deberían sumar 1000+5000=6000, respondió %', v_j;
  end if;
  raise notice 'OK (caso 4): las cargas se acumulan, el saldo nunca se sobrescribe';

  -- ── Caso 5: notifica 'balance_cargado' ────────────────────────────
  select count(*) into v_count from public.notifications where user_id = v_user1 and type = 'balance_cargado';
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 5): cada carga debería notificar balance_cargado, hay %', v_count;
  end if;
  raise notice 'OK (caso 5): cada carga notifica balance_cargado';

  -- ── Caso 6: get_mi_balance() devuelve lo propio, completo ─────────
  v_j := public.get_mi_balance();
  if (v_j->>'ok')::boolean is not true or (v_j->>'saldo')::int <> 6000 then
    raise exception 'FALLÓ (caso 6): get_mi_balance debería devolver saldo=6000, respondió %', v_j;
  end if;
  if json_array_length(v_j->'movimientos') <> 2 then
    raise exception 'FALLÓ (caso 6): get_mi_balance debería devolver los 2 movimientos propios, respondió %', v_j;
  end if;
  raise notice 'OK (caso 6): get_mi_balance devuelve saldo y movimientos propios completos';

  -- ── Caso 7: RLS — un usuario no lee los movimientos de otro ───────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_user2, 'role', 'authenticated')::text);
  select count(*) into v_count from public.balance_movimientos where user_id = v_user1;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 7): un usuario no debería poder leer los movimientos de otro';
  end if;
  v_j := public.get_mi_balance();
  if (v_j->>'saldo')::int <> 0 or json_array_length(v_j->'movimientos') <> 0 then
    raise exception 'FALLÓ (caso 7): get_mi_balance de v_user2 no debería ver nada de v_user1, respondió %', v_j;
  end if;
  raise notice 'OK (caso 7): RLS de balance_movimientos es estrictamente por dueño';

  -- ── Caso 8: el signo de "carga" tiene que ser positivo ────────────
  -- `balance_movimientos` no tiene policy de insert (solo escriben las
  -- RPC): estos tres casos prueban el CHECK de la tabla, no la RLS, así
  -- que el insert directo va sin rol acotado para no confundir un
  -- rechazo de RLS con el rechazo del CHECK que se quiere medir.
  reset role;
  begin
    insert into public.balance_movimientos (user_id, tipo, monto) values (v_user2, 'carga', -100);
    v_rechazado := false;
  exception when check_violation then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 8): una carga con monto negativo debería violar el CHECK de signo';
  end if;
  raise notice 'OK (caso 8): el CHECK rechaza una carga con monto negativo';

  -- ── Caso 9: el signo de "cobro_reserva" tiene que ser negativo ────
  begin
    insert into public.balance_movimientos (user_id, tipo, monto) values (v_user2, 'cobro_reserva', 100);
    v_rechazado := false;
  exception when check_violation then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 9): un cobro_reserva con monto positivo debería violar el CHECK de signo';
  end if;
  raise notice 'OK (caso 9): el CHECK rechaza un cobro_reserva con monto positivo';

  -- ── Caso 10: una "carga" no puede llevar reserva_id ───────────────
  begin
    insert into public.balance_movimientos (user_id, tipo, monto, reserva_id)
    values (v_user2, 'carga', 1000, gen_random_uuid());
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 10): una carga con reserva_id asociada debería rechazarse';
  end if;
  raise notice 'OK (caso 10): una carga no puede llevar reserva_id asociada';

  -- ── Caso 11: sin ningún movimiento, el saldo es 0, no error ───────
  v_j := public.get_mi_balance();
  if (v_j->>'ok')::boolean is not true or (v_j->>'saldo')::int <> 0 then
    raise exception 'FALLÓ (caso 11): un usuario sin movimientos debería tener saldo 0, respondió %', v_j;
  end if;
  raise notice 'OK (caso 11): un usuario sin movimientos tiene saldo 0';

  raise notice 'TODAS LAS PRUEBAS DE BALANCE FUTFINDER PASARON';
end $$;

rollback;
