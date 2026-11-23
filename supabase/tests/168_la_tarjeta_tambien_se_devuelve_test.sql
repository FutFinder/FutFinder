-- =============================================================
-- FutFinder — pruebas de la migración 168 (la tarjeta también se devuelve).
--
-- EL FALLO. Cancelar una reserva devolvía sólo lo que `balance_movimientos`
-- registraba como `cobro_reserva`. Un pago con tarjeta (`confirmar_pago`,
-- migraciones 78 y 89) no deja movimiento de saldo, así que la reserva
-- pagada con tarjeta y cancelada quedaba sin devolución y sin marca:
-- nadie iba a enterarse de que había plata que devolver.
--
--   T1. El organizador cancela una reserva CONFIRMADA pagada con tarjeta
--       (pago dividido, tres pagos): los tres quedan en `reversar`.
--   T2. Cada uno de los tres recibe un aviso que nombra su pago.
--   T3. El recinto cancela (`admin_cancelar_reserva`): lo mismo.
--   T4. Una reserva a MEDIO pagar (`armando`) que se cae por dentro
--       (`cancelar_reserva_interna`): el pago que alcanzó a entrar queda en
--       `reversar`. Antes sólo miraba las `confirmada`.
--   T5. Cancelar dos veces no vuelve a marcar ni a avisar.
--   T6. Los pagos marcados siguen el flujo de siempre: `marcar_pago_reversado`
--       los da por devueltos.
--   T7. El jugador no puede llamar `reversar_pagos_de_reserva` ni
--       `marcar_pago_reversado` por su cuenta: 42501.
--   T8. Sin pagos con tarjeta, la devolución al saldo sigue igual (y no
--       aparece ningún pago en `reversar`).
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r168 (caso text, ok boolean, detalle text);
grant all on r168 to authenticated;

