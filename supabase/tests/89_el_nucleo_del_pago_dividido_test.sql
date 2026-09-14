-- =============================================================
-- FutFinder — pruebas de la migración 89 (núcleo del pago dividido).
--
-- CADA RECHAZO COMPRUEBA EL MENSAJE. La primera corrida de este arnés dio
-- dos verdes falsos: «un ajeno no paga» y «nadie paga dos veces» pasaban
-- porque la reserva YA ESTABA CONFIRMADA, no por lo que se quería medir.
-- Por eso los casos de rechazo se corren contra una reserva a medio pagar
-- y se compara el texto exacto.
--
-- QUÉ SE PRUEBA:
--   P1. Cada uno paga su CUOTA, no el total.
--   P2. Tres pagos vivos conviven en la misma reserva (el índice de la 78
--       permitía uno solo y era justo lo contrario de lo necesario).
--   P3-P4. Los pagos intermedios dejan la reserva PARCIAL, con cuánto falta.
--   P5-P6. El último CONFIRMA la reserva.
--   P7. Alguien que no está en la reserva no puede pagar.
--   P8. Nadie paga su parte dos veces.
--   P9. Con el bloque ya tomado no se deja empezar a pagar.
--   P10-P12. EL CASO QUE NO EXISTÍA CON UN SOLO PAGADOR: si el bloque se
--       pierde con plata adentro, se devuelve a TODOS y TODOS reciben
--       aviso, no solo el último que pagó.
--   P13-P15. Y si la reserva se vence a medio pagar, también.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- Requiere las migraciones 54 a 89 aplicadas, y un complejo publicado con
-- una cancha activa con horario.
-- =============================================================

begin;

create temp table r89 (caso text, ok boolean, detalle text);
grant all on r89 to authenticated, anon;

