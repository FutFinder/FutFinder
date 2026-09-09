-- =============================================================
-- FutFinder — pruebas de la migración 70 (doce horas de verdad).
--
-- QUÉ SE PRUEBA:
--   La premisa
--   0.  El desfase con UTC es de 3 o 4 horas. Sin esto las pruebas de
--       abajo pasarían igual con el bug puesto, y no probarían nada.
--
--   La ventana de cancelación del jugador
--   1.  Una confirmada que empieza en 13 horas SÍ se cancela. Con el bug
--       la ventana se cerraba 15 horas antes y esto se rechazaba.
--   2.  A 11 horas del partido sigue rechazándose: la ventana no se
--       eliminó, se corrigió.
--   3.  El rechazo sigue nombrando las 12 horas.
--   4.  La cancelación del caso 1 devolvió la plata a cada quien puso.
--
--   El vencimiento de las que están a medio armar
--   5.  Una 'armando' que empieza en 2 horas NO vence. Con el bug moría
--       tres horas antes de su propio partido.
--   6.  Una 'armando' que empezó hace una hora SÍ vence.
--   7.  Una 'confirmada' pasada NO vence por esta vía.
--
--   Privilegios
--   8.  `anon` no ejecuta `cancelar_reserva`, y `authenticated` tampoco
--       `vencer_reservas_pasadas`.
--
-- OJO: `vencer_reservas_pasadas` no está acotada a un complejo, así que
-- toca todas las reservas a medio armar de la base. Corre dentro de la
-- transacción y termina en ROLLBACK, así que no deja nada — pero no la
-- corras en horario de punta si algún día hay tráfico de verdad.
--
-- Requiere las migraciones 54 a 70 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_org      uuid := gen_random_uuid();
  v_amigo    uuid := gen_random_uuid();
  v_complejo uuid := gen_random_uuid();
  v_cancha   uuid := gen_random_uuid();
  v_13h      uuid := gen_random_uuid();
  v_11h      uuid := gen_random_uuid();
  v_arm_2h   uuid := gen_random_uuid();
  v_arm_ayer uuid := gen_random_uuid();
  v_conf_ant uuid := gen_random_uuid();
  v_ahora    timestamp := now() at time zone 'America/Santiago';
  v_ts       timestamp;
  v_desfase  interval;
  v_j        json;
  v_estado   text;
  v_n        integer;
  v_rechazado boolean;