do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid(); v_dueno uuid := gen_random_uuid();
  v_cpl uuid := gen_random_uuid(); v_cancha uuid := gen_random_uuid();
  v_hoy date; v_h time; v_r uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid;
  v_o1 text; v_o2 text; v_o3 text; v_res json; v_n int; v_pago uuid;
  v_estado text; v_codigo text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r168-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_a, v_b, v_c, v_dueno]) u;

  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado)
  values (v_cpl, 'Recinto arnés 168', 'Ñuñoa', -33.45, -70.60, true);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha, v_cpl, 'Cancha arnés 168', 'futbol_7', 20000, 60, true);
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '00:00', time '23:00' from generate_series(0, 6) as d;
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_cpl, v_dueno, 'dueño');

  v_hoy := (now() at time zone 'America/Santiago')::date;
  select (s->>'hora_inicio')::time into v_h
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_hoy + 5)->'slots') s
   where (s->>'disponible')::boolean limit 1;

  -- ── Una reserva pagada entera con tarjeta, en tres partes ──
  -- Se monta por debajo, como en el arnés 89: `crear_reserva` sigue
  -- cerrada al pago dividido con tarjeta.
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_cancha, v_a, v_hoy + 5, v_h, v_h + interval '1 hour', 18000, 18000,
          'jugadores', 'tarjeta', 3, 6000, 'armando')
  returning id into v_r;
  insert into public.reserva_participantes (reserva_id, user_id, rol, estado) values
    (v_r, v_a, 'organizador', 'aceptado'), (v_r, v_b, 'jugador', 'aceptado'),
    (v_r, v_c, 'jugador', 'aceptado');

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_o1 := public.iniciar_pago_reserva(v_r)->>'orden_comercio';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role', 'authenticated')::text);
  v_o2 := public.iniciar_pago_reserva(v_r)->>'orden_comercio';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_c, 'role', 'authenticated')::text);
  v_o3 := public.iniciar_pago_reserva(v_r)->>'orden_comercio';
  reset role;
  set local request.jwt.claims to '{}';
  perform public.confirmar_pago(v_o1, 'r1', null);
  perform public.confirmar_pago(v_o2, 'r2', null);
  perform public.confirmar_pago(v_o3, 'r3', null);

  insert into r168 values ('montaje: confirmada, tres pagos con tarjeta y nada en el saldo',
    (select estado from public.reservas where id = v_r) = 'confirmada'
      and (select count(*) from public.pagos where reserva_id = v_r and estado = 'pagado') = 3
      and not exists (select 1 from public.balance_movimientos where reserva_id = v_r),
    (select estado from public.reservas where id = v_r));

  -- ── T1/T2: el organizador cancela, con su sesión ──
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_res := public.cancelar_reserva(v_r, 'Se nos cayó el partido');
  reset role;
  set local request.jwt.claims to '{}';

  select count(*) into v_n from public.pagos where reserva_id = v_r and estado = 'reversar';
  insert into r168 values ('T1 el organizador cancela: los tres pagos quedan para devolver',
    (v_res->>'ok')::boolean and v_n = 3
      and (select estado from public.reservas where id = v_r) = 'cancelada',
    v_n || ' en reversar; ' || v_res::text);

  select count(distinct n.user_id) into v_n
    from public.notifications n
    join public.pagos p on p.id = (n.data->>'pagoId')::uuid
   where p.reserva_id = v_r and n.user_id = p.user_id;
  insert into r168 values ('T2 cada pagador recibe el aviso de su pago', v_n = 3, v_n || ' avisados');

  -- ── T5: cancelar otra vez no marca ni avisa de nuevo ──
  select count(*) into v_n from public.notifications where (data->>'reservaId')::uuid = v_r;
  perform public.cancelar_reserva_interna(v_r, 'otra vez');
  insert into r168 values ('T5 cancelar dos veces no vuelve a avisar',
    (select count(*) from public.notifications where (data->>'reservaId')::uuid = v_r) = v_n,
    v_n || ' avisos antes y después');

  -- ── T6: el flujo de devolución de siempre los acepta ──
  select id into v_pago from public.pagos where reserva_id = v_r limit 1;
  v_res := public.marcar_pago_reversado(v_pago, 'devuelto en Flow', null);
  insert into r168 values ('T6 marcar_pago_reversado los da por devueltos',
    (v_res->>'ok')::boolean and (select estado from public.pagos where id = v_pago) = 'reversado',
    v_res::text);

  -- ── T3: el recinto cancela una reserva pagada con tarjeta ──
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_cancha, v_a, v_hoy + 6, v_h, v_h + interval '1 hour', 18000, 18000,
          'jugadores', 'tarjeta', 3, 6000, 'armando')
  returning id into v_r2;
  insert into public.reserva_participantes (reserva_id, user_id, rol, estado) values
    (v_r2, v_a, 'organizador', 'aceptado'), (v_r2, v_b, 'jugador', 'aceptado'),
    (v_r2, v_c, 'jugador', 'aceptado');
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_o1 := public.iniciar_pago_reserva(v_r2)->>'orden_comercio';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role', 'authenticated')::text);
  v_o2 := public.iniciar_pago_reserva(v_r2)->>'orden_comercio';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_c, 'role', 'authenticated')::text);
  v_o3 := public.iniciar_pago_reserva(v_r2)->>'orden_comercio';
  reset role;
  set local request.jwt.claims to '{}';
  perform public.confirmar_pago(v_o1, 'q1', null);
  perform public.confirmar_pago(v_o2, 'q2', null);
  perform public.confirmar_pago(v_o3, 'q3', null);

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  v_res := public.admin_cancelar_reserva(v_r2, 'Se inundó la cancha por la lluvia');
  reset role;
  set local request.jwt.claims to '{}';

  select count(*) into v_n from public.pagos where reserva_id = v_r2 and estado = 'reversar';
  insert into r168 values ('T3 el recinto cancela: los pagos con tarjeta quedan para devolver',
    (v_res->>'ok')::boolean and v_n = 3 and (v_res->>'tarjeta_por_devolver')::int = 3,
    v_n || ' en reversar; ' || v_res::text);

  -- ── T4: a medio pagar, se cae por dentro ──
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_cancha, v_a, v_hoy + 4, v_h, v_h + interval '1 hour', 18000, 18000,
          'jugadores', 'tarjeta', 3, 6000, 'armando')
  returning id into v_r3;
  insert into public.reserva_participantes (reserva_id, user_id, rol, estado) values
    (v_r3, v_a, 'organizador', 'aceptado'), (v_r3, v_b, 'jugador', 'aceptado'),
    (v_r3, v_c, 'jugador', 'aceptado');
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role', 'authenticated')::text);
  v_o1 := public.iniciar_pago_reserva(v_r3)->>'orden_comercio';
  reset role;
  set local request.jwt.claims to '{}';
  perform public.confirmar_pago(v_o1, 'm1', null);

  v_res := public.cancelar_reserva_interna(v_r3, 'Se canceló el partido');
  select estado into v_estado from public.pagos where orden_comercio = v_o1;
  insert into r168 values ('T4 a medio pagar: el pago que entró queda para devolver',
    v_estado = 'reversar' and (select estado from public.reservas where id = v_r3) = 'cancelada',
    v_estado || '; ' || v_res::text);

  -- ── T7: el jugador no se marca nada solo ──
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role', 'authenticated')::text);
  begin
    perform public.reversar_pagos_de_reserva(v_r3, 'x', 'y');
    v_codigo := 'sin error';
  exception when others then v_codigo := sqlstate;
  end;
  insert into r168 values ('T7a reversar_pagos_de_reserva: 42501 para el jugador', v_codigo = '42501', v_codigo);
  begin
    perform public.marcar_pago_reversado(v_pago, 'yo mismo', null);
    v_codigo := 'sin error';
  exception when others then v_codigo := sqlstate;
  end;
  insert into r168 values ('T7b marcar_pago_reversado: 42501 para el jugador', v_codigo = '42501', v_codigo);
  reset role;
  set local request.jwt.claims to '{}';

  -- ── T8: pagada con saldo, la devolución al saldo sigue igual ──
  insert into public.balance_movimientos (user_id, tipo, monto, metodo_carga)
  values (v_c, 'carga', 100000, 'transferencia');
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_cancha, v_c, v_hoy + 3, v_h, v_h + interval '1 hour', 18000, 18000,
          'completa', 'balance', null, null, 'confirmada')
  returning id into v_r4;
  insert into public.balance_movimientos (user_id, tipo, monto, reserva_id)
  values (v_c, 'cobro_reserva', -18000, v_r4);
  perform public.cancelar_reserva_interna(v_r4, 'prueba saldo');
  insert into r168 values ('T8 con saldo: se devuelve al saldo y no hay pagos que reversar',
    (select coalesce(sum(monto), 0) from public.balance_movimientos where reserva_id = v_r4) = 0
      and not exists (select 1 from public.pagos where reserva_id = v_r4),
    (select coalesce(sum(monto), 0) from public.balance_movimientos where reserva_id = v_r4)::text);
end $$;

select caso, ok, detalle from r168 order by caso;
do $$
declare v_mal int;
begin
  select count(*) into v_mal from r168 where not ok;
  if v_mal > 0 then
    raise exception '% caso(s) de la 168 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
