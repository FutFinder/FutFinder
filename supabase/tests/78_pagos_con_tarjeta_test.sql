-- =============================================================
-- FutFinder — pruebas de la migración 78 (pagos con tarjeta).
--
-- QUÉ SE PRUEBA:
--   Quién puede iniciar un pago
--   1.  Un ajeno no puede pagar la reserva de otro.
--   2.  Una reserva de Balance no se paga por esta vía.
--   3.  Se crea el pago con el monto de la RESERVA, nunca uno que mande
--       el cliente.
--   4.  Volver a pedirlo REUSA el pendiente. Volver atrás en el navegador
--       y darle pagar otra vez no puede generar dos cobros.
--   5.  El jugador no puede confirmar su propio pago: eso es del webhook.
--
--   El proveedor avisa
--   6.  Se marca pagado y la reserva queda confirmada.
--   7.  El MISMO aviso otra vez no cobra ni confirma dos veces. Un webhook
--       duplicado es lo normal, no la excepción.
--
--   La carrera, que es lo único de acá que puede costar plata
--   8.  Iniciar el pago avisa si el bloque ya se lo llevó otro.
--   9.  Pero si alcanzó a entrar antes: pagó y no hay cancha. El pago
--       queda en 'reversar' — plata de alguien que no recibió nada.
--   10. Y su reserva queda 'rechazada', no colgada.
--   11. Y se le avisa.
--   12. Un aviso de fallo que llega tarde NO deshace un cobro hecho.
--
--   Privilegios y RLS
--   13. `anon` no confirma pagos.
--   14. Nadie ve los pagos de otro…
--   15. …pero sí los propios.
--
-- Requiere las migraciones 54 a 78 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;
create temp table r78 (caso text, ok boolean, detalle text);
grant all on r78 to authenticated, anon;

do $$
declare
  v_org    uuid := gen_random_uuid();
  v_otro   uuid := gen_random_uuid();
  v_cpl    uuid := gen_random_uuid();
  v_k      uuid := gen_random_uuid();
  v_r      uuid := gen_random_uuid();  -- la que se paga
  v_rival  uuid := gen_random_uuid();  -- la que gana la carrera
  v_bal    uuid := gen_random_uuid();  -- una de balance
  v_manana date := (now() at time zone 'America/Santiago')::date + 3;
  v_j json; v_orden text; v_orden2 text; v_n integer; v_estado text; v_rechazado boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r78-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_otro]) as u;

  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado)
  values (v_cpl, 'Pagos 78', 'Maipú', -33.53, -70.76, true);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_k, v_cpl, 'Cancha 1', 'futbol_7', 28000, 60, true);
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_k, d, time '08:00', time '23:00' from generate_series(0,6) as d;

  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, precio_cancha, modalidad, medio_pago, estado)
  values (v_r,     v_k, v_org,  v_manana, time '20:00', time '21:00', 28000, 28000, 'completa', 'tarjeta', 'procesando'),
         (v_rival, v_k, v_otro, v_manana, time '20:00', time '21:00', 28000, 28000, 'completa', 'tarjeta', 'procesando'),
         (v_bal,   v_k, v_org,  v_manana, time '10:00', time '11:00', 28000, 28000, 'completa', 'balance', 'procesando');

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_otro, 'role','authenticated')::text);
  v_j := public.iniciar_pago_reserva(v_r);
  insert into r78 values ('1', (v_j->>'ok')::boolean is false, v_j->>'reason');

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role','authenticated')::text);
  v_j := public.iniciar_pago_reserva(v_bal);
  insert into r78 values ('2', (v_j->>'ok')::boolean is false, v_j->>'reason');

  v_j := public.iniciar_pago_reserva(v_r);
  v_orden := v_j->>'orden_comercio';
  insert into r78 values ('3', (v_j->>'ok')::boolean and (v_j->>'monto')::integer = 28000,
                          'monto ' || (v_j->>'monto'));

  v_j := public.iniciar_pago_reserva(v_r);
  v_orden2 := v_j->>'orden_comercio';
  select count(*) into v_n from public.pagos where reserva_id = v_r;
  insert into r78 values ('4', v_orden2 = v_orden and v_n = 1 and (v_j->>'reusado')::boolean,
                          v_n || ' pago(s)');

  begin
    perform public.confirmar_pago(v_orden);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  insert into r78 values ('5', v_rechazado, 'el jugador no confirma su propio pago');
  reset role;

  v_j := public.confirmar_pago(v_orden, 'FLOW-TOKEN-1', '{"status":2}'::jsonb);
  select estado into v_estado from public.reservas where id = v_r;
  insert into r78 values ('6', v_j->>'resultado' = 'confirmada' and v_estado = 'confirmada', v_estado);

  v_j := public.confirmar_pago(v_orden, 'FLOW-TOKEN-1', '{"status":2}'::jsonb);
  select count(*) into v_n from public.pagos where orden_comercio = v_orden and estado = 'pagado';
  insert into r78 values ('7', (v_j->>'ya_estaba')::boolean and v_n = 1, 'pagos pagados: ' || v_n);

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_otro, 'role','authenticated')::text);
  v_j := public.iniciar_pago_reserva(v_rival);
  insert into r78 values ('8', (v_j->>'ok')::boolean is false, v_j->>'reason');
  reset role;

  -- Si alcanzó a entrar a pagar ANTES de que el otro confirmara, el aviso
  -- llega igual. Se simula creando el pendiente a mano: es exactamente el
  -- estado en que habría quedado la fila.
  insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio)
  values (v_otro, v_rival, 28000, 'flow', 'FF-CARRERA-1');
  v_j := public.confirmar_pago('FF-CARRERA-1', 'FLOW-TOKEN-2', '{"status":2}'::jsonb);
  select estado into v_estado from public.pagos where orden_comercio = 'FF-CARRERA-1';
  insert into r78 values ('9', v_j->>'resultado' = 'reversar' and v_estado = 'reversar', v_estado);
  select estado into v_estado from public.reservas where id = v_rival;
  insert into r78 values ('10', v_estado = 'rechazada', v_estado);
  select count(*) into v_n from public.notifications
   where user_id = v_otro and title = 'No pudimos tomar esa hora';
  insert into r78 values ('11', v_n = 1, v_n || ' aviso(s)');

  v_j := public.rechazar_pago(v_orden, 'fallido');
  select estado into v_estado from public.pagos where orden_comercio = v_orden;
  insert into r78 values ('12', v_estado = 'pagado', v_estado);

  set local role anon;
  begin
    perform public.confirmar_pago('lo-que-sea');
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  insert into r78 values ('13', v_rechazado, 'anon no confirma pagos');
  reset role;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role','authenticated')::text);
  select count(*) into v_n from public.pagos where user_id = v_otro;
  insert into r78 values ('14', v_n = 0, v_n || ' fila(s) de otro');
  select count(*) into v_n from public.pagos where user_id = v_org;
  insert into r78 values ('15', v_n = 1, v_n || ' fila(s) propia(s)');
  reset role;
end $$;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r78 order by caso::integer loop
    if v_f.ok then raise notice 'OK (caso %): %', v_f.caso, v_f.detalle;
    else raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle; end if;
  end loop;
  select count(*) into v_malos from r78 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 78 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 78 PASARON ===';
end $$;

rollback;