do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid(); v_x uuid := gen_random_uuid();
  v_cpl uuid; v_cancha uuid; v_hoy date; v_h time; v_res json; v_n int;
  v_r uuid; v_rival uuid; v_o1 text; v_o2 text; v_o3 text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r89-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_a, v_b, v_c, v_x]) u;

  select c.id into v_cpl from public.complejos c where c.publicado limit 1;
  select k.id into v_cancha from public.canchas_reservables k
   where k.complejo_id = v_cpl and k.activa
     and exists (select 1 from public.cancha_horario_reglas hr where hr.cancha_id = k.id) limit 1;
  v_hoy := (now() at time zone 'America/Santiago')::date;
  select (s->>'hora_inicio')::time into v_h
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_hoy + 5)->'slots') s
   where (s->>'disponible')::boolean limit 1;

  -- `crear_reserva` sigue cerrada al pago dividido con tarjeta a propósito
  -- (ver el encabezado de la migración), así que la reserva se monta por
  -- debajo. El día que la puerta se abra, esto pasa a usar la RPC.
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_cancha, v_a, v_hoy + 5, v_h, v_h + interval '1 hour', 18000, 18000,
          'jugadores', 'tarjeta', 3, 6000, 'armando')
  returning id into v_r;
  insert into public.reserva_participantes (reserva_id, user_id, rol, estado) values
    (v_r, v_a, 'organizador', 'aceptado'), (v_r, v_b, 'jugador', 'aceptado'),
    (v_r, v_c, 'jugador', 'aceptado');

  set local role authenticated;

  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_x, 'role', 'authenticated')::text);
  v_res := public.iniciar_pago_reserva(v_r);
  insert into r89 values ('P7',
    not (v_res->>'ok')::boolean and v_res->>'reason' = 'No estás en esta reserva',
    v_res->>'reason');

  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_res := public.iniciar_pago_reserva(v_r);
  v_o1 := v_res->>'orden_comercio';
  insert into r89 values ('P1', (v_res->>'monto')::int = 6000, v_res->>'monto');

  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_b, 'role', 'authenticated')::text);
  v_o2 := public.iniciar_pago_reserva(v_r)->>'orden_comercio';
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_c, 'role', 'authenticated')::text);
  v_o3 := public.iniciar_pago_reserva(v_r)->>'orden_comercio';
  insert into r89 values ('P2',
    v_o1 is not null and v_o2 is not null and v_o3 is not null
      and v_o1 <> v_o2 and v_o2 <> v_o3, 'tres órdenes distintas');

  reset role;
  set local request.jwt.claims to '{}';
  v_res := public.confirmar_pago(v_o1, 'r1', null);
  insert into r89 values ('P3',
    v_res->>'resultado' = 'parcial' and (v_res->>'falta')::int = 12000, v_res::text);
  v_res := public.confirmar_pago(v_o2, 'r2', null);
  insert into r89 values ('P4',
    v_res->>'resultado' = 'parcial' and (v_res->>'falta')::int = 6000, v_res::text);

  -- Antes de confirmar el tercero: los rechazos, con la reserva a medio pagar.
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_res := public.iniciar_pago_reserva(v_r);
  insert into r89 values ('P8',
    not (v_res->>'ok')::boolean and v_res->>'reason' = 'Ya pagaste tu parte',
    v_res->>'reason');

  reset role;
  set local request.jwt.claims to '{}';
  v_res := public.confirmar_pago(v_o3, 'r3', null);
  insert into r89 values ('P5', v_res->>'resultado' = 'confirmada', v_res::text);
  select count(*) into v_n from public.reservas where id = v_r and estado = 'confirmada';
  insert into r89 values ('P6', v_n = 1, v_n || ' confirmada');

  -- ── El bloque se pierde con plata adentro ────────────────────
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_cancha, v_a, v_hoy + 6, v_h, v_h + interval '1 hour', 18000, 18000,
          'jugadores', 'tarjeta', 3, 6000, 'armando')
  returning id into v_r;
  insert into public.reserva_participantes (reserva_id, user_id, rol, estado) values
    (v_r, v_a, 'organizador', 'aceptado'), (v_r, v_b, 'jugador', 'aceptado'),
    (v_r, v_c, 'jugador', 'aceptado');

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_o1 := public.iniciar_pago_reserva(v_r)->>'orden_comercio';
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_b, 'role', 'authenticated')::text);
  v_o2 := public.iniciar_pago_reserva(v_r)->>'orden_comercio';
  reset role;
  set local request.jwt.claims to '{}';
  perform public.confirmar_pago(v_o1, 'x1', null);
  perform public.confirmar_pago(v_o2, 'x2', null);

  -- Otro grupo confirma el mismo bloque
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, estado, confirmada_at)
  values (v_cancha, v_x, v_hoy + 6, v_h, v_h + interval '1 hour', 18000, 18000,
          'completa', 'tarjeta', 'confirmada', now())
  returning id into v_rival;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_c, 'role', 'authenticated')::text);
  v_res := public.iniciar_pago_reserva(v_r);
  insert into r89 values ('P9',
    not (v_res->>'ok')::boolean and v_res->>'reason' = 'Otro grupo tomó ese horario',
    v_res->>'reason');

  -- Pero C ya estaba pagando cuando pasó: su aviso llega igual.
  reset role;
  set local request.jwt.claims to '{}';
  insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio)
  values (v_c, v_r, 6000, 'flow', 'QA-89-C');
  v_res := public.confirmar_pago('QA-89-C', 'x3', null);
  insert into r89 values ('P10',
    v_res->>'resultado' = 'reversar' and (v_res->>'otros_reversados')::int = 2, v_res::text);
  select count(*) into v_n from public.pagos where reserva_id = v_r and estado = 'reversar';
  insert into r89 values ('P11', v_n = 3, v_n || ' pagos por devolver');
  select count(*) into v_n from public.notifications
   where (data->>'reservaId')::uuid = v_r and type = 'reserva_cancelada';
  insert into r89 values ('P12', v_n = 3, v_n || ' avisos');

  -- ── Se vence a medio pagar ───────────────────────────────────
  -- Se monta en el FUTURO y después se corre la fecha: el disparador de la
  -- 84 —con razón— no deja nacer un pago para un bloque que ya pasó.
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_cancha, v_a, v_hoy + 7, '20:00', '21:00', 18000, 18000,
          'jugadores', 'tarjeta', 3, 6000, 'armando')
  returning id into v_r;
  insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio, estado, pagado_at)
  values (v_a, v_r, 6000, 'flow', 'QA-89-V1', 'pagado', now()),
         (v_b, v_r, 6000, 'flow', 'QA-89-V2', 'pagado', now());
  update public.reservas set fecha = v_hoy - 1 where id = v_r;

  v_res := public.vencer_reservas_pasadas();
  insert into r89 values ('P13', (v_res->>'pagos_por_devolver')::int >= 2, v_res::text);
  select count(*) into v_n from public.pagos where reserva_id = v_r and estado = 'reversar';
  insert into r89 values ('P14', v_n = 2, v_n || ' pagos por devolver');
  select count(*) into v_n from public.reservas where id = v_r and estado = 'vencida';
  insert into r89 values ('P15', v_n = 1, v_n || ' vencida');
end $$;

reset role;

select caso, case when ok then 'PASA' else 'FALLA' end as resultado, detalle
  from r89 order by caso;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r89 where not ok order by caso loop
    raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle;
  end loop;
  select count(*) into v_malos from r89 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 89 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 89 PASARON ===';
end $$;

rollback;