begin
  -- ── Caso 0: la premisa de todo lo demás ────────────────────────
  -- Se comprueba el rango 3-4 y no un número fijo: Chile cambia de hora
  -- y fijar 3 haría fallar la prueba media parte del año.
  v_desfase := public.inicio_de_reserva(date '2027-03-08', time '20:00')
               - (date '2027-03-08' + time '20:00') at time zone 'UTC';
  if v_desfase < interval '3 hours' or v_desfase > interval '4 hours' then
    raise exception 'FALLÓ (caso 0): el desfase con UTC debería ser de 3 o 4 horas, es %', v_desfase;
  end if;
  raise notice 'OK (caso 0): desfase con UTC de %, las pruebas de abajo distinguen el bug', v_desfase;

  -- ── Montaje ────────────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r70-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_amigo]) as u;

  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado)
  values (v_complejo, 'Doce Horas 70', 'Maipú', -33.53, -70.76, true);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha, v_complejo, 'Cancha 1', 'futbol_7', 28000, 60, true);

  -- Confirmada que empieza en 13 horas EXACTAS de Chile. Ese número está
  -- elegido a propósito: cae entre las 12 que promete la app y las 15
  -- que cobraba el bug, así que separa las dos versiones.
  v_ts := v_ahora + interval '13 hours';
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, precio_cancha, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_13h, v_cancha, v_org, v_ts::date, v_ts::time, (v_ts + interval '1 hour')::time,
          28000, 28000, 'jugadores', 'balance', 2, 14000, 'confirmada');
  insert into public.balance_movimientos (user_id, tipo, monto, reserva_id) values
    (v_org,   'cobro_reserva', -14000, v_13h),
    (v_amigo, 'cobro_reserva', -14000, v_13h);

  -- Confirmada que empieza en 11 horas: dentro de la ventana, se rechaza.
  v_ts := v_ahora + interval '11 hours';
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, precio_cancha, modalidad, medio_pago, estado)
  values (v_11h, v_cancha, v_org, v_ts::date, v_ts::time, (v_ts + interval '1 hour')::time,
          28000, 28000, 'completa', 'balance', 'confirmada');

  -- ── Casos 1 y 4: se puede cancelar a 13 horas ──────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  v_j := public.cancelar_reserva(v_13h, 'No juntamos a la gente');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 1): a 13 horas del partido debería poder cancelar, dijo %', v_j->>'reason';
  end if;
  select estado into v_estado from public.reservas where id = v_13h;
  if v_estado <> 'cancelada' then
    raise exception 'FALLÓ (caso 1): la reserva quedó en %', v_estado;
  end if;
  raise notice 'OK (caso 1): la ventana de 12 horas se mide en hora de Chile';

  select count(*) into v_n
    from public.balance_movimientos
   where reserva_id = v_13h and tipo = 'devolucion_cancelacion' and monto = 14000;
  if v_n <> 2 then
    raise exception 'FALLÓ (caso 4): deberían volver dos devoluciones de 14.000, hay %', v_n;
  end if;
  raise notice 'OK (caso 4): le volvió la plata a cada uno de los dos que pagó';

  -- ── Casos 2 y 3: a 11 horas ya no ──────────────────────────────
  v_j := public.cancelar_reserva(v_11h, 'Nos arrepentimos');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 2): a 11 horas del partido NO debería poder cancelar';
  end if;
  if v_j->>'reason' not like '%12 horas%' then
    raise exception 'FALLÓ (caso 3): el motivo debería nombrar las 12 horas, dice %', v_j->>'reason';
  end if;
  select estado into v_estado from public.reservas where id = v_11h;
  if v_estado <> 'confirmada' then
    raise exception 'FALLÓ (caso 2): la reserva no debería haberse tocado, quedó en %', v_estado;
  end if;
  raise notice 'OK (casos 2 y 3): la ventana sigue existiendo y se explica igual';

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  -- ── Montaje del vencimiento ────────────────────────────────────
  -- 2 horas: menos que el desfase, así que con el bug esta reserva
  -- vencía antes de que su partido empezara.
  v_ts := v_ahora + interval '2 hours';
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, precio_cancha, modalidad, medio_pago, estado)
  values (v_arm_2h, v_cancha, v_org, v_ts::date, v_ts::time, (v_ts + interval '1 hour')::time,
          28000, 28000, 'completa', 'balance', 'armando');

  v_ts := v_ahora - interval '1 hour';
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, precio_cancha, modalidad, medio_pago, estado)
  values (v_arm_ayer, v_cancha, v_org, v_ts::date, v_ts::time, (v_ts + interval '1 hour')::time,
          28000, 28000, 'completa', 'balance', 'armando');

  v_ts := v_ahora - interval '3 days';
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, precio_cancha, modalidad, medio_pago, estado)
  values (v_conf_ant, v_cancha, v_org, v_ts::date, v_ts::time, (v_ts + interval '1 hour')::time,
          28000, 28000, 'completa', 'balance', 'confirmada');

  -- ── Casos 5, 6 y 7 ─────────────────────────────────────────────
  perform public.vencer_reservas_pasadas();

  select estado into v_estado from public.reservas where id = v_arm_2h;
  if v_estado <> 'armando' then
    raise exception 'FALLÓ (caso 5): un grupo que juega en 2 horas no puede estar %, todavía se está armando', v_estado;
  end if;
  raise notice 'OK (caso 5): la reserva a medio armar sobrevive hasta la hora del partido';

  select estado into v_estado from public.reservas where id = v_arm_ayer;
  if v_estado <> 'vencida' then
    raise exception 'FALLÓ (caso 6): un partido que empezó hace una hora debería estar vencido, está %', v_estado;
  end if;
  raise notice 'OK (caso 6)';

  select estado into v_estado from public.reservas where id = v_conf_ant;
  if v_estado <> 'confirmada' then
    raise exception 'FALLÓ (caso 7): una confirmada no vence por esta vía, quedó %', v_estado;
  end if;
  raise notice 'OK (caso 7)';

  -- ── Caso 8: privilegios ────────────────────────────────────────
  execute 'set local role anon';
  begin
    perform public.cancelar_reserva(v_11h, 'x');
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then raise exception 'FALLÓ (caso 8a): anon no debería ejecutar cancelar_reserva'; end if;
  execute 'reset role';

  execute 'set local role authenticated';
  begin
    perform public.vencer_reservas_pasadas();
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then raise exception 'FALLÓ (caso 8b): vencer_reservas_pasadas es solo del cron'; end if;
  execute 'reset role';
  raise notice 'OK (caso 8)';

  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 70 PASARON ===';
end $$;

rollback;
